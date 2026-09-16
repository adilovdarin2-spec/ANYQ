import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * Совет «что заказать» считается по тем дням, которые правда прочитаны.
 *
 * Расчёт спроса ограничен числом движений, и это правильно: журнал оптовика за
 * месяц читать целиком нельзя, а экран пополнения, отвалившийся по таймауту,
 * хуже короткого окна. Но окно оставалось двадцативосьмидневным независимо от
 * того, докуда дошло чтение.
 *
 * Для спроса это худший вид ошибки. Он делится на дни, когда товар был в
 * наличии, — а день, до которого чтение не дошло, выглядит именно таким:
 * движений нет, остаток не менялся, значит товар лежал и не продавался.
 * Делитель растёт, спрос падает, и «заказывать не надо» приходит ровно в тот
 * магазин, где журнал плотнее всего, то есть в самый бойкий.
 *
 * Экран про это честно писал «спрос занижен, возьмите окно короче» — совет,
 * которому нельзя было последовать: окно задано числом в коде, ни параметра,
 * ни кнопки на экране нет.
 *
 * Здесь предел достигается по-настоящему: пятьдесят тысяч движений одним
 * запросом. Дорого, и всё же дешевле, чем поверить, что функцию окна позвали:
 * «позвали на одном запросе и не позвали на соседнем» — это и была ошибка
 * рядом, в отчёте по продажам, найденная в тот же день.
 */

let fx: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 1000 });
});

/** Тот же предел, что в расчёте. Меньше — и проверка перестанет его касаться. */
const DEMAND_MOVEMENT_LIMIT = 50_000;
const DEMAND_WINDOW_DAYS = 28;
const DAY = 24 * 60 * 60 * 1000;

async function replenishment() {
  const res = await api(fx.token, 'GET', `/pos/replenishment?locationId=${fx.locationId}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { windowDays: number; truncated: boolean };
}

describe('окно расчёта спроса', () => {
  it('у обычного магазина — то, которое просили', async () => {
    // Самопроверка и норма разом: магазин, чей журнал умещается, обязан видеть
    // прежнее окно. Иначе всё ниже было бы зелёным и на правиле «всегда резать».
    await prisma.stockMovement.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        productId: fx.productId,
        locationId: fx.locationId,
        binLocation: '',
        quantity: -1,
        reason: 'sale',
        createdAt: new Date(Date.now() - i * DAY),
      })),
    });

    const body = await replenishment();
    expect(body.truncated).toBe(false);
    expect(body.windowDays).toBe(DEMAND_WINDOW_DAYS);
  });

  it('а у того, чей журнал не умещается, — до прочитанного', async () => {
    // Пятьдесят тысяч движений, все за последние трое суток: столько за день
    // делает оптовик со сплошным потоком. Прочитано будет ровно предельное
    // число, и всё прочитанное окажется свежим.
    const now = Date.now();
    await prisma.stockMovement.createMany({
      data: Array.from({ length: DEMAND_MOVEMENT_LIMIT + 500 }, (_, i) => ({
        productId: fx.productId,
        locationId: fx.locationId,
        binLocation: '',
        quantity: -1,
        reason: 'sale',
        // Равномерно по трём суткам, от свежих к старым.
        createdAt: new Date(now - Math.floor((i * 3 * DAY) / (DEMAND_MOVEMENT_LIMIT + 500))),
      })),
    });

    const body = await replenishment();
    expect(body.truncated, 'предел не достигнут — проверка ничего не касается').toBe(true);
    // Прочитано около трёх суток, а не двадцать восемь: окно сузилось.
    expect(body.windowDays).toBeLessThan(DEMAND_WINDOW_DAYS);
    expect(body.windowDays).toBeGreaterThan(0);
  });
});
