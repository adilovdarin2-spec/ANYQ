import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  api,
  createFixture,
  findLedgerMismatches,
  prisma,
  resetDatabase,
  startTestServer,
  stockAt,
  stopTestServer,
} from './harness';
import type { Fixture } from './harness';

let fx: Fixture;

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 100 });
});

async function putAway(quantity: number, toBin: string, fromBin = '') {
  return api(fx.token, 'POST', '/pos/bins/putaway', {
    locationId: fx.locationId,
    productId: fx.productId,
    quantity,
    fromBin,
    toBin,
  });
}

function binQuantity(body: any, code: string): number {
  const bin = body.bins.find((row: any) => row.code === code);
  return bin?.contents[0]?.quantity ?? 0;
}

/**
 * A timestamp that is genuinely "after everything recorded so far".
 *
 * Read from the database rather than taken from the process clock. The route
 * rewinds every movement with `createdAt > countedAt`; `createdAt` is written by
 * Postgres and a `new Date()` comes from Node, so on any skew where the database
 * runs a hair ahead — under load, and on Docker for Windows especially — a
 * `countedAt` of "now" silently rewinds the fixture's own opening stock. The
 * shelf then looks like it held nothing when it was walked, and a count of 100
 * becomes a +100 adjustment instead of none.
 *
 * That is what made this file flaky: it passed alone and failed in the full
 * suite, which is the signature of a clock race rather than a logic bug. Asking
 * the data takes both clocks out of the question.
 */
async function afterEverythingSoFar(): Promise<Date> {
  const latest = await prisma.stockMovement.aggregate({
    where: { locationId: fx.locationId },
    _max: { createdAt: true },
  });
  const last = latest._max.createdAt ?? new Date(0);
  // A millisecond past it. The comparison is strictly greater, so landing exactly
  // on the last movement would also keep it — one more makes the intent plain.
  return new Date(last.getTime() + 1);
}

async function makeBin(zone: string, rack: string) {
  return api(fx.token, 'POST', '/pos/bins', { locationId: fx.locationId, zone, rack, shelf: '', bin: '' });
}

describe('a count taken while the network was down', () => {
  it('applies the difference it asserted, not the figure it saw', async () => {
    // The whole reason a queued count is dangerous. The shelf held 100 when it
    // was walked and 12 were counted; three were sold before the count reached
    // the server. Applying 12 outright would resurrect the three.
    const countedAt = await afterEverythingSoFar();
    await new Promise((resolve) => setTimeout(resolve, 20));

    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 3, price: 200 }],
    });
    expect(await stockAt(fx.productId, fx.locationId)).toBe(97);

    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: [''],
      countedAt: countedAt.toISOString(),
      items: [{ productId: fx.productId, binLocation: '', countedQuantity: 12 }],
    });

    expect(counted.status).toBe(201);
    // It said "the system claimed 100 and I found 12", so minus 88 — leaving
    // nine, which is twelve found less three sold.
    expect(counted.body.adjustments[0]).toMatchObject({ systemQuantity: 100, countedQuantity: 12, delta: -88 });
    expect(await stockAt(fx.productId, fx.locationId)).toBe(9);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('does not erase a delivery that arrived after it was taken', async () => {
    // The goods were not on the shelf when it was walked, so the count says
    // nothing about them.
    const countedAt = await afterEverythingSoFar();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const other = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 200 },
    });
    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: '',
      supplierPhone: '',
      items: [{ productId: other.id, quantity: 20, price: 100, packagingId: null }],
    });

    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: [''],
      countedAt: countedAt.toISOString(),
      items: [{ productId: fx.productId, binLocation: '', countedQuantity: 100 }],
    });

    expect(counted.body.adjustments).toEqual([]);
    expect(await stockAt(other.id, fx.locationId)).toBe(20);
  });

  it('behaves exactly as before when it reaches the server straight away', async () => {
    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: [''],
      countedAt: (await afterEverythingSoFar()).toISOString(),
      items: [{ productId: fx.productId, binLocation: '', countedQuantity: 95 }],
    });
    expect(counted.body.adjustments[0]).toMatchObject({ systemQuantity: 100, delta: -5 });
    expect(await stockAt(fx.productId, fx.locationId)).toBe(95);
  });

  it('ignores a count timestamped in the future rather than trusting a wrong clock', async () => {
    // A tablet with the wrong date would otherwise rewind past movements that
    // have not happened yet.
    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: [''],
      countedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      items: [{ productId: fx.productId, binLocation: '', countedQuantity: 90 }],
    });
    expect(counted.body.adjustments[0]).toMatchObject({ systemQuantity: 100, delta: -10 });
  });
});

