import { Router } from 'express';
import { prisma } from '@anyq/db';
import { signPosToken, requirePosAuth } from '../pos-auth';
import type { PosAuthedRequest } from '../pos-auth';
import { loginRateLimit } from '../rateLimit';
import { tariffState, tariffDenialMessage } from '../tariff';
import { findStockShortages, applyStockDelta, createStockWithMovement } from '../stock';
import type { SaleItemInput, StockShortage } from '../stock';
import { buildSummary, buildTopProducts, buildCashierBreakdown, findLowStock, buildFoodCost } from '../reports';
import type { SaleRecord } from '../reports';
import { allocateFefo, classifyExpiry } from '../batches';
import type { BatchStock } from '../batches';
import { computeIngredientConsumption, computeDishCost } from '../recipes';
import { computeCountAdjustments } from '../counts';
import { computeDiscount } from '../discounts';
import type { DiscountType } from '../discounts';
import { computeLoyalty } from '../loyalty';
import { groupProductVariants } from '../variants';
import { computeProduction } from '../production';
import { buildKdsTickets } from '../kds';
import { getVapidPublicKey } from '../push';

// 1 point = 1 tenge earned/redeemed. Not yet configurable per company — a fixed
// MVP rate, same simplification as the rest of the Retail Pack slice so far.
const LOYALTY_EARN_RATE_PERCENT = 5;

export const posRouter = Router();

posRouter.post('/login', loginRateLimit, async (req, res) => {
  const { pin } = req.body ?? {};
  if (!pin) {
    res.status(400).json({ error: 'Введите PIN' });
    return;
  }

  const user = await prisma.user.findFirst({
    where: { posPin: pin },
    include: { company: { include: { tariff: true, locations: true } } },
  });
  if (!user) {
    res.status(401).json({ error: 'Неверный PIN' });
    return;
  }

  const state = tariffState(user.company.tariff);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const modules: string[] = user.company.tariff ? JSON.parse(user.company.tariff.modules) : [];
  const products = await prisma.product.findMany({ where: { companyId: user.companyId, sellable: true } });
  const primaryLocationId = user.company.locations[0]?.id;
  const stockRows = primaryLocationId
    ? await prisma.stock.findMany({ where: { locationId: primaryLocationId } })
    : [];
  const stockByProduct = new Map(stockRows.map((s) => [s.productId, s.quantity]));

  // Dishes (recipe-tracked products) don't carry their own stock row — their real
  // availability is checked against ingredient stock at sale time — so the client
  // just gets a large sentinel here instead of a false "out of stock".
  const dishProductIds = modules.includes('restaurant')
    ? new Set(
        (await prisma.recipe.findMany({ where: { productId: { in: products.map((p) => p.id) } }, select: { productId: true } })).map(
          (r) => r.productId,
        ),
      )
    : new Set<string>();

  const modifierRows = modules.includes('restaurant')
    ? await prisma.productModifier.findMany({ where: { productId: { in: products.map((p) => p.id) } } })
    : [];
  const modifiersByProduct = new Map<string, { id: string; name: string; priceDelta: number }[]>();
  for (const m of modifierRows) {
    const list = modifiersByProduct.get(m.productId) ?? [];
    list.push({ id: m.id, name: m.name, priceDelta: m.priceDelta });
    modifiersByProduct.set(m.productId, list);
  }

  const productRows = products.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.salePrice,
    barcode: p.barcode ?? '',
    category: p.category ?? '',
    stock: dishProductIds.has(p.id) ? 9999 : (stockByProduct.get(p.id) ?? 0),
    stopListed: p.stopListed,
    // Weight-based sale is part of the same Retail Pack bundle as variants —
    // non-retail companies always see 'piece' regardless of what's stored,
    // same gating pattern used for variant grouping just below.
    saleUnit: modules.includes('retail') ? p.saleUnit : 'piece',
    modifiers: modifiersByProduct.get(p.id) ?? [],
    parentProductId: p.parentProductId,
    variantLabel: p.variantLabel,
  }));

  // Variant grouping only applies for retail-tariff companies — everyone else sees
  // every product (including variant children) as a flat, ungrouped list, which is
  // exactly today's behaviour and stays backward-compatible.
  const groupedProducts = modules.includes('retail')
    ? groupProductVariants(productRows).map(({ product, variants }) => ({ ...product, variants }))
    : productRows.map((p) => ({ ...p, variants: [] }));

  res.json({
    token: signPosToken(user.id, user.companyId),
    user: { id: user.id, name: user.name, role: user.role },
    company: { id: user.company.id, name: user.company.name, slug: user.company.slug },
    modules,
    locations: user.company.locations.map((l) => ({ id: l.id, name: l.name, type: l.type, address: l.address ?? '' })),
    products: groupedProducts,
  });
});

