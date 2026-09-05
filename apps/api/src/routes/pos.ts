import { Router } from 'express';
import type { Response } from 'express';
import { prisma } from '@anyq/db';
import { signPosToken, requirePosAuth } from '../pos-auth';
import type { PosAuthedRequest } from '../pos-auth';
import { loginRateLimit } from '../rateLimit';
import { tariffState, tariffDenialMessage } from '../tariff';
import {
  blockStock,
  unblockStock,
  releaseBlockedOnWriteOff,
  findStockShortages,
  hasInvalidQuantity,
  aggregateRequestedQuantities,
  availableQuantity,
  groupStockByProduct,
  totalAvailable,
  totalOnHand,
  totalHeldBack,
  deductAcrossBins,
  applyStockDelta,
  createStockWithMovement,
  decrementBatchQuantity,
  reserveStock,
  releaseStock,
  ConcurrentStockChangeError,
} from '../stock';
import type { SaleItemInput, StockShortage } from '../stock';
import {
  IDEMPOTENCY_HEADER,
  readIdempotencyKey,
  hashRequestBody,
  runIdempotent,
  IdempotencyConflictError,
} from '../idempotency';
import { resolveLocationId, resolveTransferLocations, locationErrorMessage } from '../locations';
import { resolveTransferReceipt, transferReceiptErrorMessage } from '../transfers';
import { resolveReturn, returnErrorMessage } from '../returns';
import { resolvePackagedLines, packagingErrorMessage } from '../packaging';
import { buildDailyClosingBalances, estimateDailyDemand, recommendOrder } from '../replenishment';
import type { DailyMovement } from '../replenishment';
import { buildAverageCost, computeGrossMargin, findDeadStock, flagOutliers, reconcileShiftCash } from '../owner';
import type { CashierActivity, ShiftCash } from '../owner';
import { isValidManualEntry, manualRegistration } from '../fiscal';
import { canTransition, nextStatus, transitionErrorMessage, computeOrderProgress, detectPriceDeviation } from '../purchasing';
import type { PurchaseOrderStatus, OrderedLine } from '../purchasing';
import { isWriteOffReason, resolveWriteOff, writeOffErrorMessage, resolveQuarantine, quarantineErrorMessage } from '../writeoffs';
import type { QuarantineAction } from '../writeoffs';
import { resolveBinAddress, binAddressErrorMessage, validatePutaway, putawayErrorMessage } from '../bins';
import { computeBalance, allocatePayment, buildAging, resolveCreditSale, creditSaleErrorMessage } from '../settlements';
import { reconcileBalances, summarize, mismatchExplanation } from '../reconciliation';
import type { LedgerTotal, CachedQuantity } from '../reconciliation';
import type { Charge } from '../settlements';
import type { SoldLine } from '../returns';
import { buildSummary, buildTopProducts, buildCashierBreakdown, findLowStock, buildFoodCost } from '../reports';
import type { SaleRecord } from '../reports';
import { allocateFefo, classifyExpiry } from '../batches';
import type { BatchStock } from '../batches';
import { computeIngredientConsumption, computeDishCost } from '../recipes';
import { computeCountAdjustments, computeBinCountAdjustments, binCountKey, hasInvalidCountedQuantity } from '../counts';
import type { BinCountLine, BinSystemQuantity } from '../counts';
import { computeDiscount } from '../discounts';
import { findPriceMismatches } from '../pricing';
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

// Resolves the location an operation happens at, and answers the request
// itself when it can't — returning null then, so the caller just stops.
// A location the company doesn't own is a 404 rather than a 400: from the
// caller's side it is a thing that isn't there, and answering "invalid" would
// confirm that some other company's location id exists.
function resolveLocationOrRespond(locations: { id: string }[], requested: unknown, res: Response): string | null {
  const resolution = resolveLocationId(locations, requested);
  if (resolution.status !== 'ok') {
    res.status(resolution.status === 'unknown' ? 404 : 400).json({ error: locationErrorMessage(resolution.status) });
    return null;
  }
  return resolution.locationId;
}

posRouter.post('/login', loginRateLimit, async (req, res) => {
  const { pin } = req.body ?? {};
  if (!pin) {
    res.status(400).json({ error: 'Введите PIN' });
    return;
  }

  const user = await prisma.user.findFirst({
    where: { posPin: pin },
    // Ordered, because an unordered list has no meaningful "first" — Postgres
    // is free to return these in any order, so the location the register
    // defaulted to could change between logins.
    include: { company: { include: { tariff: true, locations: { orderBy: { name: 'asc' } } } } },
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
  // The catalog carries stock, and stock only means something at one location,
  // so the register is told which one these numbers are for. It opens on this
  // location and refetches from /pos/catalog when the user switches.
  const catalogLocationId = user.company.locations[0]?.id ?? null;
  const groupedProducts = await buildPosCatalog(user.companyId, modules, catalogLocationId);

  res.json({
    token: signPosToken(user.id, user.companyId, user.tokenVersion),
    user: { id: user.id, name: user.name, role: user.role },
    company: { id: user.company.id, name: user.company.name, slug: user.company.slug },
    modules,
    locations: user.company.locations.map((l) => ({ id: l.id, name: l.name, type: l.type, address: l.address ?? '' })),
    catalogLocationId,
    products: groupedProducts,
  });
});

// The sale grid for one location. Shared by /pos/login (which opens on the
// company's first location) and /pos/catalog (which reloads it when the user
// switches), so a register can never end up showing one location's stock while
// selling against another's.
async function buildPosCatalog(companyId: string, modules: string[], locationId: string | null) {
  const products = await prisma.product.findMany({ where: { companyId, sellable: true } });
  const stockRows = locationId ? await prisma.stock.findMany({ where: { locationId } }) : [];
  const stockByProduct = new Map<string, number>();
  for (const row of stockRows) {
    // One product can hold stock in several bins at a location; the grid shows
    // what's sellable there in total, not whatever bin sorted last. Sellable
    // means available, not on hand — units held for an open order are on the
    // shelf but already somebody else's.
    stockByProduct.set(row.productId, (stockByProduct.get(row.productId) ?? 0) + availableQuantity(row));
  }

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

  // Sent with the catalog rather than looked up per scan: a register has to
  // read a case barcode with the network down, the same as a unit barcode.
  const packagingRows = await prisma.productPackaging.findMany({
    where: { productId: { in: products.map((p) => p.id) } },
    orderBy: { unitsPerPack: 'asc' },
  });
  const packagingsByProduct = new Map<string, { id: string; name: string; unitsPerPack: number; barcode: string }[]>();
  for (const pack of packagingRows) {
    const list = packagingsByProduct.get(pack.productId) ?? [];
    list.push({ id: pack.id, name: pack.name, unitsPerPack: pack.unitsPerPack, barcode: pack.barcode ?? '' });
    packagingsByProduct.set(pack.productId, list);
  }
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
    packagings: packagingsByProduct.get(p.id) ?? [],
    parentProductId: p.parentProductId,
    variantLabel: p.variantLabel,
  }));

  // Variant grouping only applies for retail-tariff companies — everyone else sees
  // every product (including variant children) as a flat, ungrouped list, which is
  // exactly today's behaviour and stays backward-compatible.
  return modules.includes('retail')
    ? groupProductVariants(productRows).map(({ product, variants }) => ({ ...product, variants }))
    : productRows.map((p) => ({ ...p, variants: [] }));
}

// Reloads the sale grid for another location. A register that switches from
// the shop to the warehouse has to see the warehouse's stock, or the cashier
// is reading one location's numbers while selling out of another's.
posRouter.get('/catalog', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: { orderBy: { name: 'asc' } } },
  });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  res.json({ locationId, products: await buildPosCatalog(req.posCompanyId!, modules, locationId) });
});

// A document stores its discount as a loose type/value pair; this is the
// narrowed shape the money maths takes, and the same reading has to be used
// everywhere or a refund won't match the sale it reverses.
function saleDiscount(document: { discountType: string | null; discountValue: number | null }) {
  return document.discountType === 'percent' || document.discountType === 'fixed'
    ? { type: document.discountType as DiscountType, value: document.discountValue ?? 0 }
    : null;
}