describe('a warehouse command sent twice', () => {
  it('receives a delivery once', async () => {
    const key = 'receipt-once';
    const body = {
      locationId: fx.locationId,
      supplierName: 'Поставщик',
      supplierPhone: '',
      items: [{ productId: fx.productId, quantity: 30, price: 90, packagingId: null }],
    };

    const first = await api(fx.token, 'POST', '/pos/receipts', body, { 'Idempotency-Key': key });
    const second = await api(fx.token, 'POST', '/pos/receipts', body, { 'Idempotency-Key': key });

    expect(second.body.id).toBe(first.body.id);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(130);
    expect(await prisma.document.count({ where: { type: 'receipt' } })).toBe(1);
  });

  it('writes goods off once', async () => {
    const key = 'writeoff-once';
    const body = {
      locationId: fx.locationId,
      reasonCode: 'damage',
      note: 'разбили при разгрузке',
      items: [{ productId: fx.productId, quantity: 5 }],
    };

    await api(fx.token, 'POST', '/pos/write-offs', body, { 'Idempotency-Key': key });
    await api(fx.token, 'POST', '/pos/write-offs', body, { 'Idempotency-Key': key });

    expect(await stockAt(fx.productId, fx.locationId)).toBe(95);
    expect(await prisma.document.count({ where: { type: 'write_off' } })).toBe(1);
  });

  it('puts goods away once', async () => {
    // Twice would take them off the source shelf twice and leave the count
    // wrong on both.
    await makeBin('A', '01');
    const key = 'putaway-once';
    const body = { locationId: fx.locationId, productId: fx.productId, quantity: 40, fromBin: '', toBin: 'A-01' };

    await api(fx.token, 'POST', '/pos/bins/putaway', body, { 'Idempotency-Key': key });
    await api(fx.token, 'POST', '/pos/bins/putaway', body, { 'Idempotency-Key': key });

    const bins = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    expect(binQuantity(bins.body, 'A-01')).toBe(40);
    expect(bins.body.unplaced[0].quantity).toBe(60);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('counts a shelf once', async () => {
    const key = 'count-once';
    const body = {
      locationId: fx.locationId,
      bins: [''],
      items: [{ productId: fx.productId, binLocation: '', countedQuantity: 80 }],
    };

    await api(fx.token, 'POST', '/pos/counts/by-bin', body, { 'Idempotency-Key': key });
    await api(fx.token, 'POST', '/pos/counts/by-bin', body, { 'Idempotency-Key': key });

    // Applied twice this would land on 60.
    expect(await stockAt(fx.productId, fx.locationId)).toBe(80);
  });

  it('refuses a key already used for a different command', async () => {
    const key = 'shared-key';
    await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'damage',
      note: 'первое',
      items: [{ productId: fx.productId, quantity: 1 }],
    }, { 'Idempotency-Key': key });

    const different = await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'expiry',
      note: 'второе',
      items: [{ productId: fx.productId, quantity: 9 }],
    }, { 'Idempotency-Key': key });

    expect(different.status).toBe(409);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(99);
  });
});

describe('a warehouse morning replayed in order', () => {
  it('lands exactly as if it had been online all along', async () => {
    // Receive, put away, move between shelves, write off damage, then count
    // what is left — the sequence a storeman actually performs, replayed from a
    // queue with a key on every command.
    await makeBin('A', '01');
    await makeBin('A', '02');

    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: 'Поставщик',
      supplierPhone: '',
      items: [{ productId: fx.productId, quantity: 60, price: 90, packagingId: null }],
    }, { 'Idempotency-Key': 'q1' });

    await putAway(100, 'A-01');
    await putAway(30, 'A-02', 'A-01');

    await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'damage',
      note: 'помяли коробку',
      items: [{ productId: fx.productId, quantity: 10 }],
    }, { 'Idempotency-Key': 'q4' });

    // 160 received in all, 10 written off. The write-off comes off the smallest
    // shelf holding the goods, which is A-02 with 30 against A-01's 70 — so
    // A-01 keeps 70, A-02 drops to 20, and 60 stay unplaced.
    expect(await stockAt(fx.productId, fx.locationId)).toBe(150);
    const afterWriteOff = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    expect(binQuantity(afterWriteOff.body, 'A-01')).toBe(70);
    expect(binQuantity(afterWriteOff.body, 'A-02')).toBe(20);

    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: ['A-02'],
      items: [{ productId: fx.productId, binLocation: 'A-02', countedQuantity: 28 }],
    }, { 'Idempotency-Key': 'q5' });
    expect(counted.body.adjustments[0]).toMatchObject({ systemQuantity: 20, delta: 8 });

    expect(await stockAt(fx.productId, fx.locationId)).toBe(158);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('leaves nothing behind when a command in the middle is refused', async () => {
    // A queue that stops on a permanent failure must stop on a clean boundary,
    // with the refused command having written nothing.
    await makeBin('A', '01');
    await putAway(100, 'A-01');

    const tooMuch = await putAway(500, '', 'A-01');
    expect(tooMuch.status).toBe(400);

    const bins = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    expect(binQuantity(bins.body, 'A-01')).toBe(100);
    expect(await findLedgerMismatches()).toEqual([]);
  });
});