posRouter.post('/sales', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const items: SaleItemInput[] = Array.isArray(b.items) ? b.items : [];
  if (items.length === 0 || !b.locationId || !b.paymentMethod) {
    res.status(400).json({ error: 'Некорректные данные продажи' });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  const hasRestaurant = modules.includes('restaurant');

  const discountType: DiscountType | undefined = b.discountType === 'percent' || b.discountType === 'fixed' ? b.discountType : undefined;
  const discountValue: number | undefined = Number.isFinite(b.discountValue) ? Number(b.discountValue) : undefined;
  if (discountType && !modules.includes('retail')) {
    res.status(403).json({ error: 'Скидки недоступны на вашем тарифе' });
    return;
  }
  const discount = discountType && discountValue !== undefined ? { type: discountType, value: discountValue } : null;
  const subtotal = items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0);
  const { discountAmount } = computeDiscount(subtotal, discount);

  const customerPhone = typeof b.customerPhone === 'string' ? b.customerPhone.trim() : '';
  const pointsToRedeem = Number.isFinite(b.pointsToRedeem) ? Number(b.pointsToRedeem) : 0;
  if ((customerPhone || pointsToRedeem > 0) && !modules.includes('retail')) {
    res.status(403).json({ error: 'Программа лояльности недоступна на вашем тарифе' });
    return;
  }

  let customer = customerPhone
    ? await prisma.counterparty.findFirst({ where: { companyId: req.posCompanyId, phone: customerPhone, type: 'customer' } })
    : null;
  if (!customer && customerPhone) {
    const customerName = typeof b.customerName === 'string' && b.customerName.trim() ? b.customerName.trim() : customerPhone;
    customer = await prisma.counterparty.create({
      data: { companyId: req.posCompanyId!, name: customerName, phone: customerPhone, type: 'customer' },
    });
  }

  const { redemptionAmount, finalTotal, pointsEarned } = computeLoyalty({
    netAfterDiscount: subtotal - discountAmount,
    availablePoints: customer?.loyaltyPoints ?? 0,
    pointsToRedeem,
    earnRatePercent: LOYALTY_EARN_RATE_PERCENT,
  });

  try {
    const document = await prisma.$transaction(async (tx) => {
      const now = new Date();

      // Dishes (products with a recipe, on restaurant-tariff companies) don't carry
      // their own stock — selling one consumes its recipe's ingredients instead.
      const recipes = hasRestaurant
        ? await tx.recipe.findMany({
            where: { productId: { in: items.map((it) => it.productId) } },
            include: { ingredients: true },
          })
        : [];
      const recipeIngredientsByProductId = new Map(
        recipes.map((r) => [r.productId, r.ingredients.map((ing) => ({ ingredientId: ing.ingredientId, quantity: ing.quantity }))]),
      );
      const dishProductIds = new Set(recipeIngredientsByProductId.keys());
      const plainItems = items.filter((it) => !dishProductIds.has(it.productId));
      const dishItems = items.filter((it) => dishProductIds.has(it.productId));

      const ingredientConsumption = computeIngredientConsumption(
        dishItems.map((it) => ({ productId: it.productId, quantity: it.quantity })),
        recipeIngredientsByProductId,
      );
      const ingredientIds = ingredientConsumption.map((c) => c.ingredientId);

      const [stockRows, batchRows, ingredientStockRows] = await Promise.all([
        tx.stock.findMany({ where: { locationId: b.locationId, productId: { in: plainItems.map((it) => it.productId) } } }),
        tx.productBatch.findMany({
          where: { locationId: b.locationId, productId: { in: plainItems.map((it) => it.productId) }, quantity: { gt: 0 } },
        }),
        tx.stock.findMany({ where: { locationId: b.locationId, productId: { in: ingredientIds } } }),
      ]);
      const stockByProduct = new Map(stockRows.map((s) => [s.productId, s]));
      const batchesByProduct = new Map<string, typeof batchRows>();
      for (const batch of batchRows) {
        const list = batchesByProduct.get(batch.productId) ?? [];
        list.push(batch);
        batchesByProduct.set(batch.productId, list);
      }

      // For batch-tracked products, only non-expired batches count as sellable —
      // expired stock must never be auto-sold, it has to be written off explicitly.
      const quantityByProduct = new Map<string, number>();
      for (const item of plainItems) {
        const productBatches = batchesByProduct.get(item.productId);
        if (productBatches && productBatches.length > 0) {
          const sellable = productBatches
            .filter((batch) => batch.expiryDate > now)
            .reduce((sum, batch) => sum + batch.quantity, 0);
          quantityByProduct.set(item.productId, sellable);
        } else {
          quantityByProduct.set(item.productId, stockByProduct.get(item.productId)?.quantity ?? 0);
        }
      }

      const ingredientStockByProduct = new Map(ingredientStockRows.map((s) => [s.productId, s]));
      const ingredientQuantityByProduct = new Map(ingredientStockRows.map((s) => [s.productId, s.quantity]));

      const shortages = [
        ...findStockShortages(plainItems, quantityByProduct),
        ...findStockShortages(
          ingredientConsumption.map((c) => ({ productId: c.ingredientId, quantity: c.quantity, price: 0 })),
          ingredientQuantityByProduct,
        ),
      ];
      if (shortages.length > 0) {
        throw new StockError(shortages);
      }

      const documentItemsData: { productId: string; batchId: string | null; quantity: number; price: number }[] = [];
      const otherUpdates: Promise<unknown>[] = [];

      for (const item of plainItems) {
        const productBatches = batchesByProduct.get(item.productId);
        if (productBatches && productBatches.length > 0) {
          const sellableBatches: BatchStock[] = productBatches
            .filter((batch) => batch.expiryDate > now)
            .map((batch) => ({ batchId: batch.id, expiryDate: batch.expiryDate, quantity: batch.quantity }));
          const { allocations } = allocateFefo(item.quantity, sellableBatches);
          for (const alloc of allocations) {
            const batch = productBatches.find((batchRow) => batchRow.id === alloc.batchId)!;
            otherUpdates.push(tx.productBatch.update({ where: { id: batch.id }, data: { quantity: batch.quantity - alloc.quantity } }));
            documentItemsData.push({ productId: item.productId, batchId: alloc.batchId, quantity: alloc.quantity, price: item.price });
          }
        } else {
          documentItemsData.push({ productId: item.productId, batchId: null, quantity: item.quantity, price: item.price });
        }
      }

      for (const item of dishItems) {
        documentItemsData.push({ productId: item.productId, batchId: null, quantity: item.quantity, price: item.price });
      }

      if (customer) {
        const newBalance = customer.loyaltyPoints - redemptionAmount + pointsEarned;
        otherUpdates.push(tx.counterparty.update({ where: { id: customer.id }, data: { loyaltyPoints: newBalance } }));
      }

      // Document is created before the stock movements so each ledger row can
      // reference it — if a shortage were found it would have thrown already,
      // so by this point the transaction is committing regardless.
      const document = await tx.document.create({
        data: {
          companyId: req.posCompanyId!,
          locationId: b.locationId,
          type: 'sale',
          status: 'confirmed',
          paymentMethod: b.paymentMethod,
          discountType: discount?.type,
          discountValue: discount?.value,
          counterpartyId: customer?.id,
          pointsEarned: customer ? pointsEarned : undefined,
          pointsRedeemed: customer ? redemptionAmount : undefined,
          createdBy: req.posUserId!,
          items: { create: documentItemsData },
        },
        include: { items: true },
      });

      const stockMovements: Promise<unknown>[] = [...otherUpdates];
      for (const item of plainItems) {
        const stock = stockByProduct.get(item.productId)!;
        stockMovements.push(applyStockDelta(tx, stock, -item.quantity, 'sale', document.id));
      }
      for (const consumption of ingredientConsumption) {
        const stock = ingredientStockByProduct.get(consumption.ingredientId)!;
        stockMovements.push(applyStockDelta(tx, stock, -consumption.quantity, 'sale', document.id));
      }
      await Promise.all(stockMovements);

      return document;
    }, { timeout: 15000 });

    res.status(201).json({
      id: document.id,
      createdAt: document.createdAt.toISOString(),
      discountAmount,
      pointsRedeemed: redemptionAmount,
      pointsEarned,
      total: finalTotal,
      customerPoints: customer ? customer.loyaltyPoints - redemptionAmount + pointsEarned : null,
    });
  } catch (err) {
    if (err instanceof StockError) {
      res.status(409).json({ error: 'Недостаточно товара на складе', shortages: err.shortages });
      return;
    }
    throw err;
  }
});

