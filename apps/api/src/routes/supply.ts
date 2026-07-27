import { Router } from 'express';
import { prisma } from '@anyq/db';
import { tariffState, tariffDenialMessage } from '../tariff';
import { loginRateLimit } from '../rateLimit';

export const supplyRouter = Router();

supplyRouter.get('/:companyId/catalog', async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.companyId },
    include: { tariff: true, locations: true },
  });
  if (!company) {
    res.status(404).json({ error: 'Склад не найден' });
    return;
  }

  const modules: string[] = company.tariff ? JSON.parse(company.tariff.modules) : [];
  if (!modules.includes('supply')) {
    res.status(404).json({ error: 'Склад не найден' });
    return;
  }

  const state = tariffState(company.tariff);
  if (state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const location = company.locations[0];
  const products = await prisma.product.findMany({ where: { companyId: company.id } });
  const stockRows = location ? await prisma.stock.findMany({ where: { locationId: location.id } }) : [];
  const stockByProduct = new Map(stockRows.map((s) => [s.productId, s.quantity]));

  res.json({
    company: { id: company.id, name: company.name },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.salePrice,
      unit: p.unit,
      category: p.category ?? '',
      stock: stockByProduct.get(p.id) ?? 0,
    })),
  });
});

interface OrderItemInput {
  productId: string;
  quantity: number;
}

supplyRouter.post('/:companyId/orders', loginRateLimit, async (req, res) => {
  const b = req.body ?? {};
  const items: OrderItemInput[] = Array.isArray(b.items) ? b.items : [];
  const customerName = typeof b.customerName === 'string' ? b.customerName.trim() : '';
  const customerPhone = typeof b.customerPhone === 'string' ? b.customerPhone.trim() : '';

  if (!customerName || !customerPhone || items.length === 0) {
    res.status(400).json({ error: 'Укажите имя, телефон и хотя бы один товар' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.params.companyId },
    include: { tariff: true, locations: true },
  });
  if (!company) {
    res.status(404).json({ error: 'Склад не найден' });
    return;
  }

  const modules: string[] = company.tariff ? JSON.parse(company.tariff.modules) : [];
  const state = tariffState(company.tariff);
  if (!modules.includes('supply') || state !== 'active') {
    res.status(403).json({ error: tariffDenialMessage(state) });
    return;
  }

  const location = company.locations[0];
  if (!location) {
    res.status(400).json({ error: 'У склада не настроена точка выдачи' });
    return;
  }

  const products = await prisma.product.findMany({
    where: { companyId: company.id, id: { in: items.map((it) => it.productId) } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  const validItems = items.filter((it) => productById.has(it.productId) && it.quantity > 0);
  if (validItems.length === 0) {
    res.status(400).json({ error: 'Некорректный список товаров' });
    return;
  }

  let counterparty = await prisma.counterparty.findFirst({
    where: { companyId: company.id, phone: customerPhone },
  });
  if (!counterparty) {
    counterparty = await prisma.counterparty.create({
      data: { companyId: company.id, name: customerName, phone: customerPhone, type: 'customer' },
    });
  } else if (counterparty.name !== customerName) {
    counterparty = await prisma.counterparty.update({ where: { id: counterparty.id }, data: { name: customerName } });
  }

  const document = await prisma.document.create({
    data: {
      companyId: company.id,
      locationId: location.id,
      type: 'order',
      status: 'pending',
      counterpartyId: counterparty.id,
      items: {
        create: validItems.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          price: productById.get(it.productId)!.salePrice,
        })),
      },
    },
  });

  res.status(201).json({ id: document.id, createdAt: document.createdAt.toISOString() });
});
