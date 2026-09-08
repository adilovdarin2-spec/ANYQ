import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

let fx: Fixture;
let baseUrl = '';
let receiptId = '';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

beforeAll(async () => {
  baseUrl = await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 100 });
  const receipt = await api(fx.token, 'POST', '/pos/receipts', {
    locationId: fx.locationId,
    supplierName: 'Поставщик',
    supplierPhone: '',
    items: [{ productId: fx.productId, quantity: 10, price: 100, packagingId: null }],
  });
  receiptId = receipt.body.id;
});

async function attach(base64 = jpeg.toString('base64'), extra: Record<string, unknown> = {}) {
  return api(fx.token, 'POST', `/pos/documents/${receiptId}/photos`, { base64, ...extra });
}

describe('photographing a delivery note', () => {
  it('attaches it to the delivery', async () => {
    // The note is the only record of what the driver actually brought, and it
    // leaves with him.
    const res = await attach(jpeg.toString('base64'), { width: 1200, height: 1600 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ mimeType: 'image/jpeg', byteSize: jpeg.length, width: 1200, height: 1600 });
  });

  it('hands the same bytes back', async () => {
    const created = await attach();
    const res = await fetch(`${baseUrl}/pos/photos/${created.body.id}`, {
      headers: { Authorization: `Bearer ${fx.token}` },
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(jpeg)).toBe(true);
  });

  it('serves it with the type detected from the bytes, and tells the browser not to sniff', async () => {
    // Together these are what stop an upload from becoming a stored
    // cross-site scripting hole.
    const created = await attach();
    const res = await fetch(`${baseUrl}/pos/photos/${created.body.id}`, {
      headers: { Authorization: `Bearer ${fx.token}` },
    });
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('accepts the data: URL a browser canvas produces', async () => {
    const res = await attach(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    expect(res.status).toBe(201);
  });

  it('refuses something that is not an image, whatever it claims to be', async () => {
    const html = Buffer.from('<script>alert(1)</script>                ').toString('base64');
    const res = await attach(`data:image/jpeg;base64,${html}`);
    expect(res.status).toBe(400);
    expect(await prisma.documentPhoto.count()).toBe(0);
  });

  it('refuses a sixth photo on one document', async () => {
    for (let i = 0; i < 5; i += 1) expect((await attach()).status).toBe(201);
    const sixth = await attach();
    expect(sixth.status).toBe(400);
    expect(await prisma.documentPhoto.count()).toBe(5);
  });

  it('lists what is attached without the bytes', async () => {
    // A listing that carried them would cost megabytes for a screen showing a
    // paperclip.
    await attach();
    const list = await api(fx.token, 'GET', `/pos/documents/${receiptId}/photos`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ mimeType: 'image/jpeg', byteSize: jpeg.length });
    expect(list.body[0]).not.toHaveProperty('bytes');
  });

  it('says on the document list that there is a photo', async () => {
    await attach();
    const docs = await api(fx.token, 'GET', `/pos/documents?locationId=${fx.locationId}&type=receipt`);
    expect(docs.body.documents[0].photoCount).toBe(1);
  });

  it('refuses a document belonging to another company', async () => {
    const other = await createFixture({ openingQuantity: 5 });
    const res = await api(other.token, 'POST', `/pos/documents/${receiptId}/photos`, {
      base64: jpeg.toString('base64'),
    });
    expect(res.status).toBe(404);
  });

  it('will not serve a photo to another company', async () => {
    const created = await attach();
    const other = await createFixture({ openingQuantity: 5 });
    const res = await api(other.token, 'GET', `/pos/photos/${created.body.id}`);
    expect(res.status).toBe(404);
  });

  it('goes with the document when the document goes', async () => {
    // On a document with no stock movements behind it, because a receipt's
    // ledger rows hold it in place — which is the point of the ledger.
    const order = await prisma.document.create({
      data: {
        companyId: fx.companyId,
        locationId: fx.locationId,
        type: 'order',
        status: 'pending',
        createdBy: fx.userId,
      },
    });
    await api(fx.token, 'POST', `/pos/documents/${order.id}/photos`, { base64: jpeg.toString('base64') });
    expect(await prisma.documentPhoto.count()).toBe(1);

    await prisma.document.delete({ where: { id: order.id } });
    expect(await prisma.documentPhoto.count()).toBe(0);
  });
});

describe('removing a photo', () => {
  it('is refused to a cashier', async () => {
    // Deleting the evidence behind a short delivery is not a storeman's
    // decision, and it is the one thing somebody would want to do quietly.
    const created = await attach();
    await resetDatabase();
    const cashier = await createFixture({ role: 'cashier' });
    const res = await api(cashier.token, 'DELETE', `/pos/photos/${created.body.id}`);
    expect(res.status).toBe(403);
  });

  it('works for an owner', async () => {
    const created = await attach();
    expect((await api(fx.token, 'DELETE', `/pos/photos/${created.body.id}`)).status).toBe(200);
    expect(await prisma.documentPhoto.count()).toBe(0);
  });
});