posRouter.get('/customers', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const phone = typeof req.query.phone === 'string' ? req.query.phone.trim() : '';
  if (!phone) {
    res.status(400).json({ error: 'Укажите телефон клиента' });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('retail')) {
    res.status(403).json({ error: 'Программа лояльности недоступна на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const customer = await prisma.counterparty.findFirst({ where: { companyId: req.posCompanyId, phone, type: 'customer' } });
  res.json({ found: !!customer, name: customer?.name ?? null, loyaltyPoints: customer?.loyaltyPoints ?? 0 });
});

posRouter.post('/shifts', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const openingCash = Number(b.openingCash);
  if (!b.locationId || !Number.isFinite(openingCash) || openingCash < 0) {
    res.status(400).json({ error: 'Некорректные данные смены' });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.posUserId } });

  const shift = await prisma.shift.create({
    data: {
      companyId: req.posCompanyId!,
      locationId: b.locationId,
      cashierName: user?.name ?? 'Кассир',
      openedAt: new Date(),
      openingCash,
    },
  });

  res.status(201).json({ id: shift.id, openedAt: shift.openedAt.toISOString() });
});

posRouter.patch('/shifts/:id/close', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const closingCashCounted = Number(b.closingCashCounted);
  if (!Number.isFinite(closingCashCounted) || closingCashCounted < 0) {
    res.status(400).json({ error: 'Введите пересчитанную сумму' });
    return;
  }

  const shift = await prisma.shift.findFirst({ where: { id: req.params.id, companyId: req.posCompanyId } });
  if (!shift) {
    res.status(404).json({ error: 'Смена не найдена' });
    return;
  }

  const closed = await prisma.shift.update({
    where: { id: shift.id },
    data: { closedAt: new Date(), closingCashCounted },
  });

  res.json({ id: closed.id, closedAt: closed.closedAt?.toISOString() });
});

posRouter.get('/push/vapid-public-key', requirePosAuth, (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

posRouter.post('/push/subscribe', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint : '';
  const p256dh = typeof b.keys?.p256dh === 'string' ? b.keys.p256dh : '';
  const auth = typeof b.keys?.auth === 'string' ? b.keys.auth : '';
  if (!endpoint || !p256dh || !auth) {
    res.status(400).json({ error: 'Некорректная подписка на уведомления' });
    return;
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { p256dh, auth, companyId: req.posCompanyId!, userId: req.posUserId },
    create: { endpoint, p256dh, auth, companyId: req.posCompanyId!, userId: req.posUserId },
  });

  res.status(201).json({ ok: true });
});

posRouter.post('/push/unsubscribe', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint : '';
  if (!endpoint) {
    res.status(400).json({ error: 'Укажите endpoint подписки' });
    return;
  }

  await prisma.pushSubscription.deleteMany({ where: { endpoint, companyId: req.posCompanyId } });
  res.json({ ok: true });
});

posRouter.get('/reports', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true, users: true },
  });

  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  const state = tariffState(company?.tariff ?? null);
  if (!modules.includes('terminal')) {
    res.status(403).json({ error: 'Отчёты недоступны на вашем тарифе' });
    return;
  }
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const from = req.query.from ? new Date(String(req.query.from)) : defaultFrom;
  const to = req.query.to ? new Date(String(req.query.to)) : now;

  const documents = await prisma.document.findMany({
    where: {
      companyId: req.posCompanyId,
      type: 'sale',
      status: 'confirmed',
      createdAt: { gte: from, lte: to },
    },
    include: { items: { include: { product: true } } },
  });

  const sales: SaleRecord[] = documents.map((d) => {
    const subtotal = d.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0);
    const discount: { type: DiscountType; value: number } | null =
      d.discountType === 'percent' || d.discountType === 'fixed'
        ? { type: d.discountType, value: d.discountValue ?? 0 }
        : null;
    return {
      id: d.id,
      createdAt: d.createdAt,
      paymentMethod: d.paymentMethod,
      createdBy: d.createdBy,
      discountAmount: computeDiscount(subtotal, discount).discountAmount,
      pointsRedeemed: d.pointsRedeemed ?? undefined,
      pointsEarned: d.pointsEarned ?? undefined,
      items: d.items.map((it) => ({
        productId: it.productId,
        name: it.product.name,
        quantity: it.quantity,
        price: it.price,
      })),
    };
  });

  const nameByUserId = new Map((company?.users ?? []).map((u) => [u.id, u.name]));

  const location = company?.locations[0];
  const stockRows = location
    ? await prisma.stock.findMany({ where: { locationId: location.id }, include: { product: true } })
    : [];
  const stockForLowCheck = stockRows.map((s) => ({ productId: s.productId, name: s.product.name, quantity: s.quantity }));

  const dishCostByProductId = new Map<string, number>();
  if (modules.includes('restaurant')) {
    const soldProductIds = [...new Set(documents.flatMap((d) => d.items.map((it) => it.productId)))];
    const recipes = await prisma.recipe.findMany({
      where: { productId: { in: soldProductIds } },
      include: { ingredients: true },
    });
    const ingredientIds = [...new Set(recipes.flatMap((r) => r.ingredients.map((i) => i.ingredientId)))];
    const ingredientProducts = await prisma.product.findMany({ where: { id: { in: ingredientIds } } });
    const purchasePriceByIngredientId = new Map(ingredientProducts.map((p) => [p.id, p.purchasePrice]));
    for (const recipe of recipes) {
      const cost = computeDishCost(
        recipe.ingredients.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity })),
        purchasePriceByIngredientId,
      );
      dishCostByProductId.set(recipe.productId, cost);
    }
  }

  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    foodCost: buildFoodCost(sales, dishCostByProductId),
    summary: buildSummary(sales),
    topProducts: buildTopProducts(sales, 10),
    byCashier: buildCashierBreakdown(sales, nameByUserId),
    lowStock: findLowStock(stockForLowCheck, 10),
  });
});

