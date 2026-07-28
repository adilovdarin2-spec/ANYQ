import { Router } from 'express';
import { prisma } from '@anyq/db';
import { signPosToken, requirePosAuth } from '../pos-auth';
import type { PosAuthedRequest } from '../pos-auth';
import { loginRateLimit } from '../rateLimit';
import { tariffState, tariffDenialMessage } from '../tariff';
import { findStockShortages } from '../stock';
import type { SaleItemInput, StockShortage } from '../stock';
import { buildSummary, buildTopProducts, buildCashierBreakdown, findLowStock } from '../reports';
import type { SaleRecord } from '../reports';
import { allocateFefo, classifyExpiry } from '../batches';
import type { BatchStock } from '../batches';

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

  const products = await prisma.product.findMany({ where: { companyId: user.companyId } });
  const primaryLocationId = user.company.locations[0]?.id;
  const stockRows = primaryLocationId
    ? await prisma.stock.findMany({ where: { locationId: primaryLocationId } })
    : [];
  const stockByProduct = new Map(stockRows.map((s) => [s.productId, s.quantity]));

  res.json({
    token: signPosToken(user.id, user.companyId),
    user: { id: user.id, name: user.name, role: user.role },
    company: { id: user.company.id, name: user.company.name },
    modules: user.company.tariff ? (JSON.parse(user.company.tariff.modules) as string[]) : [],
    locations: user.company.locations.map((l) => ({ id: l.id, name: l.name, type: l.type, address: l.address ?? '' })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.salePrice,
      barcode: p.barcode ?? '',
      category: p.category ?? '',
      stock: stockByProduct.get(p.id) ?? 0,
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

  try {
    const document = await prisma.$transaction(async (tx) => {
      const now = new Date();

      const [stockRows, batchRows] = await Promise.all([
        tx.stock.findMany({ where: { locationId: b.locationId, productId: { in: items.map((it) => it.productId) } } }),
        tx.productBatch.findMany({
          where: { locationId: b.locationId, productId: { in: items.map((it) => it.productId) }, quantity: { gt: 0 } },
        }),
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
      for (const item of items) {
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

      const shortages = findStockShortages(items, quantityByProduct);
      if (shortages.length > 0) {
        throw new StockError(shortages);
      }

      const documentItemsData: { productId: string; batchId: string | null; quantity: number; price: number }[] = [];
      const updates: Promise<unknown>[] = [];

      for (const item of items) {
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

      await Promise.all(updates);

      return tx.document.create({
        data: {
          companyId: req.posCompanyId!,
          locationId: b.locationId,
          type: 'sale',
          status: 'confirmed',
          paymentMethod: b.paymentMethod,
          createdBy: req.posUserId!,
          items: { create: documentItemsData },
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

  const sales: SaleRecord[] = documents.map((d) => ({
    id: d.id,
    createdAt: d.createdAt,
    paymentMethod: d.paymentMethod,
    createdBy: d.createdBy,
    items: d.items.map((it) => ({
      productId: it.productId,
      name: it.product.name,
      quantity: it.quantity,
      price: it.price,
    })),
  }));

  const nameByUserId = new Map((company?.users ?? []).map((u) => [u.id, u.name]));

  const location = company?.locations[0];
  const stockRows = location
    ? await prisma.stock.findMany({ where: { locationId: location.id }, include: { product: true } })
    : [];
  const stockForLowCheck = stockRows.map((s) => ({ productId: s.productId, name: s.product.name, quantity: s.quantity }));

  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    summary: buildSummary(sales),
    topProducts: buildTopProducts(sales, 10),
    byCashier: buildCashierBreakdown(sales, nameByUserId),
    lowStock: findLowStock(stockForLowCheck, 10),
  });
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

class StockError extends Error {
  shortages: StockShortage[];
  constructor(shortages: StockShortage[]) {
    super('Insufficient stock');
    this.shortages = shortages;
  }
}
