import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { api, createFixture, prisma, resetDatabase, startTestServer, stopTestServer } from './harness';
import type { Fixture } from './harness';

let fx: Fixture;
let baseUrl = '';

beforeAll(async () => {
  baseUrl = await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture({ openingQuantity: 100 });
});

async function exportCsv(dataset: string) {
  return api(fx.token, 'GET', `/pos/export/${dataset}?locationId=${fx.locationId}`);
}

function lines(body: string): string[] {
  return String(body).replace(/^﻿/, '').trim().split('\r\n');
}

describe('taking the data out', () => {
  it('exports the catalogue with a header a person can read', async () => {
    const res = await exportCsv('products');
    expect(res.status).toBe(200);
    const [header, ...rows] = lines(res.body);
    expect(header).toBe('Название;Категория;Единица;Штрихкод;НКТ;Режим НДС;Закупочная цена;Цена продажи;В продаже');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Вода 1 л');
  });

  it('puts a byte-order mark on the wire, or Excel renders every name as mojibake', async () => {
    // Read as bytes on purpose. `Response.text()` strips a leading BOM per the
    // fetch spec, so a test that goes through it cannot tell a file Excel will
    // read correctly from one it will not.
    const res = await fetch(`${baseUrl}/pos/export/products?locationId=${fx.locationId}`, {
      headers: { Authorization: `Bearer ${fx.token}` },
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('offers the file as a download with a dated name', async () => {
    // An owner exports the same thing repeatedly, and "products (3).csv" says
    // nothing about which is which.
    const res = await fetch(`${baseUrl}/pos/export/products?locationId=${fx.locationId}`, {
      headers: { Authorization: `Bearer ${fx.token}` },
    });
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(decodeURIComponent(disposition)).toMatch(/anyq-products-.*\d{4}-\d{2}-\d{2}\.csv/);
    expect(res.headers.get('content-type')).toContain('text/csv');
  });

  it('exports stock with the unplaced pile named rather than left blank', async () => {
    const [header, ...rows] = lines((await exportCsv('stock')).body);
    expect(header).toContain('Ячейка');
    expect(rows[0]).toContain('не размещено');
  });

  it('exports sales one line per product, not one per receipt', async () => {
    // A receipt-level export cannot answer "how much of this did we sell",
    // which is the first thing anybody asks a spreadsheet.
    const other = await prisma.product.create({
      data: { companyId: fx.companyId, name: 'Хлеб', unit: 'шт', purchasePrice: 100, salePrice: 250 },
    });
    await api(fx.token, 'POST', '/pos/receipts', {
      locationId: fx.locationId,
      supplierName: '',
      supplierPhone: '',
      items: [{ productId: other.id, quantity: 10, price: 100, packagingId: null }],
    });
    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [
        { productId: fx.productId, quantity: 2, price: 200 },
        { productId: other.id, quantity: 3, price: 250 },
      ],
    });

    const rows = lines((await exportCsv('sales')).body).slice(1);
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.includes('Вода 1 л'))).toBe(true);
    expect(rows.some((r) => r.includes('Хлеб'))).toBe(true);
  });

  it('spells out a split payment rather than writing the word mixed', async () => {
    // "mixed" in a spreadsheet is a dead end: the owner cannot reconcile the
    // card column against the terminal's own report from it.
    //
    // And it spells it out in Russian. The file opens in the owner's Excel,
    // every column heading in it is Russian, and `kaspi 1500 + cash 500` asks
    // them to know the names this program uses internally.
    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      items: [{ productId: fx.productId, quantity: 10, price: 200 }],
      payments: [{ method: 'kaspi', amount: 1500 }, { method: 'cash', amount: 500 }],
    });

    const rows = lines((await exportCsv('sales')).body).slice(1);
    expect(rows[0]).toContain('Kaspi QR 1500 + Наличные 500');
  });

  it('exports the ledger with its author and reason', async () => {
    await api(fx.token, 'POST', '/pos/write-offs', {
      locationId: fx.locationId,
      reasonCode: 'damage',
      note: 'разбили при разгрузке',
      items: [{ productId: fx.productId, quantity: 2 }],
    });

    const [header, ...rows] = lines((await exportCsv('movements')).body);
    expect(header).toBe('Дата;Товар;Ячейка;Изменение;Причина;Документ;Кто');
    expect(rows.length).toBeGreaterThan(0);

    // Причина словом, а не значением из кода. В колонке стояло `write_off` —
    // английское слово в русском файле, который открывают в Excel.
    expect(rows.some((r) => r.includes('Списание'))).toBe(true);
    expect(rows.some((r) => r.includes('write_off'))).toBe(false);

    // И дата, которую Excel понимает как дату, в местном времени магазина.
    expect(rows[0]).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2};/);
  });

  it('exports counterparties with their credit terms', async () => {
    await prisma.counterparty.create({
      data: { companyId: fx.companyId, name: 'ТОО «Дар»', type: 'customer', phone: '+7701', creditAllowed: true, creditLimit: 500_000 },
    });
    const rows = lines((await exportCsv('counterparties')).body).slice(1);
    // The name holds a quote-like character and a space; it must survive.
    expect(rows[0]).toContain('ТОО «Дар»');
    expect(rows[0]).toContain('да');
    expect(rows[0]).toContain('500000');
  });

  it('gives a header and no rows when there is nothing, rather than an empty file', async () => {
    // An empty file looks like a failure; a header alone says plainly that
    // there was nothing in the period.
    const rows = lines((await exportCsv('sales')).body);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Дата');
  });

  it('refuses a dataset it does not have', async () => {
    const res = await api(fx.token, 'GET', `/pos/export/salaries?locationId=${fx.locationId}`);
    expect(res.status).toBe(404);
  });
});

describe('who may take the data out', () => {
  it('is refused to a cashier', async () => {
    // The whole catalogue with costs, every counterparty and every credit
    // limit is not a cashier's to carry out of the building.
    await resetDatabase();
    const cashier = await createFixture({ role: 'cashier' });
    const res = await api(cashier.token, 'GET', `/pos/export/products?locationId=${cashier.locationId}`);
    expect(res.status).toBe(403);
  });

  it('shows one company nothing of another', async () => {
    const other = await createFixture({ openingQuantity: 5 });
    const rows = lines((await api(other.token, 'GET', `/pos/export/products?locationId=${other.locationId}`)).body);
    // Its own single product and nothing of the first company's.
    expect(rows).toHaveLength(2);
  });

  it('refuses a location belonging to somebody else', async () => {
    const other = await createFixture({ openingQuantity: 5 });
    const res = await api(other.token, 'GET', `/pos/export/stock?locationId=${fx.locationId}`);
    expect(res.status).toBe(404);
  });
});