posRouter.post('/sales', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const items: SaleItemInput[] = Array.isArray(b.items) ? b.items : [];
  if (items.length === 0 || !b.paymentMethod || hasInvalidQuantity(items)) {
    res.status(400).json({ error: 'Некорректные данные продажи' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: { orderBy: { name: 'asc' } } },
  });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  // The submitted location was previously written straight into the sale and
  // its stock lookups without being checked against the caller's company — a
  // register could book a sale against another tenant's location and write
  // that company's stock down.
  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;
  const fiscalDevice = await prisma.fiscalDevice.findUnique({ where: { locationId } });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  const hasRestaurant = modules.includes('restaurant');

  // A cart line's price always comes from the cashier's cached catalog, fetched
  // once at login — if a price changed since, or the request was tampered with,
  // this catches it before any money or stock actually moves.
  const priceCheckProductIds = [...new Set(items.map((it) => it.productId))];
  const [priceCheckProducts, modifierRows] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: priceCheckProductIds }, companyId: req.posCompanyId }, select: { id: true, salePrice: true } }),
    prisma.productModifier.findMany({ where: { productId: { in: priceCheckProductIds } }, select: { productId: true } }),
  ]);
  const priceMismatches = findPriceMismatches(
    items,
    new Map(priceCheckProducts.map((p) => [p.id, p.salePrice])),
    new Set(modifierRows.map((m) => m.productId)),
  );
  if (priceMismatches.length > 0) {
    res.status(409).json({ error: 'Цены изменились — выйдите и войдите в кассу заново', priceMismatches });
    return;
  }

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

  // "On credit, and only with permission." The permission is the account: a
  // cashier can let a regular the owner has set up take goods away, and cannot
  // open one for a phone number typed at the counter.
  if (b.paymentMethod === 'credit') {
    const account = customerPhone
      ? await prisma.counterparty.findFirst({
          where: { companyId: req.posCompanyId, phone: customerPhone, type: 'customer' },
        })
      : null;
    const ledger = account ? await loadLedger(req.posCompanyId!, account.id, 'customer') : null;
    const owed = ledger ? computeBalance(ledger.charges, ledger.unapplied).balance : 0;

    const credit = resolveCreditSale({
      customerExisted: !!account,
      creditAllowed: account?.creditAllowed ?? false,
      creditLimit: account?.creditLimit ?? 0,
      currentBalance: owed,
      // Points are not money, and a credit sale settles in money — so the
      // limit is checked against what will actually be owed.
      saleTotal: subtotal - discountAmount,
    });
    if (credit.status !== 'ok') {
      res.status(403).json({ error: creditSaleErrorMessage(credit) });
      return;
    }
  }

  const keyResult = readIdempotencyKey(req.headers[IDEMPOTENCY_HEADER]);
  if (keyResult.status === 'invalid') {
    res.status(400).json({ error: 'Некорректный номер операции' });
    return;
  }
  const customerName = typeof b.customerName === 'string' && b.customerName.trim() ? b.customerName.trim() : customerPhone;

  try {
    const outcome = await runIdempotent({
      companyId: req.posCompanyId!,
      key: keyResult.status === 'ok' ? keyResult.key : null,
      endpoint: 'POST /pos/sales',
      requestHash: hashRequestBody(b),
      statusCode: 201,
    }, async (tx) => {
      const now = new Date();

      // Looked up and created inside the transaction. Done outside, a customer
      // row was left behind whenever the sale itself failed — a shopper who hit
      // an out-of-stock error ended up half-registered, with a loyalty account
      // and no purchase.
      let customer = customerPhone
        ? await tx.counterparty.findFirst({ where: { companyId: req.posCompanyId, phone: customerPhone, type: 'customer' } })
        : null;
      if (!customer && customerPhone) {
        customer = await tx.counterparty.create({
          data: { companyId: req.posCompanyId!, name: customerName, phone: customerPhone, type: 'customer' },
        });
      }

      const { redemptionAmount, finalTotal, pointsEarned } = computeLoyalty({
        netAfterDiscount: subtotal - discountAmount,
        availablePoints: customer?.loyaltyPoints ?? 0,
        pointsToRedeem,
        earnRatePercent: LOYALTY_EARN_RATE_PERCENT,
      });

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
        tx.stock.findMany({ where: { locationId, productId: { in: plainItems.map((it) => it.productId) } } }),
        tx.productBatch.findMany({
          where: { locationId, productId: { in: plainItems.map((it) => it.productId) }, quantity: { gt: 0 } },
        }),
        tx.stock.findMany({ where: { locationId, productId: { in: ingredientIds } } }),
      ]);
      const stockByProduct = groupStockByProduct(stockRows);
      const batchesByProduct = new Map<string, typeof batchRows>();
      for (const batch of batchRows) {
        const list = batchesByProduct.get(batch.productId) ?? [];
        list.push(batch);
        batchesByProduct.set(batch.productId, list);
      }

      // For batch-tracked products, only non-expired batches count as sellable —
      // expired stock must never be auto-sold, it has to be written off explicitly.
      // Either way what's left over for a walk-in excludes whatever is being
      // held for an open order: those units are on the shelf but promised.
      const quantityByProduct = new Map<string, number>();
      for (const item of plainItems) {
        const rows = stockByProduct.get(item.productId);
        const productBatches = batchesByProduct.get(item.productId);
        if (productBatches && productBatches.length > 0) {
          const sellable = productBatches
            .filter((batch) => batch.expiryDate > now)
            .reduce((sum, batch) => sum + batch.quantity, 0);
          quantityByProduct.set(item.productId, sellable - totalHeldBack(rows));
        } else {
          quantityByProduct.set(item.productId, totalAvailable(rows));
        }
      }

      const ingredientStockByProduct = groupStockByProduct(ingredientStockRows);
      const ingredientQuantityByProduct = new Map(
        [...ingredientStockByProduct.entries()].map(([productId, rows]) => [productId, totalAvailable(rows)]),
      );

      // Stock is held per product, not per cart line, and one cart can carry
      // the same product on several lines — a weighed item added twice, or a
      // scanner that fired twice. Checked line by line, two lines of 3 both
      // pass against a stock of 5 and the sale goes through for 6.
      const deductions = aggregateRequestedQuantities(plainItems);

      const shortages = [
        ...findStockShortages(deductions, quantityByProduct),
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
      // Drawn down as lines are allocated. Two lines of one batch-tracked
      // product must not both allocate against the batch's opening quantity,
      // or FEFO hands out the same units twice.
      const remainingByBatchId = new Map(batchRows.map((batch) => [batch.id, batch.quantity]));

      for (const item of plainItems) {
        const productBatches = batchesByProduct.get(item.productId);
        if (productBatches && productBatches.length > 0) {
          const sellableBatches: BatchStock[] = productBatches
            .filter((batch) => batch.expiryDate > now)
            .map((batch) => ({ batchId: batch.id, expiryDate: batch.expiryDate, quantity: remainingByBatchId.get(batch.id) ?? 0 }));
          const { allocations } = allocateFefo(item.quantity, sellableBatches);
          for (const alloc of allocations) {
            const batch = productBatches.find((batchRow) => batchRow.id === alloc.batchId)!;
            remainingByBatchId.set(batch.id, (remainingByBatchId.get(batch.id) ?? 0) - alloc.quantity);
            otherUpdates.push(decrementBatchQuantity(tx, batch, alloc.quantity));
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
        // Relative and conditional, for the same reason stock deltas are: an
        // absolute write computed from a balance read earlier lets two
        // registers spend the same points twice, each overwriting the other.
        otherUpdates.push(
          tx.counterparty
            .updateMany({
              where: { id: customer.id, loyaltyPoints: { gte: redemptionAmount } },
              data: { loyaltyPoints: { increment: pointsEarned - redemptionAmount } },
            })
            .then(({ count }) => {
              if (count === 0) throw new LoyaltyPointsError();
            }),
        );
      }

      // Document is created before the stock movements so each ledger row can
      // reference it — if a shortage were found it would have thrown already,
      // so by this point the transaction is committing regardless.
      const document = await tx.document.create({
        data: {
          companyId: req.posCompanyId!,
          locationId,
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

      // Queued, never awaited inline: an OFD that is slow or unreachable must
      // not stop a cashier serving the next customer. The row is what makes
      // "this sale has not reached the tax authority" answerable later.
      if (fiscalDevice?.enabled && fiscalDevice.provider !== 'none') {
        await tx.fiscalReceipt.create({
          data: { documentId: document.id, provider: fiscalDevice.provider, status: 'pending' },
        });
      }

      const stockMovements: Promise<unknown>[] = [...otherUpdates];
      // Across bins, because one product sits on as many shelves as it likes
      // and a sale takes from real ones.
      for (const deduction of deductions) {
        stockMovements.push(
          deductAcrossBins(tx, stockByProduct.get(deduction.productId) ?? [], deduction.quantity, 'sale', {
            documentId: document.id,
            createdBy: req.posUserId,
          }),
        );
      }
      for (const consumption of ingredientConsumption) {
        stockMovements.push(
          deductAcrossBins(tx, ingredientStockByProduct.get(consumption.ingredientId) ?? [], consumption.quantity, 'sale', {
            documentId: document.id,
            createdBy: req.posUserId,
          }),
        );
      }
      await Promise.all(stockMovements);

      return {
        id: document.id,
        createdAt: document.createdAt.toISOString(),
        // So the printed slip can say so. A cashier handing over a slip that
        // is not yet a fiscal receipt should know that is what they are doing.
        fiscalStatus: fiscalDevice?.enabled && fiscalDevice.provider !== 'none' ? 'pending' : 'not_required',
        discountAmount,
        pointsRedeemed: redemptionAmount,
        pointsEarned,
        total: finalTotal,
        customerPoints: customer ? customer.loyaltyPoints - redemptionAmount + pointsEarned : null,
      };
    });

    // A replay reuses the stored status, so the register that retried a sale
    // it had already made gets exactly the receipt it got the first time.
    res.status(outcome.statusCode).json(outcome.result);
  } catch (err) {
    if (err instanceof StockError) {
      res.status(409).json({ error: 'Недостаточно товара на складе', shortages: err.shortages });
      return;
    }
    if (err instanceof ConcurrentStockChangeError) {
      res.status(409).json({ error: 'Товар разобрали на другой кассе — повторите продажу' });
      return;
    }
    if (err instanceof LoyaltyPointsError) {
      res.status(409).json({ error: 'Баллы клиента изменились — повторите продажу' });
      return;
    }
    if (err instanceof IdempotencyConflictError) {
      res.status(409).json({ error: 'Этот номер операции уже использован для другой продажи' });
      return;
    }
    throw err;
  }
});

// The sales a return can be made against: this register's own shift, plus
// anything else the caller is allowed to reach. Kept short and recent — a
// cashier looking for "the receipt from ten minutes ago" should not have to
// page through a week.
posRouter.get('/sales', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const sales = await prisma.document.findMany({
    where: { companyId: req.posCompanyId, locationId, type: 'sale', status: 'confirmed' },
    include: { items: { include: { product: true } }, returns: { include: { items: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(
    sales.map((sale) => {
      const returnedByItemId = new Map<string, number>();
      for (const ret of sale.returns) {
        for (const line of ret.items) {
          if (!line.originalItemId) continue;
          returnedByItemId.set(line.originalItemId, (returnedByItemId.get(line.originalItemId) ?? 0) + line.quantity);
        }
      }
      const subtotal = sale.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0);
      const { discountAmount } = computeDiscount(subtotal, saleDiscount(sale));

      return {
        id: sale.id,
        createdAt: sale.createdAt.toISOString(),
        paymentMethod: sale.paymentMethod,
        total: subtotal - discountAmount - (sale.pointsRedeemed ?? 0),
        refundedTotal: sale.returns.reduce((sum, ret) => sum + (ret.refundAmount ?? 0), 0),
        items: sale.items.map((it) => ({
          id: it.id,
          productId: it.productId,
          name: it.product.name,
          quantity: it.quantity,
          price: it.price,
          // What is still returnable on this line, so the client never offers
          // more than the server would accept.
          returnedQuantity: returnedByItemId.get(it.id) ?? 0,
        })),
      };
    }),
  );
});

posRouter.get('/returns', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true, users: true },
  });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const nameByUserId = new Map((company?.users ?? []).map((u) => [u.id, u.name]));
  const returns = await prisma.document.findMany({
    where: { companyId: req.posCompanyId, locationId, type: 'return' },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(
    returns.map((ret) => ({
      id: ret.id,
      createdAt: ret.createdAt.toISOString(),
      saleId: ret.originalDocumentId,
      reason: ret.reason ?? '',
      refundAmount: ret.refundAmount ?? 0,
      paymentMethod: ret.paymentMethod,
      createdByName: ret.createdBy ? nameByUserId.get(ret.createdBy) ?? 'Удалённый сотрудник' : null,
      items: ret.items.map((it) => ({ productId: it.productId, name: it.product.name, quantity: it.quantity, price: it.price })),
    })),
  );
});

// A refund moves money out of the till, so it is the one operation a shop is
// most often robbed through. Three things make it accountable: it can only be
// made against a real sale, it can never give back more than that sale sold,
// and it carries a reason and an author. Reaching past the cashier's own open
// shift needs an owner or a manager — returning yesterday's receipt is the
// version of this that gets abused.
posRouter.post('/returns', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  const requested: { documentItemId: string; quantity: number }[] = Array.isArray(b.items) ? b.items : [];
  if (!b.saleId || !reason) {
    res.status(400).json({ error: 'Укажите чек и причину возврата' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const sale = await prisma.document.findFirst({
    where: { id: b.saleId, companyId: req.posCompanyId, type: 'sale', status: 'confirmed' },
    include: { items: true },
  });
  if (!sale) {
    res.status(404).json({ error: 'Чек не найден' });
    return;
  }

  const openShift = await prisma.shift.findFirst({
    where: { companyId: req.posCompanyId, userId: req.posUserId, closedAt: null },
    orderBy: { openedAt: 'desc' },
  });
  const withinOwnShift =
    !!openShift && openShift.locationId === sale.locationId && sale.createdAt >= openShift.openedAt;
  if (!withinOwnShift && !(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Возврат по чеку не из вашей смены проводит владелец или менеджер' });
    return;
  }

  const returnedRows = await prisma.documentItem.groupBy({
    by: ['originalItemId'],
    where: { originalItemId: { in: sale.items.map((it) => it.id) } },
    _sum: { quantity: true },
  });
  const returnedByItemId = new Map(returnedRows.map((row) => [row.originalItemId!, row._sum.quantity ?? 0]));

  const sold: SoldLine[] = sale.items.map((it) => ({
    documentItemId: it.id,
    productId: it.productId,
    batchId: it.batchId,
    quantity: it.quantity,
    price: it.price,
    alreadyReturned: returnedByItemId.get(it.id) ?? 0,
  }));

  const subtotal = sale.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0);
  const { discountAmount } = computeDiscount(subtotal, saleDiscount(sale));
  const resolution = resolveReturn(sold, requested, {
    subtotal,
    discountAmount,
    pointsRedeemed: sale.pointsRedeemed ?? 0,
    pointsEarned: sale.pointsEarned ?? 0,
  });
  if (resolution.status !== 'ok') {
    res.status(resolution.status === 'unknown' ? 404 : 400).json({ error: returnErrorMessage(resolution) });
    return;
  }
  const { lines, refund } = resolution;

  const keyResult = readIdempotencyKey(req.headers[IDEMPOTENCY_HEADER]);
  if (keyResult.status === 'invalid') {
    res.status(400).json({ error: 'Некорректный номер операции' });
    return;
  }

  try {
    const outcome = await runIdempotent({
      companyId: req.posCompanyId!,
      key: keyResult.status === 'ok' ? keyResult.key : null,
      endpoint: 'POST /pos/returns',
      requestHash: hashRequestBody(b),
      statusCode: 201,
    }, async (tx) => {
      const document = await tx.document.create({
        data: {
          companyId: req.posCompanyId!,
          locationId: sale.locationId,
          type: 'return',
          status: 'confirmed',
          // How the money went back, which is not always how it came in.
          paymentMethod: typeof b.paymentMethod === 'string' ? b.paymentMethod : sale.paymentMethod,
          counterpartyId: sale.counterpartyId,
          originalDocumentId: sale.id,
          reason,
          refundAmount: refund.amount,
          pointsRedeemed: refund.pointsRestored,
          pointsEarned: refund.pointsRevoked,
          createdBy: req.posUserId!,
          items: {
            create: lines.map((line) => ({
              productId: line.productId,
              batchId: line.batchId,
              originalItemId: line.documentItemId,
              quantity: line.quantity,
              price: line.price,
            })),
          },
        },
      });

      const stockRows = await tx.stock.findMany({
        where: { locationId: sale.locationId, productId: { in: lines.map((l) => l.productId) } },
      });
      const stockByProduct = new Map(stockRows.map((s) => [s.productId, s]));

      for (const line of lines) {
        const stock = stockByProduct.get(line.productId);
        if (stock) {
          await applyStockDelta(tx, stock, line.quantity, 'return', { documentId: document.id, createdBy: req.posUserId });
        } else {
          await createStockWithMovement(tx, {
            productId: line.productId,
            locationId: sale.locationId,
            quantity: line.quantity,
            reason: 'return',
            documentId: document.id,
            createdBy: req.posUserId,
          });
        }
        // Back into the batch it left from, so its expiry date comes back with
        // it instead of the goods rejoining the shelf as undated stock.
        if (line.batchId) {
          await tx.productBatch.update({ where: { id: line.batchId }, data: { quantity: { increment: line.quantity } } });
        }
      }

      if (sale.counterpartyId) {
        // Relative, and floored, for the same reason every other balance write
        // is: the customer may have spent points elsewhere since.
        const delta = refund.pointsRestored - refund.pointsRevoked;
        await tx.$executeRaw`
          UPDATE "counterparties" SET "loyaltyPoints" = GREATEST("loyaltyPoints" + ${delta}, 0)
          WHERE "id" = ${sale.counterpartyId}`;
      }

      return {
        id: document.id,
        createdAt: document.createdAt.toISOString(),
        saleId: sale.id,
        refundAmount: refund.amount,
        pointsRestored: refund.pointsRestored,
        pointsRevoked: refund.pointsRevoked,
      };
    });

    res.status(outcome.statusCode).json(outcome.result);
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      res.status(409).json({ error: 'Этот номер операции уже использован для другого возврата' });
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
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    res.status(400).json({ error: 'Некорректные данные смены' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: { orderBy: { name: 'asc' } } },
  });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  // Checked against the company, like the sale's: a shift opened against
  // someone else's location would file this register's whole day of takings
  // under another company.
  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const user = await prisma.user.findUnique({ where: { id: req.posUserId } });

  const shift = await prisma.shift.create({
    data: {
      companyId: req.posCompanyId!,
      locationId,
      cashierName: user?.name ?? 'Кассир',
      userId: req.posUserId,
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

  // The counted cash is the evidence behind every shortage the owner will
  // ever be shown for this shift. Closing an already-closed shift silently
  // overwrote that number with a second count, erasing the discrepancy — so a
  // closed shift is final, and only the cashier who worked it (or an owner or
  // manager) may set it.
  if (shift.userId && shift.userId !== req.posUserId && !(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Закрыть смену может только её кассир, владелец или менеджер' });
    return;
  }

  // Guarded on closedAt rather than checked beforehand, so two devices closing
  // the same shift at once can't both succeed with different counts.
  const { count } = await prisma.shift.updateMany({
    where: { id: shift.id, closedAt: null },
    data: { closedAt: new Date(), closingCashCounted },
  });
  if (count === 0) {
    res.status(409).json({ error: 'Смена уже закрыта' });
    return;
  }

  const closed = await prisma.shift.findUnique({ where: { id: shift.id } });
  res.json({ id: shift.id, closedAt: closed?.closedAt?.toISOString() });
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

  // A report belongs to one location. Revenue was summed across the whole
  // company while the low-stock list came from whichever location sorted
  // first, so a two-shop owner read one shop's shortages under both shops'
  // takings. Answering "which point earns and which only turns over" needs
  // both halves scoped to the same place.
  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const from = req.query.from ? new Date(String(req.query.from)) : defaultFrom;
  const to = req.query.to ? new Date(String(req.query.to)) : now;

  // Bounded, and the response says when the bound was reached. An unbounded
  // read of every sale in a period is fine for a shop and fatal for a busy
  // one, and a report that quietly goes from correct to slow to timing out is
  // worse than one that says it only covered part of the period.
  const documents = await prisma.document.findMany({
    where: {
      companyId: req.posCompanyId,
      locationId,
      type: 'sale',
      status: 'confirmed',
      createdAt: { gte: from, lte: to },
    },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
    take: REPORT_SALE_LIMIT,
  });

  const returnDocuments = await prisma.document.findMany({
    where: {
      companyId: req.posCompanyId,
      locationId,
      type: 'return',
      createdAt: { gte: from, lte: to },
    },
    select: { refundAmount: true },
  });
  const refundedTotal = returnDocuments.reduce((sum, r) => sum + (r.refundAmount ?? 0), 0);

  const sales: SaleRecord[] = documents.map((d) => {
    const subtotal = d.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0);
    return {
      id: d.id,
      createdAt: d.createdAt,
      paymentMethod: d.paymentMethod,
      createdBy: d.createdBy,
      discountAmount: computeDiscount(subtotal, saleDiscount(d)).discountAmount,
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

  const stockRows = await prisma.stock.findMany({ where: { locationId }, include: { product: true } });
  // "About to run out" is a question about what is still sellable, so goods
  // already promised to an open order count as gone, not as cover.
  const stockForLowCheck = stockRows.map((s) => ({
    productId: s.productId,
    name: s.product.name,
    quantity: availableQuantity(s),
  }));

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

  const summary = buildSummary(sales);

  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    // True when there were more sales in the period than one report can read.
    // The figures below then describe the most recent ones, not all of them,
    // and the screen says so rather than presenting a partial total as whole.
    truncated: documents.length >= REPORT_SALE_LIMIT,
    foodCost: buildFoodCost(sales, dishCostByProductId),
    summary,
    // Revenue that walked back out of the till. Reported next to the takings
    // rather than folded into them: an owner needs the gross and the refunds
    // separately to see a register giving too much back, and netRevenue is
    // the number that actually stayed.
    returns: {
      count: returnDocuments.length,
      total: refundedTotal,
      netRevenue: summary.revenue - refundedTotal,
    },
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

  const [movements, users] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { locationId: { in: locationIds }, ...(productId ? { productId } : {}) },
      include: { product: true, location: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.user.findMany({ where: { companyId: req.posCompanyId }, select: { id: true, name: true } }),
  ]);
  const nameByUserId = new Map(users.map((u) => [u.id, u.name]));

  res.json(
    movements.map((m) => ({
      id: m.id,
      productId: m.productId,
      productName: m.product.name,
      locationName: m.location.name,
      quantity: m.quantity,
      reason: m.reason,
      documentId: m.documentId,
      // The shelf it came off. Without it a shortage traces to a building,
      // which is the same as not tracing.
      binLocation: m.binLocation,
      // Null for movements written before the ledger recorded an author, and
      // for anything a storefront customer set off — there is no user behind
      // those, and inventing one would be worse than saying so.
      createdByName: m.createdBy ? nameByUserId.get(m.createdBy) ?? 'Удалённый сотрудник' : null,
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

// Packagings are the shapes a product arrives and leaves in. Owner-facing,
// like the rest of product management: a cashier changing what a case holds
// would silently rewrite every future receipt's quantities.
posRouter.get('/products/:id/packagings', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Доступно только владельцу и менеджеру' });
    return;
  }

  const product = await prisma.product.findFirst({ where: { id: req.params.id, companyId: req.posCompanyId } });
  if (!product) {
    res.status(404).json({ error: 'Товар не найден' });
    return;
  }

  const packagings = await prisma.productPackaging.findMany({
    where: { productId: product.id },
    orderBy: { unitsPerPack: 'asc' },
  });
  res.json(packagings.map((pack) => ({ id: pack.id, name: pack.name, unitsPerPack: pack.unitsPerPack, barcode: pack.barcode ?? '' })));
});

posRouter.post('/products/:id/packagings', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Доступно только владельцу и менеджеру' });
    return;
  }

  const b = req.body ?? {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const unitsPerPack = Number(b.unitsPerPack);
  const barcode = typeof b.barcode === 'string' ? b.barcode.trim() : '';
  // A pack holding one unit is the base unit under another name, and a pack
  // holding none would multiply every receipt to zero.
  if (!name || !Number.isFinite(unitsPerPack) || unitsPerPack <= 0) {
    res.status(400).json({ error: 'Укажите название упаковки и сколько единиц в ней' });
    return;
  }

  const product = await prisma.product.findFirst({ where: { id: req.params.id, companyId: req.posCompanyId } });
  if (!product) {
    res.status(404).json({ error: 'Товар не найден' });
    return;
  }

  const existing = await prisma.productPackaging.findFirst({ where: { productId: product.id, name } });
  if (existing) {
    res.status(409).json({ error: 'Упаковка с таким названием уже есть у этого товара' });
    return;
  }

  const packaging = await prisma.productPackaging.create({
    data: { productId: product.id, name, unitsPerPack, barcode: barcode || null },
  });
  res.status(201).json({
    id: packaging.id,
    name: packaging.name,
    unitsPerPack: packaging.unitsPerPack,
    barcode: packaging.barcode ?? '',
  });
});

posRouter.delete('/products/:id/packagings/:packagingId', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Доступно только владельцу и менеджеру' });
    return;
  }

  const packaging = await prisma.productPackaging.findFirst({
    where: { id: req.params.packagingId, productId: req.params.id, product: { companyId: req.posCompanyId } },
  });
  if (!packaging) {
    res.status(404).json({ error: 'Упаковка не найдена' });
    return;
  }

  // Documents keep pointing at it, so removing one would erase what a past
  // receipt actually recorded. The link is severed instead of the history.
  const used = await prisma.documentItem.count({ where: { packagingId: packaging.id } });
  if (used > 0) {
    res.status(409).json({ error: 'По этой упаковке уже есть документы — её нельзя удалить' });
    return;
  }

  await prisma.productPackaging.delete({ where: { id: packaging.id } });
  res.json({ ok: true });
});

// How far back demand is measured. Four weeks covers a shop's weekly rhythm
// twice over without letting a season that has already ended drive today's
// order.
const DEMAND_WINDOW_DAYS = 28;

// Ceilings on the two reads that grow with the business rather than with the
// question. Neither is a real answer to scale — that needs daily balances kept
// as they happen instead of replayed — but a visible ceiling beats a screen
// that works until the day it doesn't.
const REPORT_SALE_LIMIT = 5000;
const DEMAND_MOVEMENT_LIMIT = 50000;

// Movements where a customer took goods away, or brought them back. A receipt
// or a transfer moves stock without anybody wanting it.
const DEMAND_REASONS = new Set(['sale', 'order_fulfill', 'table_order', 'return']);

// The answer to "what do I order today", with the numbers behind it. Nobody
// acts on a figure they can't check, so every line carries the rate, the cover
// and the reason it appeared — an owner who disagrees can see exactly which
// input to argue with.
posRouter.get('/replenishment', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Закупки недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() - DEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [products, stockRows, policies, packagings, movements, incomingTransfers] = await Promise.all([
    prisma.product.findMany({ where: { companyId: req.posCompanyId, sellable: true } }),
    prisma.stock.findMany({ where: { locationId } }),
    prisma.stockPolicy.findMany({ where: { locationId } }),
    prisma.productPackaging.findMany({
      where: { product: { companyId: req.posCompanyId } },
      orderBy: { unitsPerPack: 'asc' },
    }),
    prisma.stockMovement.findMany({
      where: { locationId, createdAt: { gte: windowStart } },
      select: { productId: true, quantity: true, reason: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: DEMAND_MOVEMENT_LIMIT,
    }),
    // Goods already on their way here. Ordering on top of them is how a
    // stockroom ends up holding three months of one item.
    prisma.documentItem.findMany({
      where: {
        document: { companyId: req.posCompanyId, type: 'transfer', status: 'in_transit', toLocationId: locationId },
      },
      select: { productId: true, quantity: true },
    }),
  ]);
  const onOrderByProduct = await outstandingOnOrder(req.posCompanyId!, locationId);

  // Summed across bins: the question is what this point has, not what one
  // shelf in it has.
  const availableByProduct = new Map<string, number>();
  for (const row of stockRows) {
    availableByProduct.set(row.productId, (availableByProduct.get(row.productId) ?? 0) + availableQuantity(row));
  }
  const inTransitByProduct = new Map<string, number>();
  for (const item of incomingTransfers) {
    inTransitByProduct.set(item.productId, (inTransitByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  const policyByProduct = new Map(policies.map((policy) => [policy.productId, policy]));
  // The smallest pack the goods come in. Recommending three singles when they
  // only ship in sixes is an answer nobody can act on.
  const packByProduct = new Map<string, number>();
  for (const pack of packagings) {
    if (!packByProduct.has(pack.productId)) packByProduct.set(pack.productId, pack.unitsPerPack);
  }

  // One pass over the ledger builds both lists: every movement, for
  // reconstructing what was on the shelf, and only the demand ones, for the
  // rate. Bucketed by whole days back from now, so "yesterday" is the 24 hours
  // before this moment rather than a calendar date in some timezone.
  const allByProduct = new Map<string, DailyMovement[]>();
  const demandByProduct = new Map<string, DailyMovement[]>();
  for (const movement of movements) {
    const dayIndex = Math.floor((now.getTime() - movement.createdAt.getTime()) / (24 * 60 * 60 * 1000));
    const entry: DailyMovement = { dayIndex, quantity: movement.quantity };

    const all = allByProduct.get(movement.productId) ?? [];
    all.push(entry);
    allByProduct.set(movement.productId, all);

    if (!DEMAND_REASONS.has(movement.reason)) continue;
    const demand = demandByProduct.get(movement.productId) ?? [];
    demand.push(entry);
    demandByProduct.set(movement.productId, demand);
  }

  const lines = products.map((product) => {
    const available = availableByProduct.get(product.id) ?? 0;
    const inTransit = inTransitByProduct.get(product.id) ?? 0;
    const policy = policyByProduct.get(product.id);

    const closing = buildDailyClosingBalances(available, allByProduct.get(product.id) ?? [], DEMAND_WINDOW_DAYS);
    const demand = estimateDailyDemand(closing, demandByProduct.get(product.id) ?? [], () => true);

    const recommendation = recommendOrder({
      available,
      inTransit,
      onOrder: onOrderByProduct.get(product.id) ?? 0,
      demandPerDay: demand.perDay,
      leadTimeDays: policy?.leadTimeDays ?? 3,
      minQuantity: policy?.minQuantity ?? 0,
      targetQuantity: policy?.targetQuantity ?? 0,
      unitsPerPack: packByProduct.get(product.id),
    });

    return {
      productId: product.id,
      name: product.name,
      unit: product.unit,
      available,
      inTransit,
      onOrder: onOrderByProduct.get(product.id) ?? 0,
      demandPerDay: demand.perDay === null ? null : Math.round(demand.perDay * 100) / 100,
      daysInStock: demand.daysInStock,
      daysOutOfStock: demand.daysOutOfStock,
      soldInWindow: demand.soldInWindow,
      daysOfCover: recommendation.daysOfCover === null ? null : Math.round(recommendation.daysOfCover * 10) / 10,
      recommended: recommendation.quantity,
      trigger: recommendation.trigger,
      minQuantity: policy?.minQuantity ?? 0,
      targetQuantity: policy?.targetQuantity ?? 0,
      leadTimeDays: policy?.leadTimeDays ?? 3,
      unitsPerPack: packByProduct.get(product.id) ?? null,
    };
  });

  // Only what actually needs ordering, soonest to run out first. A list of
  // everything is a report; this is meant to be a decision.
  const needed = lines
    .filter((line) => line.recommended > 0)
    .sort((a, b) => (a.daysOfCover ?? Number.POSITIVE_INFINITY) - (b.daysOfCover ?? Number.POSITIVE_INFINITY));

  res.json({
    locationId,
    windowDays: DEMAND_WINDOW_DAYS,
    // When the ledger for this window did not fit, the demand rates are built
    // from the most recent part of it. Better said out loud than quietly
    // understated.
    truncated: movements.length >= DEMAND_MOVEMENT_LIMIT,
    items: needed,
  });
});

posRouter.put('/products/:id/policy', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Доступно только владельцу и менеджеру' });
    return;
  }

  const b = req.body ?? {};
  const minQuantity = Number(b.minQuantity ?? 0);
  const targetQuantity = Number(b.targetQuantity ?? 0);
  const leadTimeDays = Number(b.leadTimeDays ?? 3);
  if (
    !Number.isFinite(minQuantity) || minQuantity < 0 ||
    !Number.isFinite(targetQuantity) || targetQuantity < 0 ||
    !Number.isFinite(leadTimeDays) || leadTimeDays < 0
  ) {
    res.status(400).json({ error: 'Некорректные значения запаса' });
    return;
  }
  // A target below the minimum would top the shelf up to less than the level
  // that triggered the order, and so trigger again immediately.
  if (targetQuantity > 0 && minQuantity > 0 && targetQuantity < minQuantity) {
    res.status(400).json({ error: 'Целевой запас не может быть меньше минимального' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const product = await prisma.product.findFirst({ where: { id: req.params.id, companyId: req.posCompanyId } });
  if (!product) {
    res.status(404).json({ error: 'Товар не найден' });
    return;
  }

  const policy = await prisma.stockPolicy.upsert({
    where: { productId_locationId: { productId: product.id, locationId } },
    update: { minQuantity, targetQuantity, leadTimeDays: Math.round(leadTimeDays) },
    create: { productId: product.id, locationId, minQuantity, targetQuantity, leadTimeDays: Math.round(leadTimeDays) },
  });

  res.json({
    productId: policy.productId,
    locationId: policy.locationId,
    minQuantity: policy.minQuantity,
    targetQuantity: policy.targetQuantity,
    leadTimeDays: policy.leadTimeDays,
  });
});

// Goods that haven't moved in this long are asleep. Three months is long
// enough that a seasonal item isn't accused of being dead in its off-season.
const DEAD_STOCK_DAYS = 90;

// The owner's morning. Not a page of charts — six questions with answers, each
// one traceable to the documents underneath it.
posRouter.get('/dashboard', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Сводка доступна владельцу и менеджеру' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true, users: true },
  });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const now = new Date();
  const requestedDays = Number(req.query.days);
  const days = Number.isFinite(requestedDays) && requestedDays > 0 && requestedDays <= 90 ? Math.round(requestedDays) : 7;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const deadStockSince = new Date(now.getTime() - DEAD_STOCK_DAYS * 24 * 60 * 60 * 1000);

  const [products, stockRows, salesDocs, returnDocs, adjustmentDocs, receiptLines, lastSales, batches, shifts] =
    await Promise.all([
      prisma.product.findMany({ where: { companyId: req.posCompanyId }, select: { id: true, name: true, purchasePrice: true } }),
      prisma.stock.findMany({ where: { locationId } }),
      prisma.document.findMany({
        where: { companyId: req.posCompanyId, locationId, type: 'sale', status: 'confirmed', createdAt: { gte: from } },
        include: { items: true },
      }),
      prisma.document.findMany({
        where: { companyId: req.posCompanyId, locationId, type: 'return', createdAt: { gte: from } },
        include: { items: true },
      }),
      // Both kinds: a count that came up short and a deliberate write-off are
      // the same thing to an owner — stock that left the books without being
      // sold.
      prisma.document.findMany({
        where: {
          companyId: req.posCompanyId,
          locationId,
          type: { in: ['adjustment', 'write_off'] },
          createdAt: { gte: from },
        },
        include: { items: { include: { product: true } } },
      }),
      // Every receipt ever, because a weighted average cost is only honest if
      // it averages everything that was ever paid for these goods.
      prisma.documentItem.findMany({
        where: { document: { companyId: req.posCompanyId, type: 'receipt' } },
        select: { productId: true, quantity: true, price: true },
      }),
      prisma.stockMovement.groupBy({
        by: ['productId'],
        where: { locationId, reason: { in: ['sale', 'order_fulfill', 'table_order'] } },
        _max: { createdAt: true },
      }),
      prisma.productBatch.findMany({
        where: { locationId, quantity: { gt: 0 } },
        include: { product: true },
        orderBy: { expiryDate: 'asc' },
      }),
      prisma.shift.findMany({ where: { companyId: req.posCompanyId, locationId, openedAt: { gte: from } }, orderBy: { openedAt: 'desc' } }),
    ]);

  const nameByUserId = new Map((company?.users ?? []).map((u) => [u.id, u.name]));
  const nameByProductId = new Map(products.map((p) => [p.id, p.name]));
  const costByProduct = buildAverageCost(
    receiptLines,
    new Map(products.map((p) => [p.id, p.purchasePrice])),
  );

  // --- Money -----------------------------------------------------------
  const soldLines = salesDocs.flatMap((doc) =>
    doc.items.map((it) => ({ productId: it.productId, quantity: it.quantity, price: it.price })),
  );
  const returnedLines = returnDocs.flatMap((doc) =>
    doc.items.map((it) => ({ productId: it.productId, quantity: it.quantity, price: it.price })),
  );
  const grossOnSales = computeGrossMargin(soldLines, costByProduct);
  const grossOnReturns = computeGrossMargin(returnedLines, costByProduct);
  const discountTotal = salesDocs.reduce((sum, doc) => {
    const subtotal = doc.items.reduce((s, it) => s + Math.round(it.price * it.quantity), 0);
    return sum + computeDiscount(subtotal, saleDiscount(doc)).discountAmount;
  }, 0);
  const refundTotal = returnDocs.reduce((sum, doc) => sum + (doc.refundAmount ?? 0), 0);

  // --- Cash in the drawer, per shift -----------------------------------
  const cashByShift = shifts.map<ShiftCash>((shift) => {
    const until = shift.closedAt ?? now;
    const matches = (doc: { createdBy: string | null; paymentMethod: string | null; createdAt: Date }) =>
      doc.paymentMethod === 'cash' &&
      doc.createdAt >= shift.openedAt &&
      doc.createdAt <= until &&
      (!shift.userId || doc.createdBy === shift.userId);

    const takings = salesDocs.filter(matches).reduce((sum, doc) => {
      const subtotal = doc.items.reduce((s, it) => s + Math.round(it.price * it.quantity), 0);
      return sum + subtotal - computeDiscount(subtotal, saleDiscount(doc)).discountAmount - (doc.pointsRedeemed ?? 0);
    }, 0);
    // Refunds leave the same drawer, so they belong in the same figure.
    const paidOut = returnDocs.filter(matches).reduce((sum, doc) => sum + (doc.refundAmount ?? 0), 0);

    return {
      shiftId: shift.id,
      cashierName: shift.cashierName,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      openingCash: shift.openingCash,
      cashMovement: takings - paidOut,
      countedAtClose: shift.closingCashCounted,
    };
  });
  const reconciled = reconcileShiftCash(cashByShift);

  // --- Who is an outlier ------------------------------------------------
  const activityByUser = new Map<string, CashierActivity>();
  const ensure = (userId: string): CashierActivity => {
    const existing = activityByUser.get(userId);
    if (existing) return existing;
    const created: CashierActivity = {
      userId,
      name: nameByUserId.get(userId) ?? 'Удалённый сотрудник',
      revenue: 0,
      refunds: 0,
      refundCount: 0,
      discounts: 0,
      writeOffs: 0,
    };
    activityByUser.set(userId, created);
    return created;
  };

  for (const doc of salesDocs) {
    if (!doc.createdBy) continue;
    const subtotal = doc.items.reduce((s, it) => s + Math.round(it.price * it.quantity), 0);
    const discount = computeDiscount(subtotal, saleDiscount(doc)).discountAmount;
    const entry = ensure(doc.createdBy);
    entry.revenue += subtotal - discount - (doc.pointsRedeemed ?? 0);
    entry.discounts += discount;
  }
  for (const doc of returnDocs) {
    if (!doc.createdBy) continue;
    const entry = ensure(doc.createdBy);
    entry.refunds += doc.refundAmount ?? 0;
    entry.refundCount += 1;
  }
  for (const doc of adjustmentDocs) {
    if (!doc.createdBy) continue;
    // A count records its shortfall as a negative delta; a write-off records
    // the quantity destroyed as a positive one. Both are stock lost.
    const written = doc.items.reduce((sum, it) => {
      const lost = doc.type === 'write_off' ? it.quantity : Math.max(-it.quantity, 0);
      return sum + Math.round((costByProduct.get(it.productId) ?? 0) * lost);
    }, 0);
    ensure(doc.createdBy).writeOffs += written;
  }

  // --- Stock that is asleep, and stock about to expire -------------------
  const lastSaleDaysAgo = new Map<string, number>();
  for (const row of lastSales) {
    const at = row._max.createdAt;
    if (!at) continue;
    lastSaleDaysAgo.set(row.productId, Math.floor((now.getTime() - at.getTime()) / (24 * 60 * 60 * 1000)));
  }
  const stockedByProduct = new Map<string, number>();
  for (const row of stockRows) {
    stockedByProduct.set(row.productId, (stockedByProduct.get(row.productId) ?? 0) + row.quantity);
  }
  const deadStock = findDeadStock(
    [...stockedByProduct.entries()].map(([productId, quantity]) => ({
      productId,
      name: nameByProductId.get(productId) ?? '—',
      quantity,
    })),
    lastSaleDaysAgo,
    costByProduct,
    DEAD_STOCK_DAYS,
  ).slice(0, 20);

  const expiring = batches
    .map((batch) => ({
      batchId: batch.id,
      productName: batch.product.name,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate.toISOString(),
      quantity: batch.quantity,
      value: Math.round((costByProduct.get(batch.productId) ?? 0) * batch.quantity),
      status: classifyExpiry(batch.expiryDate, now),
    }))
    .filter((batch) => batch.status !== 'ok')
    .slice(0, 20);

  // --- Discrepancies ----------------------------------------------------
  const countDiscrepancies = adjustmentDocs
    .map((doc) => ({
      documentId: doc.id,
      type: doc.type,
      reasonCode: doc.reasonCode,
      note: doc.reason ?? '',
      createdAt: doc.createdAt.toISOString(),
      createdByName: doc.createdBy ? nameByUserId.get(doc.createdBy) ?? 'Удалённый сотрудник' : null,
      shortfallValue: doc.items.reduce((sum, it) => {
        const lost = doc.type === 'write_off' ? it.quantity : Math.max(-it.quantity, 0);
        return sum + Math.round((costByProduct.get(it.productId) ?? 0) * lost);
      }, 0),
      lines: doc.items
        .filter((it) => it.quantity !== 0)
        .map((it) => ({ name: it.product.name, delta: doc.type === 'write_off' ? -it.quantity : it.quantity })),
    }))
    .filter((doc) => doc.shortfallValue > 0)
    .sort((a, b) => b.shortfallValue - a.shortfallValue)
    .slice(0, 20);

  // Sales that never reached the tax authority. A number an owner needs on the
  // same screen as the money, because it is the one that turns into a fine.
  const unfiscalisedCount = await prisma.fiscalReceipt.count({
    where: { status: { in: ['pending', 'failed'] }, document: { locationId, companyId: req.posCompanyId } },
  });
  const unfiscalised = { count: unfiscalisedCount };

  // Shown only when it isn't zero. A trust indicator that is always green
  // stops being read, and this one should be green every single day.
  const { ledgerTotals, mismatches } = await findLedgerMismatches(req.posCompanyId!, locationId);
  const ledgerCheck = summarize(ledgerTotals, mismatches);

  const receivedTransfers = await prisma.document.findMany({
    where: { companyId: req.posCompanyId, type: 'transfer', toLocationId: locationId, status: 'confirmed', fulfilledAt: { gte: from } },
    include: { items: { include: { product: true } }, location: true },
  });
  const transferDiscrepancies = receivedTransfers
    .map((doc) => ({
      documentId: doc.id,
      fromLocationName: doc.location.name,
      receivedAt: doc.fulfilledAt ? doc.fulfilledAt.toISOString() : null,
      receivedByName: doc.fulfilledBy ? nameByUserId.get(doc.fulfilledBy) ?? 'Удалённый сотрудник' : null,
      lines: doc.items
        .filter((it) => it.receivedQuantity !== null && it.receivedQuantity < it.quantity)
        .map((it) => ({ name: it.product.name, sent: it.quantity, received: it.receivedQuantity ?? 0 })),
    }))
    .filter((doc) => doc.lines.length > 0)
    .slice(0, 20);

  // What the shop is owed and what it owes. A till figure answers "what did we
  // take today"; these answer "where is our money", which is a different and
  // usually larger question.
  const [customerAccounts, supplierAccounts] = await Promise.all([
    prisma.counterparty.findMany({ where: { companyId: req.posCompanyId, type: 'customer' }, select: { id: true } }),
    prisma.counterparty.findMany({ where: { companyId: req.posCompanyId, type: 'supplier' }, select: { id: true } }),
  ]);
  const sumBalances = async (accounts: { id: string }[], type: string) => {
    const ledgers = await loadLedgers(req.posCompanyId!, accounts.map((a) => a.id), type);
    let total = 0;
    let overdue = 0;
    for (const ledger of ledgers.values()) {
      const balance = computeBalance(ledger.charges, ledger.unapplied).balance;
      if (balance <= 0) continue;
      total += balance;
      const aging = buildAging(ledger.charges, now);
      overdue += aging.days31to60 + aging.over60;
    }
    return { total, overdue };
  };
  const receivable = await sumBalances(customerAccounts, 'customer');
  const payable = await sumBalances(supplierAccounts, 'supplier');

  res.json({
    locationId,
    from: from.toISOString(),
    to: now.toISOString(),
    days,
    debts: { receivable, payable },
    money: {
      revenue: grossOnSales.revenue,
      // Returned goods take their margin back out with them, so the period's
      // real margin is what the sales earned less what the returns undid.
      grossMargin: grossOnSales.grossMargin - grossOnReturns.grossMargin,
      marginPercent: grossOnSales.marginPercent,
      discounts: discountTotal,
      refunds: refundTotal,
      netRevenue: grossOnSales.revenue - refundTotal,
      shifts: reconciled.map((shift) => ({
        shiftId: shift.shiftId,
        cashierName: shift.cashierName,
        openedAt: shift.openedAt.toISOString(),
        closedAt: shift.closedAt ? shift.closedAt.toISOString() : null,
        expected: shift.expected,
        counted: shift.countedAtClose,
        difference: shift.difference,
      })),
    },
    unfiscalised,
    ledgerCheck,
    deadStock,
    expiring,
    flags: flagOutliers([...activityByUser.values()]),
    discrepancies: { counts: countDiscrepancies, transfers: transferDiscrepancies },
  });
});

// Which of this point's sales have not reached the tax authority. The
// question a shop has to be able to answer at any moment, and can only answer
// because a printed slip and a fiscal receipt were never treated as one thing.
posRouter.get('/fiscal/pending', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const device = await prisma.fiscalDevice.findUnique({ where: { locationId } });
  const receipts = await prisma.fiscalReceipt.findMany({
    where: { status: { in: ['pending', 'failed'] }, document: { locationId, companyId: req.posCompanyId } },
    include: { document: { include: { items: true } } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  res.json({
    device: device ? { provider: device.provider, registrationNumber: device.registrationNumber, enabled: device.enabled } : null,
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      documentId: receipt.documentId,
      status: receipt.status,
      attempts: receipt.attempts,
      lastError: receipt.lastError,
      createdAt: receipt.createdAt.toISOString(),
      total: receipt.document.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0),
    })),
  });
});

// A standalone register beside the POS is how a great many small shops in
// Kazakhstan actually work. ANYQ doesn't talk to it: the cashier reads the
// fiscal number off its slip and enters it here, and the sale stops being
// unfiscalised. Unglamorous, and honest about who did what.
posRouter.post('/fiscal/:documentId/manual', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  if (!isValidManualEntry(b.fiscalNumber)) {
    res.status(400).json({ error: 'Введите номер фискального чека с кассового аппарата' });
    return;
  }

  const receipt = await prisma.fiscalReceipt.findFirst({
    where: { documentId: req.params.documentId, document: { companyId: req.posCompanyId } },
  });
  if (!receipt) {
    res.status(404).json({ error: 'Чек не найден' });
    return;
  }
  // Already filed. Overwriting would replace the number the tax authority has
  // with a different one and leave no trace of the first.
  if (receipt.status === 'registered') {
    res.status(409).json({ error: 'Чек уже фискализирован' });
    return;
  }

  const registration = manualRegistration(
    String(b.fiscalNumber),
    typeof b.fiscalSign === 'string' ? b.fiscalSign : '',
    new Date(),
  );
  const updated = await prisma.fiscalReceipt.update({
    where: { id: receipt.id },
    data: {
      status: 'registered',
      fiscalNumber: registration.fiscalNumber,
      fiscalSign: registration.fiscalSign || null,
      registeredAt: registration.registeredAt,
      lastError: null,
    },
  });

  res.json({
    documentId: updated.documentId,
    status: updated.status,
    fiscalNumber: updated.fiscalNumber,
    registeredAt: updated.registeredAt?.toISOString() ?? null,
  });
});

posRouter.put('/fiscal/device', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Настройка кассового аппарата доступна владельцу и менеджеру' });
    return;
  }

  const b = req.body ?? {};
  const provider = b.provider === 'manual' || b.provider === 'none' ? b.provider : null;
  const registrationNumber = typeof b.registrationNumber === 'string' ? b.registrationNumber.trim() : '';
  if (!provider) {
    res.status(400).json({ error: 'Выберите способ фискализации' });
    return;
  }
  // A device with no registration number can't be tied to anything the tax
  // authority knows about, so it is not a device.
  if (provider !== 'none' && !registrationNumber) {
    res.status(400).json({ error: 'Укажите регистрационный номер кассового аппарата (РНМ)' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const enabled = provider !== 'none';
  const device = await prisma.fiscalDevice.upsert({
    where: { locationId },
    update: { provider, registrationNumber, enabled },
    create: { locationId, provider, registrationNumber, enabled },
  });

  res.json({ provider: device.provider, registrationNumber: device.registrationNumber, enabled: device.enabled });
});

// Goods a supplier has been asked for and has not yet delivered. Counted
// against a new recommendation, so a shop doesn't order again on top of a
// delivery that is merely late.
async function outstandingOnOrder(companyId: string, locationId: string): Promise<Map<string, number>> {
  const lines = await prisma.documentItem.findMany({
    where: {
      document: {
        companyId,
        locationId,
        type: 'purchase_order',
        status: { in: ['sent', 'partially_received'] },
      },
    },
    select: { productId: true, quantity: true, receivedQuantity: true },
  });

  const byProduct = new Map<string, number>();
  for (const line of lines) {
    const outstanding = Math.max(line.quantity - (line.receivedQuantity ?? 0), 0);
    if (outstanding <= 0) continue;
    byProduct.set(line.productId, (byProduct.get(line.productId) ?? 0) + outstanding);
  }
  return byProduct;
}

function serializePurchaseOrder(order: {
  id: string;
  status: string;
  createdAt: Date;
  expectedAt: Date | null;
  reason: string | null;
  counterparty: { id: string; name: string; phone: string | null } | null;
  createdBy: string | null;
  fulfilledBy: string | null;
  items: {
    id: string;
    productId: string;
    quantity: number;
    receivedQuantity: number | null;
    price: number;
    packQuantity: number | null;
    packPrice: number | null;
    product: { name: string; unit: string };
    packaging: { name: string; unitsPerPack: number } | null;
  }[];
}, nameByUserId: Map<string, string>) {
  return {
    id: order.id,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    expectedAt: order.expectedAt ? order.expectedAt.toISOString() : null,
    note: order.reason ?? '',
    supplier: order.counterparty ? { id: order.counterparty.id, name: order.counterparty.name } : null,
    createdByName: order.createdBy ? nameByUserId.get(order.createdBy) ?? 'Удалённый сотрудник' : null,
    approvedByName: order.fulfilledBy ? nameByUserId.get(order.fulfilledBy) ?? 'Удалённый сотрудник' : null,
    total: order.items.reduce(
      (sum, it) =>
        sum +
        (it.packPrice !== null && it.packQuantity !== null
          ? Math.round(it.packPrice * it.packQuantity)
          : Math.round(it.price * it.quantity)),
      0,
    ),
    items: order.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      name: it.product.name,
      unit: it.product.unit,
      quantity: it.quantity,
      receivedQuantity: it.receivedQuantity ?? 0,
      price: it.price,
      packagingName: it.packaging?.name ?? null,
      packQuantity: it.packQuantity,
      packPrice: it.packPrice,
    })),
  };
}

const PURCHASE_ORDER_INCLUDE = {
  counterparty: true,
  items: { include: { product: true, packaging: true } },
} as const;

posRouter.get('/purchase-orders', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true, users: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Закупки недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const nameByUserId = new Map((company?.users ?? []).map((u) => [u.id, u.name]));
  const orders = await prisma.document.findMany({
    where: { companyId: req.posCompanyId, locationId, type: 'purchase_order' },
    include: PURCHASE_ORDER_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(orders.map((order) => serializePurchaseOrder(order, nameByUserId)));
});

// Created as a draft, always. An order that appears already approved is one
// nobody agreed to pay for.
posRouter.post('/purchase-orders', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const rawItems: { productId: string; quantity: number; price: number; packagingId?: string | null }[] = Array.isArray(b.items)
    ? b.items
    : [];
  if (rawItems.length === 0 || hasInvalidQuantity(rawItems)) {
    res.status(400).json({ error: 'Добавьте хотя бы одну позицию' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Закупки недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const namedPackagingIds = rawItems.map((it) => it.packagingId).filter((id): id is string => !!id);
  const packagings = namedPackagingIds.length
    ? await prisma.productPackaging.findMany({
        where: { id: { in: namedPackagingIds }, product: { companyId: req.posCompanyId } },
      })
    : [];
  // Ordered in the shape the supplier sells: cases, not bottles.
  const packaged = resolvePackagedLines(rawItems, packagings);
  if (packaged.status !== 'ok') {
    res.status(400).json({ error: packagingErrorMessage(packaged) });
    return;
  }

  let counterpartyId: string | undefined;
  if (typeof b.supplierId === 'string' && b.supplierId) {
    const supplier = await prisma.counterparty.findFirst({
      where: { id: b.supplierId, companyId: req.posCompanyId, type: 'supplier' },
    });
    if (!supplier) {
      res.status(404).json({ error: 'Поставщик не найден' });
      return;
    }
    counterpartyId = supplier.id;
  }

  const expectedAt = b.expectedAt ? new Date(b.expectedAt) : null;
  if (expectedAt && Number.isNaN(expectedAt.getTime())) {
    res.status(400).json({ error: 'Некорректная дата поставки' });
    return;
  }

  const order = await prisma.document.create({
    data: {
      companyId: req.posCompanyId!,
      locationId,
      type: 'purchase_order',
      status: 'draft',
      counterpartyId,
      expectedAt,
      reason: typeof b.note === 'string' ? b.note.trim() || null : null,
      createdBy: req.posUserId!,
      items: {
        create: packaged.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          price: line.price,
          packagingId: line.packagingId,
          packQuantity: line.packQuantity,
          packPrice: line.packPrice,
        })),
      },
    },
    include: PURCHASE_ORDER_INCLUDE,
  });

  res.status(201).json(serializePurchaseOrder(order, new Map()));
});

// Approving is the moment somebody takes responsibility for the money, so it
// is the one step a cashier can't do — and sending follows it rather than
// replacing it.
posRouter.post('/purchase-orders/:id/:action', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const action = req.params.action;
  if (action !== 'approve' && action !== 'send' && action !== 'cancel') {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  if ((action === 'approve' || action === 'send') && !(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Согласовать и отправить заказ может владелец или менеджер' });
    return;
  }

  const order = await prisma.document.findFirst({
    where: { id: req.params.id, companyId: req.posCompanyId, type: 'purchase_order' },
  });
  if (!order) {
    res.status(404).json({ error: 'Заказ не найден' });
    return;
  }

  const from = order.status as PurchaseOrderStatus;
  const to = nextStatus(from, action);
  if (!to) {
    res.status(409).json({ error: transitionErrorMessage(from, action) });
    return;
  }

  // Guarded on the status it was read at, so two people acting on the same
  // order at once can't both move it.
  const { count } = await prisma.document.updateMany({
    where: { id: order.id, status: from },
    data: {
      status: to,
      // Who agreed to the spend. Recorded on approval, and kept through the
      // later steps rather than overwritten by whoever pressed send.
      ...(action === 'approve' ? { fulfilledBy: req.posUserId, fulfilledAt: new Date() } : {}),
    },
  });
  if (count === 0) {
    res.status(409).json({ error: 'Статус заказа изменился — обновите список' });
    return;
  }

  res.json({ id: order.id, status: to });
});

// What this supplier charged last time, so a quiet price rise is a question
// asked at the moment it can still be asked.
posRouter.get('/suppliers', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const suppliers = await prisma.counterparty.findMany({
    where: { companyId: req.posCompanyId, type: 'supplier' },
    orderBy: { name: 'asc' },
  });
  res.json(suppliers.map((s) => ({ id: s.id, name: s.name, phone: s.phone ?? '' })));
});

posRouter.get('/suppliers/:id/prices', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const supplier = await prisma.counterparty.findFirst({
    where: { id: req.params.id, companyId: req.posCompanyId, type: 'supplier' },
  });
  if (!supplier) {
    res.status(404).json({ error: 'Поставщик не найден' });
    return;
  }

  const lines = await prisma.documentItem.findMany({
    where: { document: { companyId: req.posCompanyId, type: 'receipt', counterpartyId: supplier.id } },
    include: { product: true, document: { select: { createdAt: true } } },
    orderBy: { document: { createdAt: 'desc' } },
    take: 500,
  });

  const historyByProduct = new Map<string, { price: number; at: Date }[]>();
  for (const line of lines) {
    const list = historyByProduct.get(line.productId) ?? [];
    list.push({ price: line.price, at: line.document.createdAt });
    historyByProduct.set(line.productId, list);
  }

  const nameByProduct = new Map(lines.map((line) => [line.productId, line.product.name]));
  res.json(
    [...historyByProduct.entries()].map(([productId, history]) => {
      const latest = history[0];
      const deviation = detectPriceDeviation(latest.price, history.slice(1));
      return {
        productId,
        name: nameByProduct.get(productId) ?? '—',
        lastPrice: latest.price,
        lastAt: latest.at.toISOString(),
        previousPrice: deviation.previousPrice,
        deviationPercent: deviation.deviationPercent,
        notable: deviation.notable,
      };
    }),
  );
});

// Stock leaving the books because it is broken, expired or simply gone. The
// plainest signal there is that money has been lost, so it carries a countable
// reason, a written one, and a name — and the owner's summary surfaces it
// without any threshold at all.
posRouter.post('/write-offs', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  const lines: { productId: string; quantity: number; batchId?: string | null }[] = Array.isArray(b.items) ? b.items : [];
  if (!isWriteOffReason(b.reasonCode)) {
    res.status(400).json({ error: 'Выберите причину списания' });
    return;
  }
  if (!note) {
    res.status(400).json({ error: 'Опишите, что произошло' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Списания недоступны на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const stockRows = await prisma.stock.findMany({
    where: { locationId, productId: { in: lines.map((line) => line.productId) } },
  });
  const onHandByProduct = new Map<string, number>();
  for (const row of stockRows) {
    onHandByProduct.set(row.productId, (onHandByProduct.get(row.productId) ?? 0) + row.quantity);
  }

  const resolution = resolveWriteOff(lines, onHandByProduct);
  if (resolution.status !== 'ok') {
    res.status(400).json({ error: writeOffErrorMessage(resolution) });
    return;
  }

  const stockByProduct = groupStockByProduct(stockRows);

  try {
    const document = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          companyId: req.posCompanyId!,
          locationId,
          type: 'write_off',
          status: 'confirmed',
          reasonCode: b.reasonCode,
          reason: note,
          createdBy: req.posUserId!,
          items: {
            create: resolution.lines.map((line) => ({
              productId: line.productId,
              batchId: line.batchId,
              quantity: line.quantity,
              price: 0,
            })),
          },
        },
      });

      for (const line of resolution.lines) {
        const rows = stockByProduct.get(line.productId) ?? [];
        await deductAcrossBins(tx, rows, line.quantity, 'write_off', {
          documentId: created.id,
          createdBy: req.posUserId,
        });
        // Quarantined goods that are then written off take their hold with
        // them — otherwise the block outlives the stock and eats availability
        // that no longer exists.
        if (rows[0]) await releaseBlockedOnWriteOff(tx, rows[0].id, line.quantity);
        // Off the batch too, so the expiry that went in the bin stops counting
        // towards what can be sold.
        if (line.batchId) {
          await tx.productBatch.update({
            where: { id: line.batchId },
            data: { quantity: { decrement: line.quantity } },
          });
        }
      }

      return created;
    }, { timeout: 15000 });

    res.status(201).json({ id: document.id, createdAt: document.createdAt.toISOString() });
  } catch (err) {
    if (err instanceof ConcurrentStockChangeError) {
      res.status(409).json({ error: 'Остаток изменился — обновите и повторите' });
      return;
    }
    throw err;
  }
});

posRouter.get('/write-offs', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true, users: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Списания недоступны на вашем тарифе' });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const nameByUserId = new Map((company?.users ?? []).map((u) => [u.id, u.name]));
  const documents = await prisma.document.findMany({
    where: { companyId: req.posCompanyId, locationId, type: { in: ['write_off', 'quarantine'] } },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(
    documents.map((doc) => ({
      id: doc.id,
      type: doc.type,
      createdAt: doc.createdAt.toISOString(),
      reasonCode: doc.reasonCode ?? 'other',
      note: doc.reason ?? '',
      createdByName: doc.createdBy ? nameByUserId.get(doc.createdBy) ?? 'Удалённый сотрудник' : null,
      items: doc.items.map((it) => ({ productId: it.productId, name: it.product.name, quantity: it.quantity })),
    })),
  );
});

// Quarantine is not a write-off. The goods are still there and still the
// shop's; they simply cannot be sold until somebody decides. Nothing moves, so
// no ledger row is written — what explains it is this document.
posRouter.post('/quarantine/:action', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const action = req.params.action;
  if (action !== 'block' && action !== 'release') {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }

  const b = req.body ?? {};
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  const changes: { productId: string; quantity: number }[] = Array.isArray(b.items) ? b.items : [];
  if (action === 'block' && !note) {
    res.status(400).json({ error: 'Опишите, почему товар изолируется' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Карантин недоступен на вашем тарифе' });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const stockRows = await prisma.stock.findMany({
    where: { locationId, productId: { in: changes.map((c) => c.productId) } },
  });
  // Blocking is limited by what is free; releasing by what is actually held.
  const limitByProduct = new Map<string, number>();
  for (const row of stockRows) {
    const limit = action === 'block' ? availableQuantity(row) : row.blocked;
    limitByProduct.set(row.productId, (limitByProduct.get(row.productId) ?? 0) + limit);
  }

  const resolution = resolveQuarantine(changes, action as QuarantineAction, limitByProduct);
  if (resolution.status !== 'ok') {
    res.status(400).json({ error: quarantineErrorMessage(resolution, action as QuarantineAction) });
    return;
  }

  const stockByProduct = groupStockByProduct(stockRows);

  try {
    const document = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          companyId: req.posCompanyId!,
          locationId,
          type: 'quarantine',
          status: action === 'block' ? 'confirmed' : 'cancelled',
          reasonCode: action,
          reason: note || null,
          createdBy: req.posUserId!,
          items: {
            create: resolution.changes.map((change) => ({
              productId: change.productId,
              quantity: change.quantity,
              price: 0,
            })),
          },
        },
      });

      // Spread across the shelves the goods are actually on: isolating a
      // whole bin's worth against one row would block goods that are not there
      // and leave the ones that are on sale.
      for (const change of resolution.changes) {
        const rows = stockByProduct.get(change.productId) ?? [];
        let remaining = change.quantity;
        for (const row of rows) {
          if (remaining <= 0) break;
          const capacity = action === 'block' ? availableQuantity(row) : row.blocked;
          const take = Math.min(capacity, remaining);
          if (take <= 0) continue;
          if (action === 'block') {
            await blockStock(tx, row, take);
          } else {
            await unblockStock(tx, row, take);
          }
          remaining -= take;
        }
        if (remaining > 0) throw new ConcurrentStockChangeError(change.productId);
      }

      return created;
    }, { timeout: 15000 });

    res.status(201).json({ id: document.id, action });
  } catch (err) {
    if (err instanceof ConcurrentStockChangeError) {
      res.status(409).json({ error: 'Остаток изменился — обновите и повторите' });
      return;
    }
    throw err;
  }
});

