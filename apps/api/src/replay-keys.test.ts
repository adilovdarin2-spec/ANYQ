import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Маршрут, двигающий остаток, обязан переживать повтор.
 *
 * Планшет и касса не отличают запрос, не дошедший до сервера, от запроса,
 * ответ на который потерялся. На складе и в зале с плохой связью это не
 * редкость, а обычный день, и повтор без защиты значит списанный дважды товар:
 * приход партии заводил вторую партию с тем же номером, заказ за столом
 * дописывал блюда второй раз и выставлял гостю двойной счёт.
 *
 * Защит две, и обе годятся. Ключ операции (`runIdempotent`) отвечает повтору
 * тем же ответом, что и первой попытке. Захват состояния — `updateMany` с
 * условием на статус, который этот запрос прочитал, — отвечает повтору
 * отказом, но второй раз товар не двигает; это слабее, потому что успешную
 * операцию видно как ошибку, зато для документа с состоянием этого хватает.
 *
 * Не годится только третье: ничего. Поэтому список здесь перечисляет себя сам.
 */

const routes = readFileSync(resolve(__dirname, 'routes', 'pos.ts'), 'utf8').replace(/\r\n/g, '\n');

interface Route {
  method: string;
  path: string;
  body: string;
}

/** Пишущие маршруты кассы, с телом каждого — до начала следующего. */
export function writingRoutes(source: string): Route[] {
  const lines = source.split('\n');
  const found: { method: string; path: string; at: number }[] = [];
  lines.forEach((line, index) => {
    const match = /^posRouter\.(post|patch|put|delete)\('([^']+)'/.exec(line);
    if (match) found.push({ method: match[1], path: match[2], at: index });
  });
  return found.map((route, index) => ({
    method: route.method,
    path: route.path,
    body: lines.slice(route.at, index + 1 < found.length ? found[index + 1].at : lines.length).join('\n'),
  }));
}

/** Двигает ли маршрут остаток — то есть есть ли что повторять дважды. */
const movesStock = (route: Route) =>
  /deductAcrossBins|applyStockDelta|createStockWithMovement|removeFromBatches/.test(route.body);

/** Ключ операции: повтор получает тот же ответ. */
const hasReplayKey = (route: Route) => /runIdempotent\(/.test(route.body);

/**
 * Захват состояния: `updateMany` с условием на статус, который этот запрос уже
 * прочитал. Повтор не находит его и уходит с отказом, ничего не сдвинув.
 */
const claimsStatus = (route: Route) => /updateMany\(\{[\s\S]{0,400}?status:/.test(route.body);

describe('повтор запроса', () => {
  it('не может сдвинуть остаток дважды ни на одном маршруте', () => {
    const all = writingRoutes(routes);

    // Страховка на разбор: переименуют роутер — и тест начнёт проходить,
    // ничего не проверяя.
    expect(all.length, 'не нашлись маршруты — разошёлся разбор, а не код').toBeGreaterThan(30);
    const stocky = all.filter(movesStock);
    expect(stocky.length, 'не нашлись маршруты, двигающие остаток').toBeGreaterThan(8);

    const беззащитные = stocky
      .filter((route) => !hasReplayKey(route) && !claimsStatus(route))
      .map((route) => `${route.method.toUpperCase()} ${route.path}`);
    expect(беззащитные, 'маршрут двигает остаток и переживёт повтор дважды').toEqual([]);
  });

  it('а сам разбор отличает одно от другого', () => {
    // Иначе первое, что он докажет, — что находит что угодно.
    const образец = `
posRouter.post('/защищённый', requirePosAuth, async (req, res) => {
  await runIdempotent({ key }, async (tx) => {
    await deductAcrossBins(tx, rows, 1, 'sale', {});
  });
});
posRouter.post('/голый', requirePosAuth, async (req, res) => {
  await prisma.$transaction(async (tx) => {
    await deductAcrossBins(tx, rows, 1, 'sale', {});
  });
});
posRouter.get('/читающий', requirePosAuth, async (req, res) => {
  res.json({});
});
`;
    const parsed = writingRoutes(образец);
    expect(parsed.map((r) => r.path), 'читающий маршрут сюда попадать не должен').toEqual(['/защищённый', '/голый']);
    expect(parsed.filter(movesStock).length).toBe(2);
    expect(parsed.filter(hasReplayKey).map((r) => r.path)).toEqual(['/защищённый']);
  });

  it('и видит захват состояния как защиту', () => {
    const образец = `
posRouter.post('/выдача', requirePosAuth, async (req, res) => {
  const claimed = await tx.document.updateMany({
    where: { id: order.id, status: 'pending' },
    data: { status: 'confirmed' },
  });
  await deductAcrossBins(tx, rows, 1, 'order_fulfill', {});
});
`;
    const [route] = writingRoutes(образец);
    expect(hasReplayKey(route)).toBe(false);
    expect(claimsStatus(route), 'захват статуса — это тоже защита').toBe(true);
  });
});
