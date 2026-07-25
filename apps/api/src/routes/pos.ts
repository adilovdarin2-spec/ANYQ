import { Router } from 'express';
import { prisma } from '@anyq/db';
import { signPosToken, requirePosAuth } from '../pos-auth';
import type { PosAuthedRequest } from '../pos-auth';
import { loginRateLimit } from '../rateLimit';

export const posRouter = Router();

type TariffState = 'active' | 'expired' | 'blocked' | 'missing';

function tariffState(tariff: { blocked: boolean; validUntil: Date } | null): TariffState {
  if (!tariff) return 'missing';
  if (tariff.blocked) return 'blocked';
  if (tariff.validUntil < new Date()) return 'expired';
  return 'active';
}

function tariffDenialMessage(state: TariffState): string {
  if (state === 'blocked') return 'Доступ заблокирован — обратитесь в поддержку';
  if (state === 'expired') return 'Срок действия тарифа истёк — обратитесь в поддержку';
  return 'Тариф не назначен — обратитесь в поддержку';
}

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

interface SaleItemInput {
  productId: string;
  quantity: number;
  price: number;
}

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

      const shortages: { productId: string; available: number; requested: number }[] = [];
      for (const item of items) {
        const available = stockByProduct.get(item.productId)?.quantity ?? 0;
        if (available < item.quantity) {
          shortages.push({ productId: item.productId, available, requested: item.quantity });
        }
      }
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

class StockError extends Error {
  shortages: { productId: string; available: number; requested: number }[];
  constructor(shortages: { productId: string; available: number; requested: number }[]) {
    super('Insufficient stock');
    this.shortages = shortages;
  }
}