// The shelves goods can be sent to or found on, and what is on each of them.
// A warehouse's real question is "where is it", and a location total cannot
// answer that however accurate it is.
posRouter.get('/bins', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Адресное хранение недоступно на вашем тарифе' });
    return;
  }
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const [bins, stockRows] = await Promise.all([
    prisma.storageBin.findMany({ where: { locationId }, orderBy: { code: 'asc' } }),
    prisma.stock.findMany({ where: { locationId, quantity: { gt: 0 } }, include: { product: true } }),
  ]);

  const contentsByCode = new Map<string, { productId: string; name: string; quantity: number; available: number }[]>();
  for (const row of stockRows) {
    const list = contentsByCode.get(row.binLocation) ?? [];
    list.push({
      productId: row.productId,
      name: row.product.name,
      quantity: row.quantity,
      available: availableQuantity(row),
    });
    contentsByCode.set(row.binLocation, list);
  }

  res.json({
    // The empty code is not a bin and is never stored as one, but it is a real
    // state: goods that arrived and were never put away. A warehouse needs to
    // see that pile, not have it hidden.
    unplaced: contentsByCode.get('') ?? [],
    bins: bins.map((bin) => ({
      id: bin.id,
      code: bin.code,
      zone: bin.zone,
      rack: bin.rack,
      shelf: bin.shelf,
      bin: bin.bin,
      contents: contentsByCode.get(bin.code) ?? [],
    })),
  });
});

