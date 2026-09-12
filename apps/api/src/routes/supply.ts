import { Router } from 'express';
import { prisma } from '@anyq/db';
import { tariffState, tariffDenialMessage } from '../tariff';
import { availableQuantity, findStockShortages, aggregateRequestedQuantities, groupStockByProduct, reserveAcrossBins, ConcurrentStockChangeError } from '../stock';
import { loginRateLimit } from '../rateLimit';
import { sendPushToCompany } from '../push';

export const supplyRouter = Router();

// Storefront links use a friendly slug when the company has one, but every
// old link (raw cuid, already shared with someone's customers) keeps working
// forever — never break a link once it's been handed out.
function findCompanyBySlugOrId(param: string) {
  return prisma.company.findFirst({
    where: { OR: [{ slug: param }, { id: param }] },
    include: { tariff: true, locations: { orderBy: { name: 'asc' } } },
  });
}

supplyRouter.get('/:companyId/catalog', async (req, res) => {
  const company = await findCompanyBySlugOrId(req.params.companyId);
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
  // Только то, что вообще продаётся. Здесь стояло «все товары компании», и на
  // публичную витрину попадало всё подряд: снятое с продажи владельцем и
  // полуфабрикаты, из которых на этом же складе что-то делают. Касса такие
  // товары не показывает с самого начала — витрина показывала.
  const products = await prisma.product.findMany({ where: { companyId: company.id, sellable: true } });
  const stockRows = location ? await prisma.stock.findMany({ where: { locationId: location.id } }) : [];
  // What a customer can actually order: units already held for someone
  // else's open order are on the shelf but not on offer.
  //
  // Суммой по ячейкам, а не «одна строка на товар». `new Map(rows.map(...))`
  // молча оставлял последнюю строку: на складе с ячейками товар, разложенный
  // по трём полкам, показывался в размере одной из них — и заказ на настоящий
  // остаток витрина отклоняла как нехватку.
  const stockByProduct = new Map<string, number>();
  for (const row of stockRows) {
    stockByProduct.set(row.productId, (stockByProduct.get(row.productId) ?? 0) + availableQuantity(row));
  }

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
  const deliveryAddress = typeof b.deliveryAddress === 'string' ? b.deliveryAddress.trim() : '';

  if (!customerName || !customerPhone || !deliveryAddress || items.length === 0) {
    res.status(400).json({ error: 'Укажите имя, телефон, адрес и хотя бы один товар' });
    return;
  }

  const company = await findCompanyBySlugOrId(req.params.companyId);
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

  // An order holds the goods it names. Without that, the same units stayed
  // on sale at the register until someone got round to fulfilling the order,
  // and the customer found out their order was impossible days later.
  const ordered = aggregateRequestedQuantities(
    validItems.map((it) => ({ productId: it.productId, quantity: it.quantity, price: 0 })),
  );

  let document;
  try {
    document = await prisma.$transaction(async (tx) => {
      const stockRows = await tx.stock.findMany({
        where: { locationId: location.id, productId: { in: ordered.map((it) => it.productId) } },
      });
      // По ячейкам: один товар лежит на скольких угодно полках, и обе величины
      // ниже — сколько свободно и куда класть бронь — считаются по всем сразу.
      const stockByProduct = groupStockByProduct(stockRows);
      const availableByProduct = new Map(
        [...stockByProduct.entries()].map(([productId, rows]) => [
          productId,
          rows.reduce((sum, row) => sum + availableQuantity(row), 0),
        ]),
      );

      const shortages = findStockShortages(ordered, availableByProduct);
      if (shortages.length > 0) throw new OrderStockError(shortages);

      // Created inside the transaction: done outside, a customer row was left
      // behind whenever the order itself failed.
      let counterparty = await tx.counterparty.findFirst({
        where: { companyId: company.id, phone: customerPhone },
      });
      if (!counterparty) {
        counterparty = await tx.counterparty.create({
          data: { companyId: company.id, name: customerName, phone: customerPhone, type: 'customer' },
        });
      } else if (counterparty.name !== customerName) {
        counterparty = await tx.counterparty.update({ where: { id: counterparty.id }, data: { name: customerName } });
      }

      const created = await tx.document.create({
        data: {
          companyId: company.id,
          locationId: location.id,
          type: 'order',
          status: 'pending',
          counterpartyId: counterparty.id,
          deliveryAddress,
          items: {
            create: ordered.map((it) => ({
              productId: it.productId,
              quantity: it.quantity,
              price: productById.get(it.productId)!.salePrice,
            })),
          },
        },
      });

      for (const item of ordered) {
        await reserveAcrossBins(tx, stockByProduct.get(item.productId) ?? [], item.quantity);
      }

      return created;
    }, { timeout: 15000 });
  } catch (err) {
    if (err instanceof OrderStockError) {
      res.status(409).json({ error: 'Часть товара уже разобрали — обновите корзину', shortages: err.shortages });
      return;
    }
    if (err instanceof ConcurrentStockChangeError) {
      res.status(409).json({ error: 'Часть товара уже разобрали — обновите корзину' });
      return;
    }
    throw err;
  }

  const total = ordered.reduce((sum, it) => sum + productById.get(it.productId)!.salePrice * it.quantity, 0);
  sendPushToCompany(company.id, {
    title: 'Новый заказ',
    body: `${customerName} · ${total.toLocaleString('ru-RU')} ₸`,
    url: '/',
  }).catch(() => {});

  // Номер заказа. Его ставит триггер базы, и до сих пор он оставался внутри:
  // клиент получал идентификатор из двадцати пяти знаков и экран «спасибо», в
  // котором сослаться на заказ было нечем. Когда он звонит уточнить время
  // выдачи, назвать нужно что-то короткое — и это оно.
  res.status(201).json({
    id: document.id,
    number: document.number,
    createdAt: document.createdAt.toISOString(),
  });
});

// Not enough on the shelf for what was just ordered. Named separately from the
// POS one so the storefront can answer in a customer's words rather than a
// stockroom's.
class OrderStockError extends Error {
  shortages: { productId: string; available: number; requested: number }[];
  constructor(shortages: { productId: string; available: number; requested: number }[]) {
    super('Insufficient stock');
    this.shortages = shortages;
  }
}