posRouter.get('/stock-movements', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });

  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('terminal')) {
    res.status(403).json({ error: 'История склада недоступна на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationIds = (company?.locations ?? []).map((l) => l.id);
  const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined;

  const movements = await prisma.stockMovement.findMany({
    where: { locationId: { in: locationIds }, ...(productId ? { productId } : {}) },
    include: { product: true, location: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json(
    movements.map((m) => ({
      id: m.id,
      productId: m.productId,
      productName: m.product.name,
      locationName: m.location.name,
      quantity: m.quantity,
      reason: m.reason,
      documentId: m.documentId,
      createdAt: m.createdAt.toISOString(),
    })),
  );
});

posRouter.patch('/products/:id/stop-list', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  if (typeof b.stopListed !== 'boolean') {
    res.status(400).json({ error: 'Некорректные данные' });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('restaurant')) {
    res.status(403).json({ error: 'Стоп-лист недоступен на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const product = await prisma.product.findFirst({ where: { id: req.params.id, companyId: req.posCompanyId } });
  if (!product) {
    res.status(404).json({ error: 'Товар не найден' });
    return;
  }

  const updated = await prisma.product.update({ where: { id: product.id }, data: { stopListed: b.stopListed } });
  res.json({ id: updated.id, stopListed: updated.stopListed });
});

// Owner-facing self-service product management — separate from the
// superadmin CRUD in apps/admin (companies.ts). Only 'owner'/'manager' can
// touch it; a cashier PIN gets 403. "Delete" in the UI is a soft hide via
// sellable=false, the same flag /pos/login already filters the sale grid on
// — nothing else references it, so hiding a product never breaks a
// historical Stock/DocumentItem row the way a real delete could.
async function requireOwnerOrManager(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role === 'owner' || user?.role === 'manager';
}

function serializePosProduct(
  p: {
    id: string;
    name: string;
    category: string | null;
    unit: string;
    barcode: string | null;
    purchasePrice: number;
    salePrice: number;
    sellable: boolean;
    stopListed: boolean;
  },
  isIngredient = false,
) {
  return {
    id: p.id,
    name: p.name,
    category: p.category ?? '',
    unit: p.unit,
    barcode: p.barcode ?? '',
    purchasePrice: p.purchasePrice,
    salePrice: p.salePrice,
    sellable: p.sellable,
    stopListed: p.stopListed,
    isIngredient,
  };
}

posRouter.get('/products', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Доступно только владельцу и менеджеру' });
    return;
  }

  // Recipe ingredients (e.g. "Сыр моцарелла" used inside a pizza recipe)
  // live in the same Product table as sellable dishes, with sellable=false
  // by design. Flag them so the UI can label them "Ингредиент" instead of
  // the ambiguous "Скрыт", which otherwise reads as if an owner accidentally
  // hid a menu item.
  const [products, ingredientLinks] = await Promise.all([
    prisma.product.findMany({
      where: { companyId: req.posCompanyId, parentProductId: null },
      orderBy: { name: 'asc' },
    }),
    prisma.recipeIngredient.findMany({
      where: { ingredient: { companyId: req.posCompanyId } },
      select: { ingredientId: true },
    }),
  ]);
  const ingredientIds = new Set(ingredientLinks.map((l) => l.ingredientId));
  res.json(products.map((p) => serializePosProduct(p, ingredientIds.has(p.id))));
});

posRouter.post('/products', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Доступно только владельцу и менеджеру' });
    return;
  }

  const b = req.body ?? {};
  const purchasePrice = Number(b.purchasePrice);
  const salePrice = Number(b.salePrice);
  if (!b.name || !b.unit || !Number.isFinite(purchasePrice) || !Number.isFinite(salePrice) || purchasePrice < 0 || salePrice < 0) {
    res.status(400).json({ error: 'Заполните название, единицу измерения и цены' });
    return;
  }

  const product = await prisma.product.create({
    data: {
      companyId: req.posCompanyId!,
      name: b.name,
      category: b.category || null,
      unit: b.unit,
      barcode: b.barcode || null,
      purchasePrice,
      salePrice,
      sellable: b.sellable !== false,
    },
  });
  res.status(201).json(serializePosProduct(product));
});

posRouter.patch('/products/:id', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Доступно только владельцу и менеджеру' });
    return;
  }

  const b = req.body ?? {};
  const existing = await prisma.product.findFirst({ where: { id: req.params.id, companyId: req.posCompanyId } });
  if (!existing) {
    res.status(404).json({ error: 'Товар не найден' });
    return;
  }

  const purchasePrice = Number(b.purchasePrice);
  const salePrice = Number(b.salePrice);
  if (!b.name || !b.unit || !Number.isFinite(purchasePrice) || !Number.isFinite(salePrice) || purchasePrice < 0 || salePrice < 0) {
    res.status(400).json({ error: 'Заполните название, единицу измерения и цены' });
    return;
  }

  const product = await prisma.product.update({
    where: { id: existing.id },
    data: {
      name: b.name,
      category: b.category || null,
      unit: b.unit,
      barcode: b.barcode || null,
      purchasePrice,
      salePrice,
      sellable: !!b.sellable,
    },
  });
  res.json(serializePosProduct(product));
});