posRouter.post('/bins', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Ячейки настраивает владелец или менеджер' });
    return;
  }

  const b = req.body ?? {};
  const address = resolveBinAddress(b);
  if (address.status !== 'ok') {
    res.status(400).json({ error: binAddressErrorMessage(address.status) });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const existing = await prisma.storageBin.findFirst({ where: { locationId, code: address.code } });
  if (existing) {
    res.status(409).json({ error: `Ячейка ${address.code} уже есть на этой точке` });
    return;
  }

  const bin = await prisma.storageBin.create({
    data: { locationId, code: address.code, ...address.address },
  });
  res.status(201).json({ id: bin.id, code: bin.code, zone: bin.zone, rack: bin.rack, shelf: bin.shelf, bin: bin.bin, contents: [] });
});

posRouter.delete('/bins/:id', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Ячейки настраивает владелец или менеджер' });
    return;
  }

  const bin = await prisma.storageBin.findFirst({
    where: { id: req.params.id, location: { companyId: req.posCompanyId } },
  });
  if (!bin) {
    res.status(404).json({ error: 'Ячейка не найдена' });
    return;
  }

  // Deleting a shelf that still holds goods would leave them addressed to a
  // place that no longer exists — findable by nobody.
  const held = await prisma.stock.count({
    where: { locationId: bin.locationId, binLocation: bin.code, quantity: { gt: 0 } },
  });
  if (held > 0) {
    res.status(409).json({ error: 'В ячейке есть товар — сначала переместите его' });
    return;
  }

  await prisma.storageBin.delete({ where: { id: bin.id } });
  res.json({ ok: true });
});