describe('обычная инвентаризация, снятая во время торговли', () => {
  it('применяет разницу, которую утверждала, а не увиденную цифру', async () => {
    // Ровно то же обещание, что и у пересчёта по ячейкам, — и до сих пор оно
    // держалось только там. Обычная инвентаризация применяла абсолютную цифру,
    // а значит возвращала на полку всё, что продали, пока по ней шли: «считайте,
    // не закрывая магазин» было неправдой именно для того экрана, который для
    // этого и открывают.
    const countedAt = await afterEverythingSoFar();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Три продали, пока обходили.
    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 3, price: 200 }],
    });
    expect(await stockAt(fx.productId, fx.locationId)).toBe(97);

    // Насчитали 90 при 100 на момент обхода — то есть недостача 10.
    const counted = await api(fx.token, 'POST', '/pos/counts', {
      locationId: fx.locationId,
      countedAt: countedAt.toISOString(),
      items: [{ productId: fx.productId, countedQuantity: 90 }],
    });
    expect(counted.status).toBe(201);

    // 97 − 10 = 87. Без перемотки было бы 90: три проданные вернулись бы на полку.
    expect(await stockAt(fx.productId, fx.locationId)).toBe(87);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('без отметки о времени работает как раньше — по остатку на момент прихода', async () => {
    // Касса старой версии `countedAt` не пришлёт, и её счёт не должен падать
    // или считаться иначе, чем считался вчера.
    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: fx.productId, quantity: 3, price: 200 }],
    });

    const counted = await api(fx.token, 'POST', '/pos/counts', {
      locationId: fx.locationId,
      items: [{ productId: fx.productId, countedQuantity: 90 }],
    });
    expect(counted.status).toBe(201);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(90);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('отметку из будущего игнорирует', async () => {
    // Часы планшета могут уйти вперёд. Перематывать журнал в будущее нельзя —
    // в этом случае честнее посчитать по текущему остатку.
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const counted = await api(fx.token, 'POST', '/pos/counts', {
      locationId: fx.locationId,
      countedAt: future.toISOString(),
      items: [{ productId: fx.productId, countedQuantity: 90 }],
    });
    expect(counted.status).toBe(201);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(90);
  });
});

/**
 * Команда, пролежавшая в очереди, датируется моментом события — и в документе,
 * и в журнале движений.
 *
 * Документ датируется ради отчётности: неделя офлайн-торговли не должна
 * ложиться одним днём возвращения связи. Движения — ради инвентаризации, и это
 * тяжелее. Пересчёт отматывает журнал к `countedAt` и применяет разницу,
 * которую кладовщик утверждал на момент обхода. Если приёмка, физически бывшая
 * в 10:00, записана в 18:00, то для обхода в 15:00 она выглядит случившейся
 * после счёта: отмотка её вычтет, система решит, что на полке было на поставку
 * меньше, — и запишет излишек ровно на неё. Кладовщик при этом всё сделал
 * правильно и увидит поправку, которой не делал.
 *
 * Здесь проверяется каждая складская команда, которая умеет лежать в очереди:
 * приёмка, списание, размещение по ячейкам и продажа.
 */
