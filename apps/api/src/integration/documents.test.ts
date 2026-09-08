import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
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

async function documents(query: string) {
  return api(fx.token, 'GET', `/pos/documents?locationId=${fx.locationId}&${query}`);
}

async function openShift() {
  const res = await api(fx.token, 'POST', '/pos/shifts', {
    locationId: fx.locationId,
    openingCash: 10_000,
    clientCommandId: 'shift-1',
  });
  return res.body.id as string;
}

async function sell(shiftId: string | null, quantity: number, over: Record<string, unknown> = {}) {
  return api(fx.token, 'POST', '/pos/sales', {
    locationId: fx.locationId,
    ...(shiftId ? { shiftId } : {}),
    paymentMethod: 'cash',
    items: [{ productId: fx.productId, quantity, price: 200 }],
    ...over,
  });
}

describe('the documents behind a figure', () => {
  it('lists one shift’s own sales', async () => {
    // The drill-down the cash reconciliation needs: an owner looking at a shift
    // three thousand short could see the number and nothing underneath it.
    const shiftId = await openShift();
    await sell(shiftId, 3);
    await sell(shiftId, 2);
    // One outside the shift, which must not appear.
    await sell(null, 7);

    const res = await documents(`shiftId=${shiftId}&type=sale`);
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(2);
    expect(res.body.documents.map((d: any) => d.total).sort()).toEqual([400, 600]);
  });

  it('names the type in the words an owner uses', async () => {
    await sell(null, 1);
    const res = await documents('type=sale');
    expect(res.body.documents[0]).toMatchObject({ type: 'sale', typeLabel: 'Продажа' });
  });

  it('reports what was actually collected, not the list price', async () => {
    // Every summary above this screen is built from the collected figure, and a
    // drill-down that disagrees with the number it explains is worse than none.
    await sell(null, 10, { discountType: 'percent', discountValue: 10 });
    const res = await documents('type=sale');
    expect(res.body.documents[0]).toMatchObject({ subtotal: 2000, discountAmount: 200, total: 1800 });
  });

  it('spells out a split payment', async () => {
    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      items: [{ productId: fx.productId, quantity: 10, price: 200 }],
      payments: [{ method: 'kaspi', amount: 1500 }, { method: 'cash', amount: 500 }],
    });
    const res = await documents('type=sale');
    expect(res.body.documents[0].payments).toHaveLength(2);
  });

  it('filters to one person, for the flagged-cashier drill-down', async () => {
    const other = await prisma.user.create({
      data: { companyId: fx.companyId, name: 'Дана', role: 'cashier', posPin: '7777' },
    });
    await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'damage',
      note: 'разбили',
      items: [{ productId: fx.productId, quantity: 2 }],
    });
    await prisma.document.updateMany({ where: { type: 'write_off' }, data: { createdBy: other.id } });

    const mine = await documents(`createdBy=${fx.userId}&type=write_off`);
    expect(mine.body.documents).toHaveLength(0);

    const theirs = await documents(`createdBy=${other.id}&type=write_off`);
    expect(theirs.body.documents).toHaveLength(1);
    expect(theirs.body.documents[0].createdByName).toBe('Дана');
  });

  it('carries the written reason, which is the part that answers why', async () => {
    await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'damage',
      note: 'уронили при разгрузке',
      items: [{ productId: fx.productId, quantity: 2 }],
    });
    const res = await documents('type=write_off');
    expect(res.body.documents[0]).toMatchObject({ reason: 'уронили при разгрузке', reasonCode: 'damage' });
  });

  it('filters to one product', async () => {
    const bread = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 250 },
    });
    await sell(null, 1);
    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: '',
      supplierPhone: '',
      items: [{ productId: bread.id, quantity: 5, price: 100, packagingId: null }],
    });

    const res = await documents(`productId=${bread.id}`);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].type).toBe('receipt');
  });

  it('takes several types at once', async () => {
    await sell(null, 1);
    await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId, reasonCode: 'damage', note: 'брак', items: [{ productId: fx.productId, quantity: 1 }],
    });

    const res = await documents('type=sale,write_off');
    expect(res.body.documents.map((d: any) => d.type).sort()).toEqual(['sale', 'write_off']);
  });

  it('returns nothing for a shift belonging to another company', async () => {
    // Rather than somebody else's sales, and rather than an error that confirms
    // the id exists.
    const shiftId = await openShift();
    await sell(shiftId, 1);

    const other = await createFixture({ openingQuantity: 5 });
    const res = await api(other.token, 'GET', `/pos/documents?locationId=${other.locationId}&shiftId=${shiftId}`);
    expect(res.status).toBe(200);
    expect(res.body.documents).toEqual([]);
  });

  it('is refused to a cashier', async () => {
    // Every document in the building, with costs and counterparties, is not a
    // cashier's to browse.
    await resetDatabase();
    const cashier = await createFixture({ role: 'cashier' });
    const res = await api(cashier.token, 'GET', `/pos/documents?locationId=${cashier.locationId}`);
    expect(res.status).toBe(403);
  });

  it('shows one company nothing of another', async () => {
    await sell(null, 1);
    const other = await createFixture({ openingQuantity: 5 });
    const res = await api(other.token, 'GET', `/pos/documents?locationId=${other.locationId}`);
    expect(res.body.documents).toEqual([]);
  });
});
