import { Router } from 'express';
import { prisma } from '@anyq/db';
import { tariffState, tariffDenialMessage } from '../tariff';
import { availableQuantity, findStockShortages, aggregateRequestedQuantities, groupStockByProduct, reserveAcrossBins, ConcurrentStockChangeError } from '../stock';
import { sellableQuantity, untrackedPolicy } from '../batches';
import type { BatchStock } from '../batches';
import { loginRateLimit } from '../rateLimit';
import { phoneKey } from '../phone';
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

/**
 * С какой точки витрина продаёт.
 *
 * Выбранная владельцем, а если он не выбирал — первая по списку, как было
 * всегда. Список отсортирован по названию, то есть у компании с двумя точками
 * витрина торговала остатками той, чьё имя раньше по алфавиту, и туда же
 * вставала бронь под заказ. Переименовали точку — витрина стала продавать
 * другую. Нигде об этом не было сказано ни слова.
 *
 * Угадывать по типу точки («витрина — значит склад») я пробовал и отказался:
 * у компании, которая держит товар в магазине и завела пустой склад, витрина
 * молча опустела бы. Такое решение принимает владелец, а продукт обязан
 * показать, что он выбрал, — имя точки теперь написано рядом со ссылкой на
 * витрину.
 */
export function storefrontLocation<T extends { id: string }>(
  locations: T[],
  chosenId?: string | null,
): T | undefined {
  const chosen = chosenId ? locations.find((location) => location.id === chosenId) : undefined;
  return chosen ?? locations[0];
}

/**
 * Сколько позиций витрина отдаёт за раз.
 *
 * Пять тысяч — с запасом к любому настоящему оптовому каталогу и заведомо
 * ниже того, что превращает ответ в мегабайты. Число круглое намеренно: точную
 * границу здесь взять неоткуда, а важно только то, что она есть.
 */
const CATALOG_LIMIT = 5000;

/** Остатки читаются по тому же поводу и с тем же запасом: товар может лежать в нескольких ячейках. */
const STOCK_LIMIT = 50000;

/**
 * Пересчитать доступное по партиям — там, где партии есть.
 *
 * Одно место на обе стороны витрины: и на то, что показано, и на то, что
 * разрешено заказать. Пока это были два куска кода, они и разошлись бы — как
 * когда-то разошлись плитка кассы и проверка при продаже, и кассир узнавал о
 * разнице от покупателя, стоящего перед ним.
 *
 * Товар, у которого партий нет, не трогается вовсе: партионный учёт есть не у
 * всех и не на всё, и требовать партию там, где её не заводили, значило бы
 * обнулить витрину обычного склада.
 */