// Putting goods away, or moving them between shelves. Nothing enters or leaves
// the building, so the location's total is unchanged — which is exactly why it
// is one operation rather than two movements that could each fail alone.
posRouter.post('/bins/putaway', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const quantity = Number(b.quantity);
  const fromBin = typeof b.fromBin === 'string' ? b.fromBin.trim().toUpperCase() : '';
  const toBin = typeof b.toBin === 'string' ? b.toBin.trim().toUpperCase() : '';
  if (!b.productId) {
    res.status(400).json({ error: 'Выберите товар' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const modules: string[] = company?.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('warehouse')) {
    res.status(403).json({ error: 'Адресное хранение недоступно на вашем тарифе' });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  // A destination has to be a shelf somebody labelled. Sending goods to a
  // made-up address is the same as losing them.
  if (toBin !== '') {
    const destination = await prisma.storageBin.findFirst({ where: { locationId, code: toBin } });
    if (!destination) {
      res.status(404).json({ error: `Ячейки ${toBin} нет на этой точке` });
      return;
    }
  }

  const source = await prisma.stock.findFirst({
    where: { productId: b.productId, locationId, binLocation: fromBin },
  });
  const validation = validatePutaway({
    quantity,
    fromBinCode: fromBin,
    toBinCode: toBin,
    // Reserved and quarantined goods stay where they are: something has been
    // promised or decided about them at that address.
    availableInSource: source ? availableQuantity(source) : 0,
  });
  if (validation.status !== 'ok') {
    res.status(400).json({ error: putawayErrorMessage(validation) });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await applyStockDelta(tx, source!, -quantity, 'adjustment', { createdBy: req.posUserId });

      const destinationRow = await tx.stock.findFirst({ where: { productId: b.productId, locationId, binLocation: toBin } });
      if (destinationRow) {
        await applyStockDelta(tx, destinationRow, quantity, 'adjustment', { createdBy: req.posUserId });
      } else {
        await createStockWithMovement(tx, {
          productId: b.productId,
          locationId,
          quantity,
          reason: 'adjustment',
          createdBy: req.posUserId,
          binLocation: toBin,
        });
      }
    }, { timeout: 15000 });
  } catch (err) {
    if (err instanceof ConcurrentStockChangeError) {
      res.status(409).json({ error: 'Остаток в ячейке изменился — обновите и повторите' });
      return;
    }
    throw err;
  }

  res.json({ productId: b.productId, fromBin, toBin, quantity });
});

