import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * На заблокированную полку товар не ставится.
 *
 * Блокировка ячейки снимает с продажи то, что стояло на полке в ту минуту, и
 * держит именно его — своим документом, чтобы разблокировка отпустила ровно
 * это, а не чей-то отдельный карантин. Товар, поставленный туда позже, в
 * документ не попадал и оставался свободным: касса его продавала, а сборщика
 * посылали к залитой полке, с которой брать нельзя. То есть блокировка
 * защищала склад только от того, что на полке уже лежало.
 *
 * Выбрать такую полку было ещё и проще всего: в списке «Куда» она стояла
 * наравне с остальными и без пометки, а первая в списке подставлялась сама.
 *
 * Найдено 01.10.2026 обходом ячеек: 10 мешков сахара на залитой полке, сверху
 * положили 5 мешков муки — и мука осталась к продаже.
 */

let fx: Fixture;
let blockedBinId = '';

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 100 });
  for (const bin of ['01', '02']) {
    const created = await api(fx.token, 'POST', '/pos/bins', {
      locationId: fx.locationId,
      zone: 'A',
      rack: bin,
      shelf: '',
      bin: '',
    });
    if (bin === '01') blockedBinId = created.body.id;
  }
  await api(fx.token, 'POST', '/pos/bins/putaway', {
    locationId: fx.locationId,
    productId: fx.productId,
    quantity: 40,
    fromBin: '',
    toBin: 'A-01',
  });
  await api(fx.token, 'POST', `/pos/bins/${blockedBinId}/block`, {
    note: 'протечка с потолка',
    reasonCode: 'damage',
  });
});

function putaway(over: Record<string, unknown>) {
  return api(fx.token, 'POST', '/pos/bins/putaway', {
    locationId: fx.locationId,
    productId: fx.productId,
    quantity: 5,
    fromBin: '',
    ...over,
  });
}

async function row(binLocation: string) {
  return prisma.stock.findFirst({
    where: { productId: fx.productId, locationId: fx.locationId, binLocation },
  });
}

describe('заблокированная ячейка', () => {
  it('не принимает товар, и отказ называет причину', async () => {
    const res = await putaway({ toBin: 'A-01' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('A-01');
    expect(res.body.error).toContain('заблокирована');
    // Та самая причина, которую записал менеджер: кладовщик должен понять, что
    // это не сбой, а чьё-то решение.
    expect(res.body.error).toContain('протечка с потолка');
  });

  it('и товар остаётся там, где был', async () => {
    await putaway({ toBin: 'A-01' });
    expect((await row('A-01'))?.quantity).toBe(40);
    // Шестьдесят не размещённых так и лежат не размещёнными.
    expect((await row(''))?.quantity).toBe(60);
  });

  it('и на закрытой полке не остаётся ничего свободного', async () => {
    /* Главное следствие, и видно оно именно по ячейкам: итог по точке от
       размещения не меняется вовсе, а вот 5 мешков, поставленных на залитую полку,
       стояли там свободными: блокировка их не держала, потому что её документ был
       составлен до них — и сборщика посылало именно туда. */
    await putaway({ toBin: 'A-01' });
    const bins = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    const bin = bins.body.bins.find((b: { code: string }) => b.code === 'A-01');
    expect(bin.blocked).toBe(true);
    for (const content of bin.contents) {
      expect(content.available).toBe(0);
    }
  });

  it('а свободная — принимает', async () => {
    // Иначе отказ лечил бы симптом, запрещая размещение вообще.
    expect((await putaway({ toBin: 'A-02' })).status).toBe(200);
    expect((await row('A-02'))?.quantity).toBe(5);
  });

  it('с неё и не снимают — но словами про блокировку, а не «свободно 0»', async () => {
    const res = await putaway({ quantity: 10, fromBin: 'A-01', toBin: 'A-02' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('заблокирована');
    // Прежний отказ говорил «в исходной ячейке свободно 0», а кладовщик стоит
    // перед полной полкой и идёт «исправлять» остаток.
    expect(res.body.error).not.toContain('свободно 0');
    expect((await row('A-01'))?.quantity).toBe(40);
  });

  it('после разблокировки принимает снова', async () => {
    await api(fx.token, 'POST', `/pos/bins/${blockedBinId}/unblock`, {});
    expect((await putaway({ toBin: 'A-01' })).status).toBe(200);
    expect((await row('A-01'))?.quantity).toBe(45);
  });

  it('и в списке ячеек она помечена заблокированной — экран на это и смотрит', async () => {
    const bins = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    const codes = bins.body.bins.map((b: { code: string; blocked: boolean }) => [b.code, b.blocked]);
    expect(codes).toEqual([['A-01', true], ['A-02', false]]);
  });

  it('и единица измерения у содержимого есть — «40» на полке мешков ничего не говорит', async () => {
    const bins = await api(fx.token, 'GET', `/pos/bins?locationId=${fx.locationId}`);
    const bin = bins.body.bins.find((b: { code: string }) => b.code === 'A-01');
    expect(bin.contents[0].unit).toBeTruthy();
  });
});