async function applyBatchRule(
  locationId: string | null,
  modules: readonly string[],
  productIds: string[],
  target: Map<string, number>,
  onHand: Map<string, number>,
  heldBack: Map<string, number>,
): Promise<void> {
  if (!locationId || productIds.length === 0) return;
  const batchRows = await prisma.productBatch.findMany({
    where: { locationId, productId: { in: productIds } },
    select: { id: true, productId: true, expiryDate: true, quantity: true },
  });
  if (batchRows.length === 0) return;

  const byProduct = new Map<string, BatchStock[]>();
  for (const row of batchRows) {
    const list = byProduct.get(row.productId) ?? [];
    list.push({ batchId: row.id, expiryDate: row.expiryDate, quantity: row.quantity });
    byProduct.set(row.productId, list);
  }

  const now = new Date();
  const untracked = untrackedPolicy(modules);
  for (const [productId, batches] of byProduct) {
    target.set(
      productId,
      sellableQuantity(onHand.get(productId) ?? 0, batches, heldBack.get(productId) ?? 0, now, untracked),
    );
  }
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

  const location = storefrontLocation(company.locations, company.storefrontLocationId);
  // Только то, что вообще продаётся. Здесь стояло «все товары компании», и на
  // публичную витрину попадало всё подряд: снятое с продажи владельцем и
  // полуфабрикаты, из которых на этом же складе что-то делают. Касса такие
  // товары не показывает с самого начала — витрина показывала.
  // С потолком, как и всякое чтение здесь. Этот адрес открыт без входа — его
  // зовёт браузер любого покупателя и кто угодно ещё, — и до сегодняшнего дня
  // он читал весь каталог целиком, сколько бы в нём ни было. У склада с
  // десятком тысяч позиций это тяжёлый ответ на каждое открытие страницы и
  // бесплатный способ нагрузить базу: ограничитель частоты у нас стоит на
  // запись, потому что чтения дёшевы, а это чтение дёшево не всегда.
  //
  // Берётся на одну позицию больше предела: иначе «ровно пять тысяч» и «пять
  // тысяч из семи» выглядят одинаково, и витрина молча теряет остальное.
  const products = await prisma.product.findMany({
    where: { companyId: company.id, sellable: true },
    take: CATALOG_LIMIT + 1,
  });
  const truncated = products.length > CATALOG_LIMIT;
  if (truncated) products.length = CATALOG_LIMIT;

  const stockRows = location
    ? await prisma.stock.findMany({ where: { locationId: location.id }, take: STOCK_LIMIT })
    : [];
  // What a customer can actually order: units already held for someone
  // else's open order are on the shelf but not on offer.
  //
  // Суммой по ячейкам, а не «одна строка на товар». `new Map(rows.map(...))`
  // молча оставлял последнюю строку: на складе с ячейками товар, разложенный
  // по трём полкам, показывался в размере одной из них — и заказ на настоящий
  // остаток витрина отклоняла как нехватку.
  const stockByProduct = new Map<string, number>();
  const heldBackByProduct = new Map<string, number>();
  const onHandByProduct = new Map<string, number>();
  for (const row of stockRows) {
    stockByProduct.set(row.productId, (stockByProduct.get(row.productId) ?? 0) + availableQuantity(row));
    heldBackByProduct.set(row.productId, (heldBackByProduct.get(row.productId) ?? 0) + (row.quantity - availableQuantity(row)));
    onHandByProduct.set(row.productId, (onHandByProduct.get(row.productId) ?? 0) + row.quantity);
  }

  // Партионный товар считается по тому же правилу, что и в кассе.
  //
  // Правило «просроченное не продаётся» — общее, а не аптечное: и плитка
  // кассы, и проверка при продаже считают годным только неистёкшее. Витрина
  // эту дверь обходила: она показывала обычный остаток, в котором партии не
  // участвуют вовсе, — и предлагала оптовику ровно те упаковки, которые
  // стоящий рядом кассир продать не может.
  await applyBatchRule(location?.id ?? null, modules, [...stockByProduct.keys()], stockByProduct, onHandByProduct, heldBackByProduct);

  res.json({
    company: { id: company.id, name: company.name },
    // Витрина скажет об этом строкой под списком. Молчаливое усечение — это
    // товар, которого покупатель не видит и потому не закажет, а поставщик
    // узнаёт об этом от него по телефону.
    truncated,
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
  // К одному виду: партнёр, заказавший вчера «+7 700 …», а сегодня
  // «8 700 …», — это один партнёр с одним долгом, а не два.
  const customerPhone = phoneKey(typeof b.customerPhone === 'string' ? b.customerPhone : '');
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

  const location = storefrontLocation(company.locations, company.storefrontLocationId);
  if (!location) {
    res.status(400).json({ error: 'У склада не настроена точка выдачи' });
    return;
  }

  // Только то, что продаётся. Каталог витрины фильтрует `sellable` с тех пор,
  // как на неё перестало попадать снятое с продажи, а заказ — не фильтровал:
  // партнёр с открытой со вчера страницей заказывал то, что сегодня уже сняли,
  // и заказ принимался.
  const products = await prisma.product.findMany({
    where: { companyId: company.id, sellable: true, id: { in: items.map((it) => it.productId) } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  const validItems = items.filter((it) => productById.has(it.productId) && it.quantity > 0);

  // Строку, которую нельзя выполнить, раньше просто выбрасывали: заказ уходил
  // без неё, а покупатель узнавал об этом при получении — если замечал вообще.
  // Отказ целиком честнее: пусть он уберёт её сам и увидит, что заказывает.
  if (validItems.length !== items.length) {
    const пропавшие = items.filter((it) => !productById.has(it.productId)).length;
    res.status(409).json({
      error: пропавшие > 0
        ? 'Часть товаров больше не продаётся — обновите страницу и соберите заказ заново'
        : 'Некорректный список товаров',
    });
    return;
  }

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
      // Тем же правилом, что и каталог. Разойдись эти два места — и витрина
      // предлагала бы одно число, а заказ отказывал по другому: покупатель
      // видит двенадцать, заказывает двенадцать и получает «нехватка».
      const onHandByProduct = new Map(
        [...stockByProduct.entries()].map(([productId, rows]) => [
          productId,
          rows.reduce((sum, row) => sum + row.quantity, 0),
        ]),
      );
      const heldBackByProduct = new Map(
        [...stockByProduct.entries()].map(([productId, rows]) => [
          productId,
          rows.reduce((sum, row) => sum + (row.quantity - availableQuantity(row)), 0),
        ]),
      );
      await applyBatchRule(
        location.id,
        modules,
        ordered.map((it) => it.productId),
        availableByProduct,
        onHandByProduct,
        heldBackByProduct,
      );

      const shortages = findStockShortages(ordered, availableByProduct);
      if (shortages.length > 0) throw new OrderStockError(shortages);

      // Created inside the transaction: done outside, a customer row was left
      // behind whenever the order itself failed.
      // Покупатель, а не однофамилец-поставщик. Без типа заказ привязывался к
      // той записи с этим телефоном, какая нашлась первой, — а партнёр,
      // который и возит вам товар, и покупает у вас, заводится обеими
      // сторонами: его долг вам и ваш долг ему живут в разных записях, и
      // класть заказ в поставщика значило считать эти долги вместе.
      let counterparty = await tx.counterparty.findFirst({
        where: { companyId: company.id, phone: customerPhone, type: 'customer' },
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
  // На языке того, у кого зазвонит телефон. Тело — имя и сумма, они одинаковы
  // на обоих языках; переводится заголовок, а он и есть то, что человек видит
  // на заблокированном экране.
  sendPushToCompany(company.id, (language) => ({
    title: language === 'kk' ? 'Жаңа тапсырыс' : 'Новый заказ',
    body: `${customerName} · ${total.toLocaleString('ru-RU')} ₸`,
    url: '/',
  })).catch(() => {});

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