export interface CounterpartyLedger {
  charges: Charge[];
  /** Money paid that has not been applied to any particular document. */
  unapplied: number;
}

// Everything a set of counterparties was ever charged, and what has been
// settled against each of it. Sales on credit for a customer; deliveries for a
// supplier — a shop owes for goods the moment they arrive, not when somebody
// gets round to the invoice.
//
// Batched on purpose. Loading this per counterparty is two queries each, and
// the two screens that need it — the debt list and the owner's summary — need
// it for everybody at once. At fifty regulars that is a hundred round trips to
// answer one question.
async function loadLedgers(
  companyId: string,
  counterpartyIds: string[],
  type: string,
): Promise<Map<string, CounterpartyLedger>> {
  const ledgers = new Map<string, CounterpartyLedger>();
  for (const id of counterpartyIds) ledgers.set(id, { charges: [], unapplied: 0 });
  if (counterpartyIds.length === 0) return ledgers;

  const chargeType = type === 'supplier' ? 'receipt' : 'sale';
  const [documents, settlements] = await Promise.all([
    prisma.document.findMany({
      where: {
        companyId,
        counterpartyId: { in: counterpartyIds },
        type: chargeType,
        status: 'confirmed',
        ...(chargeType === 'sale' ? { paymentMethod: 'credit' } : {}),
      },
      include: { items: true },
    }),
    prisma.settlement.findMany({ where: { companyId, counterpartyId: { in: counterpartyIds } } }),
  ]);

  const settledByDocument = new Map<string, number>();
  for (const settlement of settlements) {
    if (settlement.documentId) {
      settledByDocument.set(
        settlement.documentId,
        (settledByDocument.get(settlement.documentId) ?? 0) + settlement.amount,
      );
      continue;
    }
    const ledger = ledgers.get(settlement.counterpartyId);
    if (ledger) ledger.unapplied += settlement.amount;
  }

  for (const doc of documents) {
    if (!doc.counterpartyId) continue;
    const ledger = ledgers.get(doc.counterpartyId);
    if (!ledger) continue;
    ledger.charges.push({
      documentId: doc.id,
      // A receipt is billed at what was actually paid per pack, not the
      // rounded per-unit figure times the units — the same reading the receipt
      // list uses.
      amount: doc.items.reduce(
        (sum, it) =>
          sum +
          (it.packPrice !== null && it.packQuantity !== null
            ? Math.round(it.packPrice * it.packQuantity)
            : Math.round(it.price * it.quantity)),
        0,
      ),
      settled: settledByDocument.get(doc.id) ?? 0,
      at: doc.createdAt,
    });
  }

  return ledgers;
}

async function loadLedger(companyId: string, counterpartyId: string, type: string): Promise<CounterpartyLedger> {
  const ledgers = await loadLedgers(companyId, [counterpartyId], type);
  return ledgers.get(counterpartyId) ?? { charges: [], unapplied: 0 };
}

// Who owes the shop, who the shop owes, and how old the money is. A single
// "total debt" figure hides the only part that matters: the same sum owed
// since yesterday and owed since spring are different situations.
posRouter.get('/settlements', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Расчёты доступны владельцу и менеджеру' });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.posCompanyId }, include: { tariff: true } });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const type = req.query.type === 'supplier' ? 'supplier' : 'customer';
  const counterparties = await prisma.counterparty.findMany({
    where: { companyId: req.posCompanyId, type },
    orderBy: { name: 'asc' },
  });

  const now = new Date();
  const ledgers = await loadLedgers(req.posCompanyId!, counterparties.map((c) => c.id), type);
  const rows = counterparties.map((counterparty) => {
    const ledger = ledgers.get(counterparty.id) ?? { charges: [], unapplied: 0 };
    return {
      counterpartyId: counterparty.id,
      name: counterparty.name,
      phone: counterparty.phone ?? '',
      creditAllowed: counterparty.creditAllowed,
      creditLimit: counterparty.creditLimit,
      ...computeBalance(ledger.charges, ledger.unapplied),
      aging: buildAging(ledger.charges, now),
    };
  });

  // Only accounts with something outstanding — an owner opens this to act, and
  // a list of everyone they have ever sold to is not a list of anything.
  res.json({ type, accounts: rows.filter((row) => row.balance !== 0).sort((a, b) => b.balance - a.balance) });
});

posRouter.get('/settlements/:counterpartyId', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Расчёты доступны владельцу и менеджеру' });
    return;
  }

  const counterparty = await prisma.counterparty.findFirst({
    where: { id: req.params.counterpartyId, companyId: req.posCompanyId },
  });
  if (!counterparty) {
    res.status(404).json({ error: 'Контрагент не найден' });
    return;
  }

  const [ledger, payments] = await Promise.all([
    loadLedger(req.posCompanyId!, counterparty.id, counterparty.type),
    prisma.settlement.findMany({
      where: { companyId: req.posCompanyId, counterpartyId: counterparty.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);
  const charges = ledger.charges;
  const unapplied = ledger.unapplied;

  res.json({
    counterparty: {
      id: counterparty.id,
      name: counterparty.name,
      type: counterparty.type,
      creditAllowed: counterparty.creditAllowed,
      creditLimit: counterparty.creditLimit,
    },
    ...computeBalance(charges, unapplied),
    aging: buildAging(charges, new Date()),
    charges: charges
      .map((charge) => ({
        documentId: charge.documentId,
        amount: charge.amount,
        settled: charge.settled,
        at: charge.at.toISOString(),
      }))
      .sort((a, b) => (a.at < b.at ? 1 : -1)),
    payments: payments.map((payment) => ({
      id: payment.id,
      direction: payment.direction,
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      documentId: payment.documentId,
      note: payment.note ?? '',
      createdAt: payment.createdAt.toISOString(),
    })),
  });
});

// Taking money in from a customer, or paying a supplier. The payment closes
// the oldest debts first and whatever is left sits on the account: a system
// that refuses cash just means somebody writes it in a notebook.
posRouter.post('/settlements', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const amount = Math.round(Number(b.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'Введите сумму платежа' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const counterparty = await prisma.counterparty.findFirst({
    where: { id: b.counterpartyId, companyId: req.posCompanyId },
  });
  if (!counterparty) {
    res.status(404).json({ error: 'Контрагент не найден' });
    return;
  }
  // Paying a supplier is spending the company's money, which is not a
  // cashier's decision. Taking a customer's payment is.
  const direction = counterparty.type === 'supplier' ? 'out' : 'in';
  if (direction === 'out' && !(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Оплату поставщику проводит владелец или менеджер' });
    return;
  }

  const ledger = await loadLedger(req.posCompanyId!, counterparty.id, counterparty.type);
  const charges = ledger.charges;
  const { allocations, unapplied } = allocatePayment(amount, charges);

  const created = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const allocation of allocations) {
      rows.push(
        await tx.settlement.create({
          data: {
            companyId: req.posCompanyId!,
            locationId,
            counterpartyId: counterparty.id,
            direction,
            amount: allocation.amount,
            paymentMethod: typeof b.paymentMethod === 'string' ? b.paymentMethod : 'cash',
            documentId: allocation.documentId,
            note: typeof b.note === 'string' ? b.note.trim() || null : null,
            createdBy: req.posUserId,
          },
        }),
      );
    }
    if (unapplied > 0) {
      rows.push(
        await tx.settlement.create({
          data: {
            companyId: req.posCompanyId!,
            locationId,
            counterpartyId: counterparty.id,
            direction,
            amount: unapplied,
            paymentMethod: typeof b.paymentMethod === 'string' ? b.paymentMethod : 'cash',
            note: typeof b.note === 'string' ? b.note.trim() || null : null,
            createdBy: req.posUserId,
          },
        }),
      );
    }
    return rows;
  }, { timeout: 15000 });

  const after = computeBalance(
    charges.map((charge) => ({
      ...charge,
      settled: charge.settled + (allocations.find((a) => a.documentId === charge.documentId)?.amount ?? 0),
    })),
    ledger.unapplied + unapplied,
  );

  res.status(201).json({
    settlements: created.length,
    applied: allocations,
    unapplied,
    balance: after.balance,
  });
});

// Whether an account may take goods away without paying, and how far. The
// permission an owner grants, and the only thing standing between "on credit"
// and "given away".
posRouter.put('/counterparties/:id/credit', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Долг разрешает владелец или менеджер' });
    return;
  }

  const b = req.body ?? {};
  const creditLimit = Math.round(Number(b.creditLimit ?? 0));
  if (!Number.isFinite(creditLimit) || creditLimit < 0) {
    res.status(400).json({ error: 'Некорректный лимит долга' });
    return;
  }

  const counterparty = await prisma.counterparty.findFirst({
    where: { id: req.params.id, companyId: req.posCompanyId },
  });
  if (!counterparty) {
    res.status(404).json({ error: 'Контрагент не найден' });
    return;
  }

  const updated = await prisma.counterparty.update({
    where: { id: counterparty.id },
    data: { creditAllowed: b.creditAllowed === true, creditLimit },
  });

  res.json({ id: updated.id, creditAllowed: updated.creditAllowed, creditLimit: updated.creditLimit });
});

// The list somebody walks the shelf with: what the system believes is on it,
// so a counter has something to disagree with. Counting from memory finds
// miscounts and never finds missing goods.
posRouter.get('/counts/sheet', requirePosAuth, async (req: PosAuthedRequest, res) => {
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

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  // No bin named means the unplaced pile, which is countable like any shelf
  // and is usually the one most worth counting.
  const requested = typeof req.query.bin === 'string' ? req.query.bin.trim().toUpperCase() : '';
  const rows = await prisma.stock.findMany({
    where: { locationId, binLocation: requested },
    include: { product: true },
    orderBy: { product: { name: 'asc' } },
  });

  res.json({
    bin: requested,
    lines: rows
      .filter((row) => row.quantity !== 0)
      .map((row) => ({
        productId: row.productId,
        name: row.product.name,
        unit: row.product.unit,
        systemQuantity: row.quantity,
        // Shown so a counter knows why a figure may look odd: goods held for
        // an order or sitting in quarantine are still on the shelf.
        reserved: row.reserved,
        blocked: row.blocked,
      })),
  });
});

