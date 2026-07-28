import { Router } from 'express';
import { prisma } from '@anyq/db';
import { signPosToken, requirePosAuth } from '../pos-auth';
import type { PosAuthedRequest } from '../pos-auth';
import { loginRateLimit } from '../rateLimit';
import { tariffState, tariffDenialMessage } from '../tariff';
import { findStockShortages } from '../stock';
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

  res.json({
    token: signPosToken(user.id, user.companyId),
    user: { id: user.id, name: user.name, role: user.role },
    company: { id: user.company.id, name: user.company.name },
    modules,
    locations: user.company.locations.map((l) => ({ id: l.id, name: l.name, type: l.type, address: l.address ?? '' })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.salePrice,
      barcode: p.barcode ?? '',
      category: p.category ?? '',
      stock: dishProductIds.has(p.id) ? 9999 : (stockByProduct.get(p.id) ?? 0),
      stopListed: p.stopListed,
      modifiers: modifiersByProduct.get(p.id) ?? [],
    })),
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
  const subtotal = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
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
      const updates: Promise<unknown>[] = [];

      for (const item of plainItems) {
        const stock = stockByProduct.get(item.productId)!;
        updates.push(tx.stock.update({ where: { id: stock.id }, data: { quantity: stock.quantity - item.quantity } }));

        const productBatches = batchesByProduct.get(item.productId);
        if (productBatches && productBatches.length > 0) {
          const sellableBatches: BatchStock[] = productBatches
            .filter((batch) => batch.expiryDate > now)
            .map((batch) => ({ batchId: batch.id, expiryDate: batch.expiryDate, quantity: batch.quantity }));
          const { allocations } = allocateFefo(item.quantity, sellableBatches);
          for (const alloc of allocations) {
            const batch = productBatches.find((batchRow) => batchRow.id === alloc.batchId)!;
            updates.push(tx.productBatch.update({ where: { id: batch.id }, data: { quantity: batch.quantity - alloc.quantity } }));
            documentItemsData.push({ productId: item.productId, batchId: alloc.batchId, quantity: alloc.quantity, price: item.price });
          }
        } else {
          documentItemsData.push({ productId: item.productId, batchId: null, quantity: item.quantity, price: item.price });
        }
      }

      for (const item of dishItems) {
        documentItemsData.push({ productId: item.productId, batchId: null, quantity: item.quantity, price: item.price });
      }
      for (const consumption of ingredientConsumption) {
        const stock = ingredientStockByProduct.get(consumption.ingredientId)!;
        updates.push(tx.stock.update({ where: { id: stock.id }, data: { quantity: stock.quantity - consumption.quantity } }));
      }

      if (customer) {
        const newBalance = customer.loyaltyPoints - redemptionAmount + pointsEarned;
        updates.push(tx.counterparty.update({ where: { id: customer.id }, data: { loyaltyPoints: newBalance } }));
      }

      await Promise.all(updates);

      return tx.document.create({
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
    const subtotal = d.items.reduce((sum, it) => sum + it.price * it.quantity, 0);
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
      await tx.stock.update({ where: { id: stock.id }, data: { quantity: stock.quantity + quantity } });
    } else {
      await tx.stock.create({ data: { productId: product.id, locationId: location.id, quantity, binLocation: null } });
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
          return tx.stock.update({ where: { id: stock.id }, data: { quantity: stock.quantity - item.quantity } });
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

      const updates: Promise<unknown>[] = [];
      for (const item of items) {
        const source = sourceStockByProduct.get(item.productId)!;
        updates.push(tx.stock.update({ where: { id: source.id }, data: { quantity: source.quantity - item.quantity } }));

        const dest = destStockByProduct.get(item.productId);
        if (dest) {
          updates.push(tx.stock.update({ where: { id: dest.id }, data: { quantity: dest.quantity + item.quantity } }));
        } else {
          updates.push(
            tx.stock.create({ data: { productId: item.productId, locationId: toLocation.id, quantity: item.quantity } }),
          );
        }
      }
      await Promise.all(updates);

      return tx.document.create({
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

    const updates: Promise<unknown>[] = [];
    for (const item of items) {
      const existing = stockByProduct.get(item.productId);
      if (existing) {
        updates.push(tx.stock.update({ where: { id: existing.id }, data: { quantity: existing.quantity + item.quantity } }));
      } else {
        updates.push(tx.stock.create({ data: { productId: item.productId, locationId: location.id, quantity: item.quantity } }));
      }
    }
    await Promise.all(updates);

    return tx.document.create({
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

    const updates: Promise<unknown>[] = [];
    for (const adj of adjustments) {
      const existing = stockByProduct.get(adj.productId);
      if (existing) {
        updates.push(tx.stock.update({ where: { id: existing.id }, data: { quantity: adj.countedQuantity } }));
      } else if (adj.countedQuantity > 0) {
        updates.push(
          tx.stock.create({ data: { productId: adj.productId, locationId: location.id, quantity: adj.countedQuantity } }),
        );
      }
    }
    await Promise.all(updates);

    return tx.document.create({
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
  }, { timeout: 15000 });

  res.status(201).json({ id: document.id, createdAt: document.createdAt.toISOString() });
});

class StockError extends Error {
  shortages: StockShortage[];
  constructor(shortages: StockShortage[]) {
    super('Insufficient stock');
    this.shortages = shortages;
  }
}