describe('складская команда из очереди', () => {
  // Две отметки в прошлом, обе позже всего, что уже записано: событие, а затем
  // обход. Берутся от последнего движения в базе, а не от часов процесса, —
  // сравнение идёт с `createdAt`, который пишет Postgres (см. комментарий к
  // `afterEverythingSoFar`). Пауза после — чтобы обе гарантированно оказались в
  // прошлом: время события сервер не примет, если оно в будущем.
  async function событиеИОбход(): Promise<{ событие: Date; обход: Date }> {
    const base = await afterEverythingSoFar();
    const пара = { событие: new Date(base.getTime() + 10), обход: new Date(base.getTime() + 30) };
    await new Promise((resolve) => setTimeout(resolve, 60));
    return пара;
  }

  it('приёмка, принятая до обхода, не даёт мнимого излишка', async () => {
    const { событие, обход } = await событиеИОбход();

    // Приняли 20 при неработающей сети: на полке 120.
    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: '',
      supplierPhone: '',
      occurredAt: событие.toISOString(),
      items: [{ productId: fx.productId, quantity: 20, price: 100, packagingId: null }],
    });

    // Обошли полку позже приёмки и насчитали ровно то, что на ней лежит.
    const counted = await api(fx.token, 'POST', '/pos/counts', {
      locationId: fx.locationId,
      countedAt: обход.toISOString(),
      items: [{ productId: fx.productId, countedQuantity: 120 }],
    });

    expect(counted.status).toBe(201);
    expect(counted.body.adjustments ?? []).toEqual([]);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(120);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('без времени события та же приёмка даёт излишек — ради этого всё и сделано', async () => {
    // Тест подпирает предыдущий: если бы отмотка не читала время движений,
    // оба сходились бы, и первый проверял бы пустоту. Здесь же касса старой
    // версии, которая времени не присылает, — и видно, чем это кончается:
    // приёмка попадает в журнал «после обхода», отматывается, и пересчёт
    // дописывает +20, которых никто не находил.
    const обход = await afterEverythingSoFar();
    await new Promise((resolve) => setTimeout(resolve, 20));

    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: '',
      supplierPhone: '',
      items: [{ productId: fx.productId, quantity: 20, price: 100, packagingId: null }],
    });

    await api(fx.token, 'POST', '/pos/counts', {
      locationId: fx.locationId,
      countedAt: обход.toISOString(),
      items: [{ productId: fx.productId, countedQuantity: 120 }],
    });

    expect(await stockAt(fx.productId, fx.locationId)).toBe(140);
  });

  it('списание, сделанное до обхода, не даёт мнимой недостачи', async () => {
    const { событие, обход } = await событиеИОбход();

    // Пять разбили при разгрузке — на полке 95, и обход это увидел.
    await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'damage',
      note: 'разбили при разгрузке',
      occurredAt: событие.toISOString(),
      items: [{ productId: fx.productId, quantity: 5 }],
    });

    const counted = await api(fx.token, 'POST', '/pos/counts', {
      locationId: fx.locationId,
      countedAt: обход.toISOString(),
      items: [{ productId: fx.productId, countedQuantity: 95 }],
    });

    expect(counted.status).toBe(201);
    // Без времени движения отмотка вернула бы пять на полку, счёт стал бы
    // недостачей −5, и списанное списали бы дважды.
    expect(await stockAt(fx.productId, fx.locationId)).toBe(95);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('размещение, сделанное до обхода, не расходит ячейки', async () => {
    // Внутри локации итог не меняется, поэтому обычной инвентаризации
    // размещение безразлично. Пересчёт по ячейкам отматывает журнал по
    // ячейкам — и там перестановка, записанная позже обхода, раздваивается:
    // излишек в той ячейке, куда товар переставили, и недостача в той, откуда.
    await makeBin('A', '01');
    const { событие, обход } = await событиеИОбход();

    await api(fx.token, 'POST', '/pos/bins/putaway', {
      locationId: fx.locationId,
      productId: fx.productId,
      quantity: 40,
      fromBin: '',
      toBin: 'A-01',
      occurredAt: событие.toISOString(),
    });

    const counted = await api(fx.token, 'POST', '/pos/counts/by-bin', {
      locationId: fx.locationId,
      bins: ['', 'A-01'],
      countedAt: обход.toISOString(),
      items: [
        { productId: fx.productId, binLocation: '', countedQuantity: 60 },
        { productId: fx.productId, binLocation: 'A-01', countedQuantity: 40 },
      ],
    });

    expect(counted.status).toBe(201);
    expect(counted.body.adjustments).toEqual([]);

    const bins = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    expect(binQuantity(bins.body, 'A-01')).toBe(40);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });

  it('продажа, пробитая до обхода, не даёт мнимой недостачи', async () => {
    // Касса торгует без сети, и её чеки доходят позже. На полке трёх уже нет —
    // обход это и увидел; отмотка не должна возвращать их обратно.
    const { событие, обход } = await событиеИОбход();

    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      soldAt: событие.toISOString(),
      items: [{ productId: fx.productId, quantity: 3, price: 200 }],
    });

    const counted = await api(fx.token, 'POST', '/pos/counts', {
      locationId: fx.locationId,
      countedAt: обход.toISOString(),
      items: [{ productId: fx.productId, countedQuantity: 97 }],
    });

    expect(counted.status).toBe(201);
    expect(await stockAt(fx.productId, fx.locationId)).toBe(97);
    expect(await findLedgerMismatches(fx.locationId)).toEqual([]);
  });
});