posRouter.get('/batches', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });

  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('pharmacy')) {
    res.status(403).json({ error: 'Партии недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const location = company?.locations[0];
  const batches = location
    ? await prisma.productBatch.findMany({
        where: { locationId: location.id },
        include: { product: true },
        orderBy: { expiryDate: 'asc' },
      })
    : [];

  const now = new Date();
  res.json(
    batches.map((batch) => ({
      id: batch.id,
      productId: batch.productId,
      productName: batch.product.name,
      unit: batch.product.unit,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate.toISOString(),
      quantity: batch.quantity,
      status: classifyExpiry(batch.expiryDate, now),
    })),
  );
});

posRouter.post('/batches', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const quantity = Number(b.quantity);
  const batchNumber = typeof b.batchNumber === 'string' ? b.batchNumber.trim() : '';
  const expiryDate = b.expiryDate ? new Date(b.expiryDate) : null;

  if (!b.productId || !batchNumber || !Number.isFinite(quantity) || quantity <= 0 || !expiryDate || Number.isNaN(expiryDate.getTime())) {
    res.status(400).json({ error: 'Некорректные данные партии' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('pharmacy')) {
    res.status(403).json({ error: 'Партии недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const product = await prisma.product.findFirst({ where: { id: b.productId, companyId: req.posCompanyId } });
  if (!product) {
    res.status(404).json({ error: 'Товар не найден' });
    return;
  }

  const location = company?.locations[0];
  if (!location) {
    res.status(400).json({ error: 'У компании не настроена точка' });
    return;
  }

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.productBatch.create({
      data: { productId: product.id, locationId: location.id, batchNumber, expiryDate, quantity },
    });

    const stock = await tx.stock.findFirst({ where: { productId: product.id, locationId: location.id, binLocation: null } });
    if (stock) {
      await applyStockDelta(tx, stock, quantity, 'batch_receipt');
    } else {
      await createStockWithMovement(tx, { productId: product.id, locationId: location.id, quantity, reason: 'batch_receipt' });
    }

    return created;
  });

  res.status(201).json({ id: batch.id, createdAt: batch.createdAt.toISOString() });
});

posRouter.get('/orders', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const orders = await prisma.document.findMany({
    where: { companyId: req.posCompanyId, type: 'order' },
    include: { items: { include: { product: true } }, counterparty: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(
    orders.map((o) => ({
      id: o.id,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      fulfilledAt: o.fulfilledAt ? o.fulfilledAt.toISOString() : null,
      customerName: o.counterparty?.name ?? 'Клиент',
      customerPhone: o.counterparty?.phone ?? '',
      deliveryAddress: o.deliveryAddress ?? '',
      items: o.items.map((it) => ({
        productId: it.productId,
        name: it.product.name,
        quantity: it.quantity,
        price: it.price,
      })),
      total: o.items.reduce((sum, it) => sum + it.price * it.quantity, 0),
    })),
  );
});

posRouter.post('/orders/:id/fulfill', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const order = await prisma.document.findFirst({
    where: { id: req.params.id, companyId: req.posCompanyId, type: 'order' },
    include: { items: true },
  });
  if (!order) {
    res.status(404).json({ error: 'Заказ не найден' });
    return;
  }
  if (order.status !== 'pending') {
    res.status(409).json({ error: 'Заказ уже обработан' });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const stockRows = await tx.stock.findMany({
        where: { locationId: order.locationId, productId: { in: order.items.map((it) => it.productId) } },
      });
      const stockByProduct = new Map(stockRows.map((s) => [s.productId, s]));
      const quantityByProduct = new Map(stockRows.map((s) => [s.productId, s.quantity]));

      const shortages = findStockShortages(
        order.items.map((it) => ({ productId: it.productId, quantity: it.quantity, price: it.price })),
        quantityByProduct,
      );
      if (shortages.length > 0) {
        throw new StockError(shortages);
      }

      await Promise.all(
        order.items.map((item) => {
          const stock = stockByProduct.get(item.productId)!;
          return applyStockDelta(tx, stock, -item.quantity, 'order_fulfill', order.id);
        }),
      );

      await tx.document.update({
        where: { id: order.id },
        data: { status: 'confirmed', fulfilledBy: req.posUserId, fulfilledAt: new Date() },
      });
    }, { timeout: 15000 });

    res.json({ id: order.id, status: 'confirmed' });
  } catch (err) {
    if (err instanceof StockError) {
      res.status(409).json({ error: 'Недостаточно товара на складе', shortages: err.shortages });
      return;
    }
    throw err;
  }
});

posRouter.post('/orders/:id/reject', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const order = await prisma.document.findFirst({ where: { id: req.params.id, companyId: req.posCompanyId, type: 'order' } });
  if (!order) {
    res.status(404).json({ error: 'Заказ не найден' });
    return;
  }
  if (order.status !== 'pending') {
    res.status(409).json({ error: 'Заказ уже обработан' });
    return;
  }

  await prisma.document.update({
    where: { id: order.id },
    data: { status: 'cancelled', fulfilledBy: req.posUserId, fulfilledAt: new Date() },
  });

  res.json({ id: order.id, status: 'cancelled' });
});

posRouter.get('/transfers', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Перемещения недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const transfers = await prisma.document.findMany({
    where: { companyId: req.posCompanyId, type: 'transfer' },
    include: { items: { include: { product: true } }, location: true, toLocation: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(
    transfers.map((t) => ({
      id: t.id,
      createdAt: t.createdAt.toISOString(),
      fromLocationName: t.location.name,
      toLocationName: t.toLocation?.name ?? '—',
      items: t.items.map((it) => ({ productId: it.productId, name: it.product.name, quantity: it.quantity })),
    })),
  );
});

posRouter.post('/transfers', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const items: { productId: string; quantity: number }[] = Array.isArray(b.items) ? b.items : [];
  if (items.length === 0 || !b.toLocationId) {
    res.status(400).json({ error: 'Некорректные данные перемещения' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Перемещения недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const fromLocation = company?.locations[0];
  if (!fromLocation) {
    res.status(400).json({ error: 'У компании не настроена точка' });
    return;
  }
  if (b.toLocationId === fromLocation.id) {
    res.status(400).json({ error: 'Точка назначения совпадает с текущей точкой' });
    return;
  }
  const toLocation = company?.locations.find((l) => l.id === b.toLocationId);
  if (!toLocation) {
    res.status(404).json({ error: 'Точка назначения не найдена' });
    return;
  }

  try {
    const document = await prisma.$transaction(async (tx) => {
      const [sourceStockRows, destStockRows] = await Promise.all([
        tx.stock.findMany({ where: { locationId: fromLocation.id, productId: { in: items.map((it) => it.productId) } } }),
        tx.stock.findMany({ where: { locationId: toLocation.id, productId: { in: items.map((it) => it.productId) } } }),
      ]);
      const sourceStockByProduct = new Map(sourceStockRows.map((s) => [s.productId, s]));
      const destStockByProduct = new Map(destStockRows.map((s) => [s.productId, s]));
      const quantityByProduct = new Map(sourceStockRows.map((s) => [s.productId, s.quantity]));

      const shortages = findStockShortages(
        items.map((it) => ({ productId: it.productId, quantity: it.quantity, price: 0 })),
        quantityByProduct,
      );
      if (shortages.length > 0) {
        throw new StockError(shortages);
      }

      const document = await tx.document.create({
        data: {
          companyId: req.posCompanyId!,
          locationId: fromLocation.id,
          toLocationId: toLocation.id,
          type: 'transfer',
          status: 'confirmed',
          createdBy: req.posUserId!,
          items: { create: items.map((it) => ({ productId: it.productId, quantity: it.quantity, price: 0 })) },
        },
        include: { items: true },
      });

      const updates: Promise<unknown>[] = [];
      for (const item of items) {
        const source = sourceStockByProduct.get(item.productId)!;
        updates.push(applyStockDelta(tx, source, -item.quantity, 'transfer_out', document.id));

        const dest = destStockByProduct.get(item.productId);
        if (dest) {
          updates.push(applyStockDelta(tx, dest, item.quantity, 'transfer_in', document.id));
        } else {
          updates.push(
            createStockWithMovement(tx, {
              productId: item.productId,
              locationId: toLocation.id,
              quantity: item.quantity,
              reason: 'transfer_in',
              documentId: document.id,
            }),
          );
        }
      }
      await Promise.all(updates);

      return document;
    }, { timeout: 15000 });

    res.status(201).json({ id: document.id, createdAt: document.createdAt.toISOString() });
  } catch (err) {
    if (err instanceof StockError) {
      res.status(409).json({ error: 'Недостаточно товара на складе', shortages: err.shortages });
      return;
    }
    throw err;
  }
});

posRouter.get('/receipts', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Приёмка недоступна на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const receipts = await prisma.document.findMany({
    where: { companyId: req.posCompanyId, type: 'receipt' },
    include: { items: { include: { product: true } }, counterparty: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(
    receipts.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      supplierName: r.counterparty?.name ?? null,
      items: r.items.map((it) => ({ productId: it.productId, name: it.product.name, quantity: it.quantity, price: it.price })),
    })),
  );
});

posRouter.post('/receipts', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const items: { productId: string; quantity: number; price: number }[] = Array.isArray(b.items) ? b.items : [];
  if (items.length === 0) {
    res.status(400).json({ error: 'Некорректные данные приёмки' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Приёмка недоступна на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const location = company?.locations[0];
  if (!location) {
    res.status(400).json({ error: 'У компании не настроена точка' });
    return;
  }

  const supplierName = typeof b.supplierName === 'string' ? b.supplierName.trim() : '';
  const supplierPhone = typeof b.supplierPhone === 'string' ? b.supplierPhone.trim() : '';

  let counterpartyId: string | undefined;
  if (supplierName) {
    let counterparty = supplierPhone
      ? await prisma.counterparty.findFirst({ where: { companyId: req.posCompanyId, phone: supplierPhone, type: 'supplier' } })
      : null;
    if (!counterparty) {
      counterparty = await prisma.counterparty.create({
        data: { companyId: req.posCompanyId!, name: supplierName, phone: supplierPhone || null, type: 'supplier' },
      });
    }
    counterpartyId = counterparty.id;
  }

  const document = await prisma.$transaction(async (tx) => {
    const stockRows = await tx.stock.findMany({
      where: { locationId: location.id, productId: { in: items.map((it) => it.productId) } },
    });
    const stockByProduct = new Map(stockRows.map((s) => [s.productId, s]));

    const document = await tx.document.create({
      data: {
        companyId: req.posCompanyId!,
        locationId: location.id,
        type: 'receipt',
        status: 'confirmed',
        counterpartyId,
        createdBy: req.posUserId!,
        items: { create: items.map((it) => ({ productId: it.productId, quantity: it.quantity, price: it.price ?? 0 })) },
      },
      include: { items: true },
    });

    const updates: Promise<unknown>[] = [];
    for (const item of items) {
      const existing = stockByProduct.get(item.productId);
      if (existing) {
        updates.push(applyStockDelta(tx, existing, item.quantity, 'receipt', document.id));
      } else {
        updates.push(
          createStockWithMovement(tx, {
            productId: item.productId,
            locationId: location.id,
            quantity: item.quantity,
            reason: 'receipt',
            documentId: document.id,
          }),
        );
      }
    }
    await Promise.all(updates);

    return document;
  }, { timeout: 15000 });

  res.status(201).json({ id: document.id, createdAt: document.createdAt.toISOString() });
});

posRouter.get('/counts', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Инвентаризация недоступна на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const counts = await prisma.document.findMany({
    where: { companyId: req.posCompanyId, type: 'adjustment' },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(
    counts.map((c) => ({
      id: c.id,
      createdAt: c.createdAt.toISOString(),
      items: c.items.map((it) => ({ productId: it.productId, name: it.product.name, delta: it.quantity })),
    })),
  );
});

posRouter.post('/counts', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const items: { productId: string; countedQuantity: number }[] = Array.isArray(b.items) ? b.items : [];
  if (items.length === 0) {
    res.status(400).json({ error: 'Некорректные данные инвентаризации' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Инвентаризация недоступна на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const location = company?.locations[0];
  if (!location) {
    res.status(400).json({ error: 'У компании не настроена точка' });
    return;
  }

  const document = await prisma.$transaction(async (tx) => {
    const stockRows = await tx.stock.findMany({
      where: { locationId: location.id, productId: { in: items.map((it) => it.productId) } },
    });
    const stockByProduct = new Map(stockRows.map((s) => [s.productId, s]));
    const quantityByProduct = new Map(stockRows.map((s) => [s.productId, s.quantity]));

    const adjustments = computeCountAdjustments(items, quantityByProduct);

    const document = await tx.document.create({
      data: {
        companyId: req.posCompanyId!,
        locationId: location.id,
        type: 'adjustment',
        status: 'confirmed',
        createdBy: req.posUserId!,
        items: { create: adjustments.map((a) => ({ productId: a.productId, quantity: a.delta, price: 0 })) },
      },
      include: { items: true },
    });

    const updates: Promise<unknown>[] = [];
    for (const adj of adjustments) {
      const existing = stockByProduct.get(adj.productId);
      if (existing) {
        updates.push(applyStockDelta(tx, existing, adj.delta, 'adjustment', document.id));
      } else if (adj.countedQuantity > 0) {
        updates.push(
          createStockWithMovement(tx, {
            productId: adj.productId,
            locationId: location.id,
            quantity: adj.countedQuantity,
            reason: 'adjustment',
            documentId: document.id,
          }),
        );
      }
    }
    await Promise.all(updates);

    return document;
  }, { timeout: 15000 });

  res.status(201).json({ id: document.id, createdAt: document.createdAt.toISOString() });
});

posRouter.get('/production/recipes', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Производство недоступно на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const recipes = await prisma.recipe.findMany({
    where: { product: { companyId: req.posCompanyId } },
    include: { product: true, ingredients: { include: { ingredient: true } } },
  });

  res.json(
    recipes.map((r) => ({
      productId: r.productId,
      productName: r.product.name,
      portionYield: r.portionYield,
      ingredients: r.ingredients.map((i) => ({ ingredientId: i.ingredientId, name: i.ingredient.name, quantity: i.quantity })),
    })),
  );
});

posRouter.get('/production', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Производство недоступно на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const runs = await prisma.document.findMany({
    where: { companyId: req.posCompanyId, type: 'production' },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(
    runs.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      items: r.items.map((it) => ({ productId: it.productId, name: it.product.name, quantity: it.quantity })),
    })),
  );
});

posRouter.post('/production', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const quantity = Number(b.quantity);
  if (!b.productId || !Number.isFinite(quantity) || quantity <= 0) {
    res.status(400).json({ error: 'Некорректные данные производства' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Производство недоступно на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const location = company?.locations[0];
  if (!location) {
    res.status(400).json({ error: 'У компании не настроена точка' });
    return;
  }

  const recipe = await prisma.recipe.findFirst({
    where: { productId: b.productId, product: { companyId: req.posCompanyId } },
    include: { ingredients: true },
  });
  if (!recipe) {
    res.status(404).json({ error: 'Спецификация не найдена для этого товара' });
    return;
  }

  const { batches, yieldQuantity, ingredients } = computeProduction(
    quantity,
    recipe.portionYield,
    recipe.ingredients.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity })),
  );
  if (batches === 0) {
    res.status(400).json({ error: 'Некорректное количество для производства' });
    return;
  }

  try {
    const document = await prisma.$transaction(async (tx) => {
      const [ingredientStockRows, finishedStockRows] = await Promise.all([
        tx.stock.findMany({ where: { locationId: location.id, productId: { in: ingredients.map((i) => i.ingredientId) } } }),
        tx.stock.findMany({ where: { locationId: location.id, productId: recipe.productId } }),
      ]);
      const ingredientStockByProduct = new Map(ingredientStockRows.map((s) => [s.productId, s]));
      const ingredientQuantityByProduct = new Map(ingredientStockRows.map((s) => [s.productId, s.quantity]));

      const shortages = findStockShortages(
        ingredients.map((i) => ({ productId: i.ingredientId, quantity: i.quantity, price: 0 })),
        ingredientQuantityByProduct,
      );
      if (shortages.length > 0) {
        throw new StockError(shortages);
      }

      const document = await tx.document.create({
        data: {
          companyId: req.posCompanyId!,
          locationId: location.id,
          type: 'production',
          status: 'confirmed',
          createdBy: req.posUserId!,
          items: {
            create: [
              { productId: recipe.productId, quantity: yieldQuantity, price: 0 },
              ...ingredients.map((i) => ({ productId: i.ingredientId, quantity: -i.quantity, price: 0 })),
            ],
          },
        },
        include: { items: true },
      });

      const updates: Promise<unknown>[] = [];
      for (const ing of ingredients) {
        const stock = ingredientStockByProduct.get(ing.ingredientId)!;
        updates.push(applyStockDelta(tx, stock, -ing.quantity, 'production_out', document.id));
      }

      const finishedStock = finishedStockRows[0];
      if (finishedStock) {
        updates.push(applyStockDelta(tx, finishedStock, yieldQuantity, 'production_in', document.id));
      } else {
        updates.push(
          createStockWithMovement(tx, {
            productId: recipe.productId,
            locationId: location.id,
            quantity: yieldQuantity,
            reason: 'production_in',
            documentId: document.id,
          }),
        );
      }
      await Promise.all(updates);

      return document;
    }, { timeout: 15000 });

    res.status(201).json({ id: document.id, createdAt: document.createdAt.toISOString(), batches, yieldQuantity });
  } catch (err) {
    if (err instanceof StockError) {
      res.status(409).json({ error: 'Недостаточно сырья на складе', shortages: err.shortages });
      return;
    }
    throw err;
  }
});

// Restaurant Pack: floor plan + KDS. A table's occupied/free state mirrors
// whether it has an open (type='sale', status='open') Document — items are
// deducted from stock/ingredients as soon as they're sent to the kitchen, not
// when the table finally pays, since the kitchen has to cook them regardless
// of payment timing. Split bills and per-item pricing overrides are out of
// scope for this first cut — one table, one open document, one payment.
posRouter.get('/tables', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('restaurant')) {
    res.status(403).json({ error: 'Столики недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const tables = await prisma.table.findMany({
    where: { companyId: req.posCompanyId },
    include: { documents: { where: { type: 'sale', status: 'open' }, include: { items: true } } },
    orderBy: { name: 'asc' },
  });

  res.json(
    tables.map((t) => {
      const openOrder = t.documents[0];
      const total = openOrder ? openOrder.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0) : 0;
      return {
        id: t.id,
        name: t.name,
        seats: t.seats,
        status: t.status,
        orderId: openOrder?.id ?? null,
        itemCount: openOrder ? openOrder.items.length : 0,
        total,
      };
    }),
  );
});

posRouter.post('/tables', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const seats = Number(b.seats);
  if (!name || !Number.isFinite(seats) || seats <= 0) {
    res.status(400).json({ error: 'Укажите название и число мест' });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true, locations: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('restaurant')) {
    res.status(403).json({ error: 'Столики недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }
  const location = company?.locations[0];
  if (!location) {
    res.status(400).json({ error: 'У компании не настроена точка' });
    return;
  }

  const table = await prisma.table.create({
    data: { companyId: req.posCompanyId!, locationId: location.id, name, seats },
  });
  res.status(201).json({ id: table.id, name: table.name, seats: table.seats, status: table.status, orderId: null, itemCount: 0, total: 0 });
});

posRouter.get('/tables/:id/order', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('restaurant')) {
    res.status(403).json({ error: 'Столики недоступны на вашем тарифе' });
    return;
  }

  const table = await prisma.table.findFirst({ where: { id: req.params.id, companyId: req.posCompanyId } });
  if (!table) {
    res.status(404).json({ error: 'Стол не найден' });
    return;
  }

  const document = await prisma.document.findFirst({
    where: { tableId: table.id, type: 'sale', status: 'open' },
    include: { items: { include: { product: true } } },
  });

  if (!document) {
    res.json({ id: null, items: [], total: 0 });
    return;
  }

  res.json({
    id: document.id,
    items: document.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      name: it.product.name,
      quantity: it.quantity,
      price: it.price,
      kitchenStatus: it.kitchenStatus,
    })),
    total: document.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0),
  });
});