// Counting shelves rather than a building. This is what makes counting in
// parts real: a rack today, another tomorrow, without closing the shop — and
// the whole rack is settled each time rather than only the lines somebody
// happened to type.
posRouter.post('/counts/by-bin', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const rawLines: { productId: string; binLocation?: string; countedQuantity: number }[] = Array.isArray(b.items)
    ? b.items
    : [];
  const walkedBins: string[] = Array.isArray(b.bins)
    ? b.bins.map((code: unknown) => (typeof code === 'string' ? code.trim().toUpperCase() : '')).filter((code: string) => code !== undefined)
    : [];
  if (walkedBins.length === 0 && rawLines.length === 0) {
    res.status(400).json({ error: 'Укажите, какие ячейки пересчитали' });
    return;
  }
  if (hasInvalidCountedQuantity(rawLines)) {
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

  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const counted: BinCountLine[] = rawLines.map((line) => ({
    productId: line.productId,
    binLocation: typeof line.binLocation === 'string' ? line.binLocation.trim().toUpperCase() : '',
    countedQuantity: line.countedQuantity,
  }));
  const scope = [...new Set([...walkedBins, ...counted.map((line) => line.binLocation)])];

  const stockRows = await prisma.stock.findMany({ where: { locationId, binLocation: { in: scope } } });
  const system: BinSystemQuantity[] = stockRows.map((row) => ({
    productId: row.productId,
    binLocation: row.binLocation,
    quantity: row.quantity,
  }));

  const adjustments = computeBinCountAdjustments(counted, system, scope);
  const rowByKey = new Map(stockRows.map((row) => [binCountKey(row.productId, row.binLocation), row]));

  const document = await prisma.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        companyId: req.posCompanyId!,
        locationId,
        type: 'adjustment',
        status: 'confirmed',
        reason: `Пересчёт ячеек: ${scope.map((code) => code || 'не размещено').join(', ')}`,
        createdBy: req.posUserId!,
        items: {
          create: adjustments.map((adjustment) => ({
            productId: adjustment.productId,
            quantity: adjustment.delta,
            price: 0,
          })),
        },
      },
    });

    for (const adjustment of adjustments) {
      const row = rowByKey.get(binCountKey(adjustment.productId, adjustment.binLocation));
      if (row) {
        // Straight at the row for this shelf: a count is a statement about one
        // shelf, so it must not be spread across the others the way a sale is.
        await applyStockDelta(tx, row, adjustment.delta, 'adjustment', {
          documentId: created.id,
          createdBy: req.posUserId,
        });
      } else if (adjustment.delta > 0) {
        await createStockWithMovement(tx, {
          productId: adjustment.productId,
          locationId,
          quantity: adjustment.delta,
          reason: 'adjustment',
          documentId: created.id,
          createdBy: req.posUserId,
          binLocation: adjustment.binLocation,
        });
      }
    }

    return created;
  }, { timeout: 15000 });

  res.status(201).json({
    id: document.id,
    createdAt: document.createdAt.toISOString(),
    bins: scope,
    adjustments: adjustments.map((adjustment) => ({
      productId: adjustment.productId,
      binLocation: adjustment.binLocation,
      systemQuantity: adjustment.systemQuantity,
      countedQuantity: adjustment.countedQuantity,
      delta: adjustment.delta,
    })),
  });
});

// Stock.quantity is a cache over the movement ledger, and the promise that
// every figure can be traced rests on the two agreeing. Nothing checked that
// they did: it held because every write goes through two helpers, which is a
// fact about today's code rather than a property of the data.
//
// This states the invariant as an assertion instead of a convention, and is
// the only thing that can catch a write which changes stock without writing a
// movement — including one introduced tomorrow.
async function findLedgerMismatches(companyId: string, locationId: string) {
  const [grouped, stockRows] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ['productId', 'binLocation'],
      where: { locationId },
      _sum: { quantity: true },
    }),
    prisma.stock.findMany({ where: { locationId } }),
  ]);

  const ledgerTotals: LedgerTotal[] = grouped.map((row) => ({
    productId: row.productId,
    binLocation: row.binLocation,
    total: row._sum.quantity ?? 0,
  }));
  const cached: CachedQuantity[] = stockRows.map((row) => ({
    productId: row.productId,
    binLocation: row.binLocation,
    quantity: row.quantity,
  }));

  return { ledgerTotals, mismatches: reconcileBalances(ledgerTotals, cached) };
}

posRouter.get('/reconciliation', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Сверка доступна владельцу и менеджеру' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const state = tariffState(company?.tariff ?? null);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const { ledgerTotals, mismatches } = await findLedgerMismatches(req.posCompanyId!, locationId);
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(mismatches.map((m) => m.productId))] } },
    select: { id: true, name: true, unit: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  res.json({
    locationId,
    checkedAt: new Date().toISOString(),
    ...summarize(ledgerTotals, mismatches),
    mismatches: mismatches.slice(0, 100).map((mismatch) => ({
      productId: mismatch.productId,
      name: productById.get(mismatch.productId)?.name ?? '—',
      unit: productById.get(mismatch.productId)?.unit ?? '',
      binLocation: mismatch.binLocation,
      ledger: mismatch.ledger,
      cached: mismatch.cached,
      difference: mismatch.difference,
      kind: mismatch.kind,
      explanation: mismatchExplanation(mismatch.kind),
    })),
  });
});

// Rebuilding the cache from the ledger, which is the only repair that makes
// sense: the ledger is the source of truth by construction, so where they
// disagree the ledger is right and the cache is wrong.
//
// No movement is written. Nothing moved — a wrong number was corrected — and
// writing one would change the ledger sum too and fix nothing. What records it
// is a document, the same shape quarantine uses for the same reason.
posRouter.post('/reconciliation/repair', requirePosAuth, async (req: PosAuthedRequest, res) => {
  if (!(await requireOwnerOrManager(req.posUserId))) {
    res.status(403).json({ error: 'Сверка доступна владельцу и менеджеру' });
    return;
  }

  const b = req.body ?? {};
  const company = await prisma.company.findUnique({
    where: { id: req.posCompanyId },
    include: { tariff: true, locations: true },
  });
  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const { mismatches } = await findLedgerMismatches(req.posCompanyId!, locationId);
  if (mismatches.length === 0) {
    res.json({ repaired: 0, documentId: null });
    return;
  }

  const document = await prisma.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        companyId: req.posCompanyId!,
        locationId,
        type: 'reconciliation',
        status: 'confirmed',
        reason: `Сверка журнала: исправлено позиций ${mismatches.length}`,
        createdBy: req.posUserId!,
        items: {
          // The correction, signed the way every other document's quantity is:
          // what the number moved by, so the document reads like the others.
          create: mismatches.map((mismatch) => ({
            productId: mismatch.productId,
            quantity: -mismatch.difference,
            price: 0,
          })),
        },
      },
    });

    for (const mismatch of mismatches) {
      if (mismatch.kind === 'missing_row') {
        await tx.stock.create({
          data: {
            productId: mismatch.productId,
            locationId,
            binLocation: mismatch.binLocation,
            quantity: mismatch.ledger,
          },
        });
        continue;
      }
      // Set, not incremented: the point is to make the cache equal the ledger,
      // and an increment computed from a value read a moment ago is exactly
      // the pattern that let them drift apart in the first place.
      await tx.$executeRaw`
        UPDATE "stocks" SET "quantity" = ${mismatch.ledger}
        WHERE "locationId" = ${locationId}
          AND "productId" = ${mismatch.productId}
          AND "binLocation" = ${mismatch.binLocation}`;
    }

    return created;
  }, { timeout: 30000 });

  res.json({ repaired: mismatches.length, documentId: document.id });
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

  const locationId = resolveLocationOrRespond(company?.locations ?? [], req.query.locationId, res);
  if (!locationId) return;

  const batches = await prisma.productBatch.findMany({
    where: { locationId },
    include: { product: true },
    orderBy: { expiryDate: 'asc' },
  });

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

  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.productBatch.create({
      data: { productId: product.id, locationId, batchNumber, expiryDate, quantity },
    });

    const stock = await tx.stock.findFirst({ where: { productId: product.id, locationId, binLocation: '' } });
    if (stock) {
      await applyStockDelta(tx, stock, quantity, 'batch_receipt', { createdBy: req.posUserId });
    } else {
      await createStockWithMovement(tx, { productId: product.id, locationId, quantity, reason: 'batch_receipt', createdBy: req.posUserId });
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
      const stockByProduct = groupStockByProduct(stockRows);
      // Checked against what is physically here, not what is available: the
      // units this order is about to take are the ones it reserved when it was
      // placed, so its own hold must not read as somebody else's claim.
      const quantityByProduct = new Map(
        [...stockByProduct.entries()].map(([productId, rows]) => [productId, totalOnHand(rows)]),
      );

      const shortages = findStockShortages(
        order.items.map((it) => ({ productId: it.productId, quantity: it.quantity, price: it.price })),
        quantityByProduct,
      );
      if (shortages.length > 0) {
        throw new StockError(shortages);
      }

      for (const item of order.items) {
        const rows = stockByProduct.get(item.productId) ?? [];
        // Released before the deduction, in this order: the deduction respects
        // reservations, so this order's own hold would otherwise block it. The
        // hold was taken against one row, so it comes off the same one.
        if (rows[0]) await releaseStock(tx, rows[0].id, item.quantity);
        await deductAcrossBins(tx, rows, item.quantity, 'order_fulfill', {
          documentId: order.id,
          createdBy: req.posUserId,
        });
      }

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

  await prisma.$transaction(async (tx) => {
    // The goods go back on sale the moment the order stops being one. Leaving
    // the hold in place would quietly shrink the shelf for everyone else.
    const stockRows = await tx.stock.findMany({
      where: { locationId: order.locationId, productId: { in: order.items.map((it) => it.productId) } },
    });
    const stockByProduct = new Map(stockRows.map((s) => [s.productId, s]));
    for (const item of order.items) {
      const stock = stockByProduct.get(item.productId);
      if (stock) await releaseStock(tx, stock.id, item.quantity);
    }

    await tx.document.update({
      where: { id: order.id },
      data: { status: 'cancelled', fulfilledBy: req.posUserId, fulfilledAt: new Date() },
    });
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
      status: t.status,
      fromLocationId: t.locationId,
      toLocationId: t.toLocationId ?? '',
      fromLocationName: t.location.name,
      toLocationName: t.toLocation?.name ?? '—',
      receivedAt: t.fulfilledAt ? t.fulfilledAt.toISOString() : null,
      items: t.items.map((it) => ({
        productId: it.productId,
        name: it.product.name,
        quantity: it.quantity,
        // Null while the goods are still on their way. Once received, a value
        // below `quantity` is the shortfall that went missing in transit.
        receivedQuantity: it.receivedQuantity,
      })),
    })),
  );
});

posRouter.post('/transfers', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const items: { productId: string; quantity: number }[] = Array.isArray(b.items) ? b.items : [];
  if (items.length === 0 || hasInvalidQuantity(items)) {
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

  // The source used to be the company's first location no matter where the
  // user was standing, so a warehouse hand shipping to a shop moved stock out
  // of whichever location happened to sort first.
  const transfer = resolveTransferLocations(company?.locations ?? [], b.fromLocationId, b.toLocationId);
  if (transfer.status !== 'ok') {
    res.status(transfer.status === 'unknown' ? 404 : 400).json({ error: locationErrorMessage(transfer.status) });
    return;
  }
  const { fromLocationId, toLocationId } = transfer;

  try {
    const document = await prisma.$transaction(async (tx) => {
      const sourceStockRows = await tx.stock.findMany({
        where: { locationId: fromLocationId, productId: { in: items.map((it) => it.productId) } },
      });
      const sourceStockByProduct = groupStockByProduct(sourceStockRows);
      const quantityByProduct = new Map(
        [...sourceStockByProduct.entries()].map(([productId, rows]) => [productId, totalAvailable(rows)]),
      );

      // Per product, not per line — two lines of the same product would
      // otherwise each pass the check and each write from the same starting
      // quantity, moving one line's worth while the document claims two.
      const moves = aggregateRequestedQuantities(
        items.map((it) => ({ productId: it.productId, quantity: it.quantity, price: 0 })),
      );

      const shortages = findStockShortages(moves, quantityByProduct);
      if (shortages.length > 0) {
        throw new StockError(shortages);
      }

      const document = await tx.document.create({
        data: {
          companyId: req.posCompanyId!,
          locationId: fromLocationId,
          toLocationId,
          type: 'transfer',
          // Goods on a van are at neither end. Booking them into the
          // destination the moment they left made the same units countable in
          // two places at once and sellable at a shop that had not seen them.
          // They stay here until somebody at the far end receives them.
          status: 'in_transit',
          createdBy: req.posUserId!,
          // One line per product, matching the one movement each product got.
          // Two lines of the same product would leave receipt ambiguous —
          // which of them did the four units that turned up belong to?
          items: { create: moves.map((m) => ({ productId: m.productId, quantity: m.quantity, price: 0 })) },
        },
        include: { items: true },
      });

      // Only the source moves. The destination gets nothing until receipt —
      // that gap is what "in transit" means, and it is why a transfer's
      // shortfall is discoverable at all.
      await Promise.all(
        moves.map((move) =>
          deductAcrossBins(tx, sourceStockByProduct.get(move.productId) ?? [], move.quantity, 'transfer_out', {
            documentId: document.id,
            createdBy: req.posUserId,
          }),
        ),
      );

      return document;
    }, { timeout: 15000 });

    res.status(201).json({ id: document.id, createdAt: document.createdAt.toISOString(), status: 'in_transit' });
  } catch (err) {
    if (err instanceof StockError) {
      res.status(409).json({ error: 'Недостаточно товара на складе', shortages: err.shortages });
      return;
    }
    throw err;
  }
});

