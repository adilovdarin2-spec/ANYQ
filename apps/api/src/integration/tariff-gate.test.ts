import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

/**
 * What a shop can still do once its tariff has run out.
 *
 * The gate is checked at `/pos/login`, and a POS token lasts thirty days — that
 * length is deliberate, because a till has to keep selling through a week with
 * no connection. Together those two facts mean the login check alone stops
 * nothing: a tariff that expires this morning leaves every token minted in the
 * last month working until it ages out.
 *
 * So the gate is also applied per route — to 21 of the 50 mutating ones. I went
 * in expecting that split to be an accident and found it is not: everything that
 * moves money or goods is gated, and the routes left open are open for reasons
 * that survive being said out loud. A shop that lapses mid-shift has real cash in
 * a real drawer, and refusing to let anybody reconcile it does not collect the
 * invoice any sooner. An owner whose tablet has been stolen must be able to cut
 * it off whatever the state of their account, because security is not a feature
 * you withhold for non-payment.
 *
 * Nothing here changed the code. It pins a line that was already right, so that
 * where it sits stays a decision rather than becoming one, and moving it takes an
 * argument.
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
  fx = await createFixture({ openingQuantity: 50 });
});

/**
 * Ends the tariff without touching the token already in the cashier's hands.
 *
 * Two days back, not one: the end date is inclusive through its own calendar day
 * in the shop's time zone, so "yesterday at this hour" is still today's date for
 * part of the night and would make this helper ambiguous at midnight.
 */
async function expireTariff(): Promise<void> {
  await prisma.tariff.update({
    where: { companyId: fx.companyId },
    data: { validUntil: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
  });
}

async function blockTariff(): Promise<void> {
  await prisma.tariff.update({ where: { companyId: fx.companyId }, data: { blocked: true } });
}

describe('a tariff that has run out', () => {
  it('turns a cashier away at the door', async () => {
    await expireTariff();
    const login = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    expect(login.status).toBe(403);
    expect(login.body.error).toContain('Срок действия тарифа');
  });

  it('says something different when the account is blocked rather than lapsed', async () => {
    // Two different conversations with support: one is "pay the invoice", the
    // other is "we have suspended you". Telling a shop the wrong one wastes a
    // morning.
    await blockTariff();
    const login = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    expect(login.status).toBe(403);
    expect(login.body.error).toContain('заблокирован');
  });

  it('stops the money the moment it lapses, even on a token minted before', async () => {
    // The one that matters commercially. The token in the cashier's hand is good
    // for thirty days; if selling were only gated at login, a lapsed shop would
    // trade for a month.
    await expireTariff();

    const sale = await api(
      fx.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 1, price: 200 }] },
      { 'Idempotency-Key': 'tariff-gate-sale' },
    );
    expect(sale.status).toBe(403);
    expect(sale.body.error).toContain('тариф');
  });

  it('stops goods moving as well as money', async () => {
    // A lapsed shop that cannot sell but can still receive and transfer is a
    // shop whose books keep changing while nobody is paying for them.
    await expireTariff();

    const receipt = await api(
      fx.token,
      'POST',
      '/pos/receipts',
      { locationId: fx.locationId, items: [{ productId: fx.productId, quantity: 5, price: 100 }] },
      { 'Idempotency-Key': 'tariff-gate-receipt' },
    );
    expect(receipt.status).toBe(403);

    const transfer = await api(
      fx.token,
      'POST',
      '/pos/transfers',
      {
        locationId: fx.locationId,
        toLocationId: fx.otherLocationId,
        items: [{ productId: fx.productId, quantity: 1 }],
      },
      { 'Idempotency-Key': 'tariff-gate-transfer' },
    );
    expect(transfer.status).toBe(403);
  });

  it('lets a shift be closed, because stranding cash in an open shift helps nobody', async () => {
    // Deliberately on the permitted side of the line. A shop that lapses
    // mid-shift has real money in a real drawer, and refusing to let anybody
    // reconcile it does not collect the invoice any sooner — it just leaves the
    // takings unaccounted for.
    const shift = await api(fx.token, 'POST', '/pos/shifts', {
      locationId: fx.locationId,
      openingCash: 1000,
      clientShiftId: 'tariff-gate-shift',
    });
    expect(shift.status).toBe(201);

    await expireTariff();

    const closed = await api(fx.token, 'PATCH', `/pos/shifts/${shift.body.id}/close`, { closingCashCounted: 1000 });
    expect(closed.status).toBe(200);
  });

  it('lets a stolen device be switched off, because security is not a paid feature', async () => {
    // Also deliberately permitted. Whatever the state of the invoice, an owner
    // must be able to cut off a tablet that has walked out of the building.
    const login = await api(null, 'POST', '/pos/login', {
      pin: fx.pin,
      deviceKey: 'aaaaaaaa-1111-4222-8333-444444444444',
    });
    expect(login.status).toBe(200);
    const other = await api(null, 'POST', '/pos/login', {
      pin: fx.pin,
      deviceKey: 'bbbbbbbb-1111-4222-8333-444444444444',
    });

    await expireTariff();

    const listed = await api(other.body.token, 'GET', '/pos/devices');
    expect(listed.status).toBe(200);
    const target = listed.body.devices.find((d: { current: boolean }) => !d.current);
    expect((await api(other.body.token, 'POST', `/pos/devices/${target.id}/revoke`)).status).toBe(200);
  });

  it('comes back the moment the tariff is renewed', async () => {
    await expireTariff();
    expect((await api(null, 'POST', '/pos/login', { pin: fx.pin })).status).toBe(403);

    await prisma.tariff.update({
      where: { companyId: fx.companyId },
      data: { validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), blocked: false },
    });

    const login = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    expect(login.status).toBe(200);
    const sale = await api(
      login.body.token,
      'POST',
      '/pos/sales',
      { locationId: fx.locationId, paymentMethod: 'cash', items: [{ productId: fx.productId, quantity: 1, price: 200 }] },
      { 'Idempotency-Key': 'tariff-gate-after-renewal' },
    );
    expect(sale.status).toBe(201);
  });
});

describe('а пока тариф ещё не кончился', () => {
  /**
   * То, чего не хватало рядом с этим шлюзом: предупреждения.
   *
   * Шлюз выше проверен со всех сторон — и он про минуту, когда уже поздно. Здесь
   * проверяется обвязка, через которую касса узнаёт об этом заранее: само число
   * считается чистой функцией и проверено отдельно, но функция, чей результат не
   * доходит до экрана, не предупреждает никого.
   */
  async function endOn(date: string): Promise<void> {
    await prisma.tariff.update({
      where: { companyId: fx.companyId },
      data: { validUntil: new Date(date) },
    });
  }

  /** Сегодняшняя дата по Казахстану — так же, как её считает сервер. */
  function kzToday(): string {
    return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  it('касса узнаёт при входе, сколько осталось', async () => {
    await endOn(kzToday());
    const login = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    expect(login.status).toBe(200);
    expect(login.body.tariff).toEqual({ validUntil: kzToday(), daysLeft: 0 });
  });

  it('в последний день вход ещё работает', async () => {
    // Та самая ошибка, из-за которой магазин терял кассу утром оплаченного дня.
    await endOn(kzToday());
    const login = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    expect(login.status).toBe(200);
  });

  it('с запасом в месяц ничего не обещает сверх даты', async () => {
    const far = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await endOn(far);
    const login = await api(null, 'POST', '/pos/login', { pin: fx.pin });
    expect(login.body.tariff.validUntil).toBe(far);
    expect(login.body.tariff.daysLeft).toBeGreaterThanOrEqual(29);
  });
});