posRouter.post('/tables/:id/order', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const items: SaleItemInput[] = Array.isArray(b.items) ? b.items : [];
  if (items.length === 0) {
    res.status(400).json({ error: 'Добавьте блюда в заказ' });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true, locations: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('restaurant')) {
    res.status(403).json({ error: 'Столики недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const table = await prisma.table.findFirst({ where: { id: req.params.id, companyId: req.posCompanyId } });
  if (!table) {
    res.status(404).json({ error: 'Стол не найден' });
    return;
  }
  const location = company?.locations[0];
  if (!location) {
    res.status(400).json({ error: 'У компании не настроена точка' });
    return;
  }

  try {
    const document = await prisma.$transaction(async (tx) => {
      // Dishes (recipe-tracked products) consume ingredients; everything else
      // consumes its own stock — same split as /pos/sales, minus FEFO/batch
      // handling, which restaurant menus don't use.
      const recipes = await tx.recipe.findMany({
        where: { productId: { in: items.map((it) => it.productId) } },
        include: { ingredients: true },
      });
      const recipeIngredientsByProductId = new Map(
        recipes.map((r) => [r.productId, r.ingredients.map((ing) => ({ ingredientId: ing.ingredientId, quantity: ing.quantity }))]),
      );
      const dishProductIds = new Set(recipeIngredientsByProductId.keys());
      const plainItems = items.filter((it) => !dishProductIds.has(it.productId));
      const dishItems = items.filter((it) => dishProductIds.has(it.productId));

      const ingredientConsumption = computeIngredientConsumption(
        dishItems.map((it) => ({ productId: it.productId, quantity: it.quantity })),
        recipeIngredientsByProductId,
      );
      const ingredientIds = ingredientConsumption.map((c) => c.ingredientId);

      const [stockRows, ingredientStockRows] = await Promise.all([
        tx.stock.findMany({ where: { locationId: location.id, productId: { in: plainItems.map((it) => it.productId) } } }),
        tx.stock.findMany({ where: { locationId: location.id, productId: { in: ingredientIds } } }),
      ]);
      const stockByProduct = new Map(stockRows.map((s) => [s.productId, s]));
      const quantityByProduct = new Map(stockRows.map((s) => [s.productId, s.quantity]));
      const ingredientStockByProduct = new Map(ingredientStockRows.map((s) => [s.productId, s]));
      const ingredientQuantityByProduct = new Map(ingredientStockRows.map((s) => [s.productId, s.quantity]));

      const shortages = [
        ...findStockShortages(plainItems, quantityByProduct),
        ...findStockShortages(
          ingredientConsumption.map((c) => ({ productId: c.ingredientId, quantity: c.quantity, price: 0 })),
          ingredientQuantityByProduct,
        ),
      ];
      if (shortages.length > 0) {
        throw new StockError(shortages);
      }

      const itemsData = items.map((it) => ({ productId: it.productId, quantity: it.quantity, price: it.price, kitchenStatus: 'pending' }));

      let openDocument = await tx.document.findFirst({ where: { tableId: table.id, type: 'sale', status: 'open' } });
      if (openDocument) {
        await tx.documentItem.createMany({ data: itemsData.map((d) => ({ ...d, documentId: openDocument!.id })) });
      } else {
        openDocument = await tx.document.create({
          data: {
            companyId: req.posCompanyId!,
            locationId: location.id,
            type: 'sale',
            status: 'open',
            tableId: table.id,
            createdBy: req.posUserId!,
            items: { create: itemsData },
          },
        });
        await tx.table.update({ where: { id: table.id }, data: { status: 'occupied' } });
      }

      const updates: Promise<unknown>[] = [];
      for (const item of plainItems) {
        const stock = stockByProduct.get(item.productId)!;
        updates.push(applyStockDelta(tx, stock, -item.quantity, 'table_order', openDocument.id));
      }
      for (const consumption of ingredientConsumption) {
        const stock = ingredientStockByProduct.get(consumption.ingredientId)!;
        updates.push(applyStockDelta(tx, stock, -consumption.quantity, 'table_order', openDocument.id));
      }
      await Promise.all(updates);

      return tx.document.findUniqueOrThrow({ where: { id: openDocument.id }, include: { items: { include: { product: true } } } });
    }, { timeout: 15000 });

    res.status(201).json({
      id: document.id,
      items: document.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        name: it.product.name,
        quantity: it.quantity,
        price: it.price,
        kitchenStatus: it.kitchenStatus,
      })),
      total: document.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0),
    });
  } catch (err) {
    if (err instanceof StockError) {
      res.status(409).json({ error: 'Недостаточно товара на складе', shortages: err.shortages });
      return;
    }
    throw err;
  }
});