// Receiving is what ends a transfer: the goods stop being in transit and
// become the destination's stock. A count that comes up short does not block
// the receipt — the goods really are gone, and refusing to record that would
// leave them in transit forever. The shortfall is written onto the document
// instead, where it can be looked into.
posRouter.post('/transfers/:id/receive', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
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

  const transferDoc = await prisma.document.findFirst({
    where: { id: req.params.id, companyId: req.posCompanyId, type: 'transfer' },
    include: { items: true },
  });
  if (!transferDoc || !transferDoc.toLocationId) {
    res.status(404).json({ error: 'Перемещение не найдено' });
    return;
  }
  if (transferDoc.status !== 'in_transit') {
    res.status(409).json({ error: 'Перемещение уже закрыто' });
    return;
  }

  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;
  // Only the far end may receive — a transfer means nothing if the sender can
  // also sign for what turned up.
  if (locationId !== transferDoc.toLocationId) {
    res.status(403).json({ error: 'Принять перемещение может только точка назначения' });
    return;
  }

  const receipt = resolveTransferReceipt(
    transferDoc.items.map((it) => ({ productId: it.productId, quantity: it.quantity })),
    Array.isArray(b.items) ? b.items : undefined,
  );
  if (receipt.status !== 'ok') {
    res.status(400).json({ error: transferReceiptErrorMessage(receipt) });
    return;
  }

  const toLocationId = transferDoc.toLocationId;
  const itemIdByProduct = new Map(transferDoc.items.map((it) => [it.productId, it.id]));

  try {
    await prisma.$transaction(async (tx) => {
      // Claimed before anything moves, so two people receiving the same van at
      // once can't both add its contents to the shelf.
      const claimed = await tx.document.updateMany({
        where: { id: transferDoc.id, status: 'in_transit' },
        data: { status: 'confirmed', fulfilledBy: req.posUserId, fulfilledAt: new Date() },
      });
      if (claimed.count === 0) throw new TransferClosedError();

      const destStockRows = await tx.stock.findMany({
        where: { locationId: toLocationId, productId: { in: receipt.lines.map((l) => l.productId) } },
      });
      const destStockByProduct = new Map(destStockRows.map((s) => [s.productId, s]));

      for (const line of receipt.lines) {
        await tx.documentItem.update({
          where: { id: itemIdByProduct.get(line.productId)! },
          data: { receivedQuantity: line.received },
        });
        // A line that arrived with nothing books no movement: nothing reached
        // this location. What left the source is still on the document.
        if (line.received === 0) continue;

        const dest = destStockByProduct.get(line.productId);
        if (dest) {
          await applyStockDelta(tx, dest, line.received, 'transfer_in', { documentId: transferDoc.id, createdBy: req.posUserId });
        } else {
          await createStockWithMovement(tx, {
            productId: line.productId,
            locationId: toLocationId,
            quantity: line.received,
            reason: 'transfer_in',
            documentId: transferDoc.id,
            createdBy: req.posUserId,
          });
        }
      }
    }, { timeout: 15000 });
  } catch (err) {
    if (err instanceof TransferClosedError) {
      res.status(409).json({ error: 'Перемещение уже закрыто' });
      return;
    }
    throw err;
  }

  res.json({ id: transferDoc.id, status: 'confirmed', hasShortfall: receipt.hasShortfall, lines: receipt.lines });
});

// The van turned back. Goods that never left the yard belong to the source
// again — leaving them in transit would strand them at neither end.
posRouter.post('/transfers/:id/cancel', requirePosAuth, async (req: PosAuthedRequest, res) => {
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

  const transferDoc = await prisma.document.findFirst({
    where: { id: req.params.id, companyId: req.posCompanyId, type: 'transfer' },
    include: { items: true },
  });
  if (!transferDoc) {
    res.status(404).json({ error: 'Перемещение не найдено' });
    return;
  }
  if (transferDoc.status !== 'in_transit') {
    res.status(409).json({ error: 'Перемещение уже закрыто' });
    return;
  }

  const fromLocationId = transferDoc.locationId;

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.document.updateMany({
        where: { id: transferDoc.id, status: 'in_transit' },
        data: { status: 'cancelled', fulfilledBy: req.posUserId, fulfilledAt: new Date() },
      });
      if (claimed.count === 0) throw new TransferClosedError();

      const sourceStockRows = await tx.stock.findMany({
        where: { locationId: fromLocationId, productId: { in: transferDoc.items.map((it) => it.productId) } },
      });
      const sourceStockByProduct = new Map(sourceStockRows.map((s) => [s.productId, s]));

      for (const item of transferDoc.items) {
        const source = sourceStockByProduct.get(item.productId);
        if (source) {
          await applyStockDelta(tx, source, item.quantity, 'transfer_cancelled', { documentId: transferDoc.id, createdBy: req.posUserId });
        } else {
          await createStockWithMovement(tx, {
            productId: item.productId,
            locationId: fromLocationId,
            quantity: item.quantity,
            reason: 'transfer_cancelled',
            documentId: transferDoc.id,
            createdBy: req.posUserId,
          });
        }
      }
    }, { timeout: 15000 });
  } catch (err) {
    if (err instanceof TransferClosedError) {
      res.status(409).json({ error: 'Перемещение уже закрыто' });
      return;
    }
    throw err;
  }

  res.json({ id: transferDoc.id, status: 'cancelled' });
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
    include: { items: { include: { product: true, packaging: true } }, counterparty: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(
    receipts.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      supplierName: r.counterparty?.name ?? null,
      items: r.items.map((it) => ({
        productId: it.productId,
        name: it.product.name,
        quantity: it.quantity,
        price: it.price,
        // What the storeman actually counted, so the document reads back the
        // way it was entered rather than as a bare pile of base units.
        packagingName: it.packaging?.name ?? null,
        packQuantity: it.packQuantity,
        packPrice: it.packPrice,
      })),
    })),
  );
});

posRouter.post('/receipts', requirePosAuth, async (req: PosAuthedRequest, res) => {
  const b = req.body ?? {};
  const rawItems: { productId: string; quantity: number; price: number; packagingId?: string | null }[] = Array.isArray(b.items)
    ? b.items
    : [];
  if (rawItems.length === 0 || hasInvalidQuantity(rawItems)) {
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

  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  // A line's quantity is however many of the thing the storeman handled — two
  // cases, not forty-eight bottles. Everything past this point is base units.
  const namedPackagingIds = rawItems.map((it) => it.packagingId).filter((id): id is string => !!id);
  const packagings = namedPackagingIds.length
    ? await prisma.productPackaging.findMany({
        where: { id: { in: namedPackagingIds }, product: { companyId: req.posCompanyId } },
      })
    : [];
  const packaged = resolvePackagedLines(rawItems, packagings);
  if (packaged.status !== 'ok') {
    res.status(400).json({ error: packagingErrorMessage(packaged) });
    return;
  }
  const items = packaged.lines;

  // A delivery can answer an order, and then the shop can tell a short
  // delivery from a small order — which is the whole reason to order through
  // a document rather than a note on a phone.
  const purchaseOrder =
    typeof b.purchaseOrderId === 'string' && b.purchaseOrderId
      ? await prisma.document.findFirst({
          where: { id: b.purchaseOrderId, companyId: req.posCompanyId, type: 'purchase_order' },
          include: { items: true },
        })
      : null;
  if (b.purchaseOrderId && !purchaseOrder) {
    res.status(404).json({ error: 'Заказ поставщику не найден' });
    return;
  }
  if (purchaseOrder && !canTransition(purchaseOrder.status as PurchaseOrderStatus, 'receive')) {
    res.status(409).json({ error: transitionErrorMessage(purchaseOrder.status as PurchaseOrderStatus, 'receive') });
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

  // One order line per product, so a delivery line maps to exactly one of
  // them — the order's lines are written aggregated for the same reason a
  // transfer's are.
  const orderItemIdByProduct = new Map((purchaseOrder?.items ?? []).map((item) => [item.productId, item.id]));

  const document = await prisma.$transaction(async (tx) => {
    const stockRows = await tx.stock.findMany({
      where: { locationId, productId: { in: items.map((it) => it.productId) } },
    });
    const stockByProduct = new Map(stockRows.map((s) => [s.productId, s]));

    const document = await tx.document.create({
      data: {
        companyId: req.posCompanyId!,
        locationId,
        type: 'receipt',
        status: 'confirmed',
        counterpartyId,
        createdBy: req.posUserId!,
        items: {
          create: items.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            price: it.price ?? 0,
            packagingId: it.packagingId,
            packQuantity: it.packQuantity,
            packPrice: it.packPrice,
            // Points at the order line this delivery answers, so what was
            // promised and what turned up stay attached to each other.
            originalItemId: orderItemIdByProduct.get(it.productId) ?? null,
          })),
        },
      },
      include: { items: true },
    });

    if (purchaseOrder) {
      const receivedByLine = new Map<string, number>();
      for (const line of items) {
        const orderItemId = orderItemIdByProduct.get(line.productId);
        if (!orderItemId) continue;
        receivedByLine.set(orderItemId, (receivedByLine.get(orderItemId) ?? 0) + line.quantity);
      }

      const lines: OrderedLine[] = purchaseOrder.items.map((item) => ({
        itemId: item.id,
        productId: item.productId,
        quantity: item.quantity,
        receivedQuantity: (item.receivedQuantity ?? 0) + (receivedByLine.get(item.id) ?? 0),
      }));
      const progress = computeOrderProgress(lines);

      for (const line of lines) {
        await tx.documentItem.update({ where: { id: line.itemId }, data: { receivedQuantity: line.receivedQuantity } });
      }
      await tx.document.update({ where: { id: purchaseOrder.id }, data: { status: progress.status } });
    }

    const updates: Promise<unknown>[] = [];
    for (const item of items) {
      const existing = stockByProduct.get(item.productId);
      if (existing) {
        updates.push(applyStockDelta(tx, existing, item.quantity, 'receipt', { documentId: document.id, createdBy: req.posUserId }));
      } else {
        updates.push(
          createStockWithMovement(tx, {
            productId: item.productId,
            locationId,
            quantity: item.quantity,
            reason: 'receipt',
            documentId: document.id,
            createdBy: req.posUserId,
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
  if (items.length === 0 || hasInvalidCountedQuantity(items)) {
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

  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const document = await prisma.$transaction(async (tx) => {
    const stockRows = await tx.stock.findMany({
      where: { locationId, productId: { in: items.map((it) => it.productId) } },
    });
    const stockByProduct = groupStockByProduct(stockRows);
    // Counted against everything the point holds, across every bin. Comparing
    // a counted shelf against one row of several would report a shortage that
    // is sitting on the next rack.
    const quantityByProduct = new Map(
      [...stockByProduct.entries()].map(([productId, rows]) => [productId, totalOnHand(rows)]),
    );

    const adjustments = computeCountAdjustments(items, quantityByProduct);

    const document = await tx.document.create({
      data: {
        companyId: req.posCompanyId!,
        locationId,
        type: 'adjustment',
        status: 'confirmed',
        createdBy: req.posUserId!,
        items: { create: adjustments.map((a) => ({ productId: a.productId, quantity: a.delta, price: 0 })) },
      },
      include: { items: true },
    });

    const updates: Promise<unknown>[] = [];
    for (const adj of adjustments) {
      const rows = stockByProduct.get(adj.productId) ?? [];
      if (rows.length > 0) {
        // A shortfall is taken off the shelves the goods were on; a surplus
        // lands in the first one, since a count cannot say which shelf the
        // extra units were found on until counting is done per bin.
        updates.push(
          adj.delta < 0
            ? deductAcrossBins(tx, rows, -adj.delta, 'adjustment', { documentId: document.id, createdBy: req.posUserId })
            : applyStockDelta(tx, rows[0], adj.delta, 'adjustment', { documentId: document.id, createdBy: req.posUserId }),
        );
      } else if (adj.countedQuantity > 0) {
        updates.push(
          createStockWithMovement(tx, {
            productId: adj.productId,
            locationId,
            quantity: adj.countedQuantity,
            reason: 'adjustment',
            documentId: document.id,
            createdBy: req.posUserId,
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

  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

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
        tx.stock.findMany({ where: { locationId, productId: { in: ingredients.map((i) => i.ingredientId) } } }),
        tx.stock.findMany({ where: { locationId, productId: recipe.productId } }),
      ]);
      const ingredientStockByProduct = groupStockByProduct(ingredientStockRows);
      const ingredientQuantityByProduct = new Map(
        [...ingredientStockByProduct.entries()].map(([productId, rows]) => [productId, totalAvailable(rows)]),
      );

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
          locationId,
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
        updates.push(
          deductAcrossBins(tx, ingredientStockByProduct.get(ing.ingredientId) ?? [], ing.quantity, 'production_out', {
            documentId: document.id,
            createdBy: req.posUserId,
          }),
        );
      }

      const finishedStock = finishedStockRows[0];
      if (finishedStock) {
        updates.push(applyStockDelta(tx, finishedStock, yieldQuantity, 'production_in', { documentId: document.id, createdBy: req.posUserId }));
      } else {
        updates.push(
          createStockWithMovement(tx, {
            productId: recipe.productId,
            locationId,
            quantity: yieldQuantity,
            reason: 'production_in',
            documentId: document.id,
            createdBy: req.posUserId,
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
  const locationId = resolveLocationOrRespond(company?.locations ?? [], b.locationId, res);
  if (!locationId) return;

  const table = await prisma.table.create({
    data: { companyId: req.posCompanyId!, locationId, name, seats },
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
  if (items.length === 0 || hasInvalidQuantity(items)) {
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
  // The table already knows where it stands, so the location isn't the
  // caller's to choose here — the ingredients come off that room's stock.
  const locationId = table.locationId;

  // Same stale/tampered-price guard as /pos/sales — the waiter's device caches
  // the menu at login, so a price the owner changes mid-shift keeps ringing
  // at the old value until the next login.
  const priceCheckProductIds = [...new Set(items.map((it) => it.productId))];
  const [priceCheckProducts, modifierRows] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: priceCheckProductIds }, companyId: req.posCompanyId }, select: { id: true, salePrice: true } }),
    prisma.productModifier.findMany({ where: { productId: { in: priceCheckProductIds } }, select: { productId: true } }),
  ]);
  const priceMismatches = findPriceMismatches(
    items,
    new Map(priceCheckProducts.map((p) => [p.id, p.salePrice])),
    new Set(modifierRows.map((m) => m.productId)),
  );
  if (priceMismatches.length > 0) {
    res.status(409).json({ error: 'Цены изменились — выйдите и войдите в кассу заново', priceMismatches });
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
        tx.stock.findMany({ where: { locationId, productId: { in: plainItems.map((it) => it.productId) } } }),
        tx.stock.findMany({ where: { locationId, productId: { in: ingredientIds } } }),
      ]);
      const stockByProduct = groupStockByProduct(stockRows);
      const quantityByProduct = new Map(
        [...stockByProduct.entries()].map(([productId, rows]) => [productId, totalAvailable(rows)]),
      );
      const ingredientStockByProduct = groupStockByProduct(ingredientStockRows);
      const ingredientQuantityByProduct = new Map(
        [...ingredientStockByProduct.entries()].map(([productId, rows]) => [productId, totalAvailable(rows)]),
      );

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
            locationId,
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
        updates.push(
          deductAcrossBins(tx, stockByProduct.get(item.productId) ?? [], item.quantity, 'table_order', {
            documentId: openDocument.id,
            createdBy: req.posUserId,
          }),
        );
      }
      for (const consumption of ingredientConsumption) {
        updates.push(
          deductAcrossBins(tx, ingredientStockByProduct.get(consumption.ingredientId) ?? [], consumption.quantity, 'table_order', {
            documentId: openDocument.id,
            createdBy: req.posUserId,
          }),
        );
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

// Somebody else received or cancelled this transfer between the check and
// the write.
class TransferClosedError extends Error {
  constructor() {
    super('Transfer already closed');
  }
}

// The customer's balance no longer covers the redemption this sale was
// priced against — points were spent at another register in between.
class LoyaltyPointsError extends Error {
  constructor() {
    super('Loyalty balance changed');
  }
}
