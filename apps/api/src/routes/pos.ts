import { Router } from 'express';
import { prisma } from '@anyq/db';
import { signPosToken, requirePosAuth } from '../pos-auth';
import type { PosAuthedRequest } from '../pos-auth';
import { loginRateLimit } from '../rateLimit';
import { tariffState, tariffDenialMessage } from '../tariff';
import { findStockShortages } from '../stock';
import type { SaleItemInput, StockShortage } from '../stock';

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
      const stockRows = await tx.stock.findMany({
        where: { locationId: b.locationId, productId: { in: items.map((it) => it.productId) } },
      });
      const stockByProduct = new Map(stockRows.map((s) => [s.productId, s]));
      const quantityByProduct = new Map(stockRows.map((s) => [s.productId, s.quantity]));

      const shortages = findStockShortages(items, quantityByProduct);
      if (shortages.length > 0) {
        throw new StockError(shortages);
      }

      for (const item of items) {
        const stock = stockByProduct.get(item.productId)!;
        await tx.stock.update({ where: { id: stock.id }, data: { quantity: stock.quantity - item.quantity } });
      }

      return tx.document.create({
        data: {
          companyId: req.posCompanyId!,
          locationId: b.locationId,
          type: 'sale',
          status: 'confirmed',
          paymentMethod: b.paymentMethod,
          createdBy: req.posUserId!,
          items: {
            create: items.map((it) => ({
              productId: it.productId,
              quantity: it.quantity,
              price: it.price,
            })),
          },
        },
        include: { items: true },
      });
    });

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

      for (const item of order.items) {
        const stock = stockByProduct.get(item.productId)!;
        await tx.stock.update({ where: { id: stock.id }, data: { quantity: stock.quantity - item.quantity } });
      }

      await tx.document.update({
        where: { id: order.id },
        data: { status: 'confirmed', fulfilledBy: req.posUserId, fulfilledAt: new Date() },
      });
    });

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