posRouter.post('/tables/:id/pay', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  if (!b.paymentMethod) {
    res.status(400).json({ error: 'Укажите способ оплаты' });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('restaurant')) {
    res.status(403).json({ error: 'Столики недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const table = await prisma.table.findFirst({ where: { id: req.params.id, companyId: req.posCompanyId } });
  if (!table) {
    res.status(404).json({ error: 'Стол не найден' });
    return;
  }

  const document = await prisma.document.findFirst({
    where: { tableId: table.id, type: 'sale', status: 'open' },
    include: { items: true },
  });
  if (!document) {
    res.status(409).json({ error: 'На этом столе нет открытого заказа' });
    return;
  }

  const total = document.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0);

  await prisma.$transaction([
    prisma.document.update({ where: { id: document.id }, data: { status: 'confirmed', paymentMethod: b.paymentMethod } }),
    prisma.table.update({ where: { id: table.id }, data: { status: 'free' } }),
  ]);

  res.json({ id: document.id, total, paymentMethod: b.paymentMethod });
});

posRouter.get('/kds', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('restaurant')) {
    res.status(403).json({ error: 'Кухонный экран недоступен на вашем тарифе' });
    return;
  }

  const documents = await prisma.document.findMany({
    where: { companyId: req.posCompanyId, type: 'sale', status: 'open' },
    include: { items: { include: { product: true } }, table: true },
    orderBy: { createdAt: 'asc' },
  });

  const tickets = buildKdsTickets(
    documents.map((d) => ({
      documentId: d.id,
      tableName: d.table?.name ?? '—',
      createdAt: d.createdAt,
      items: d.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        name: it.product.name,
        quantity: it.quantity,
        kitchenStatus: it.kitchenStatus === 'ready' ? 'ready' : 'pending',
      })),
    })),
  );

  res.json(tickets.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })));
});

posRouter.patch('/kds/items/:id', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const kitchenStatus = b.kitchenStatus === 'ready' || b.kitchenStatus === 'pending' ? b.kitchenStatus : null;
  if (!kitchenStatus) {
    res.status(400).json({ error: 'Некорректный статус' });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('restaurant')) {
    res.status(403).json({ error: 'Кухонный экран недоступен на вашем тарифе' });
    return;
  }

  const item = await prisma.documentItem.findFirst({
    where: { id: req.params.id, document: { companyId: req.posCompanyId, type: 'sale', status: 'open' } },
  });
  if (!item) {
    res.status(404).json({ error: 'Позиция не найдена' });
    return;
  }

  const updated = await prisma.documentItem.update({ where: { id: item.id }, data: { kitchenStatus } });
  res.json({ id: updated.id, kitchenStatus: updated.kitchenStatus });
});

class StockError extends Error {
  shortages: StockShortage[];
  constructor(shortages: StockShortage[]) {
    super('Insufficient stock');
    this.shortages = shortages;
  }
}
