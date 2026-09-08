import { crc32, deflateRawSync } from 'node:zlib';
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
  fx = await createFixture();
});

const grid = [
  ['Наименование', 'Штрихкод', 'Цена', 'Закуп', 'Остаток'],
  ['Молоко 1 л', '4870101', '450', '300', '24'],
  ['Хлеб бородинский', '4870102', '280', '180', '15'],
  ['Сахар 1 кг', '', '520', '400', '0'],
];

describe('bringing a catalogue in', () => {
  it('says what it would do without writing anything', async () => {
    const before = await prisma.product.count({ where: { companyId: fx.companyId } });
    const preview = await api(fx.token, 'POST', '/pos/import/products/preview', { grid });

    expect(preview.status).toBe(200);
    expect(preview.body.created).toBe(3);
    expect(preview.body.updated).toBe(0);
    expect(await prisma.product.count({ where: { companyId: fx.companyId } })).toBe(before);
  });

  it('creates the products and puts their opening stock through the ledger', async () => {
    // Stock written straight into the table is what left the seed failing its
    // own reconciliation. An import doing the same would hand every new
    // customer a red check on day one.
    const done = await api(fx.token, 'POST', '/pos/import/products', { locationId: fx.locationId, grid });

    expect(done.status).toBe(201);
    expect(done.body.created).toBe(3);
    expect(done.body.stocked).toBe(2);

    const milk = await prisma.product.findFirst({ where: { companyId: fx.companyId, barcode: '4870101' } });
    expect(milk?.salePrice).toBe(450);
    expect(await stockAt(milk!.id, fx.locationId)).toBe(24);

    const movements = await prisma.stockMovement.findMany({ where: { productId: milk!.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0].reason).toBe('opening');
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('updates prices on a second run and leaves the shelf alone', async () => {
    // Somebody re-importing a price list is not asking to have a day's trading
    // overwritten, and would not expect it to be.
    await api(fx.token, 'POST', '/pos/import/products', { locationId: fx.locationId, grid });
    const milk = await prisma.product.findFirst({ where: { companyId: fx.companyId, barcode: '4870101' } });
    await api(fx.token, 'POST', '/pos/sales', {
      locationId: fx.locationId,
      paymentMethod: 'cash',
      items: [{ productId: milk!.id, quantity: 4, price: 450 }],
    });

    const newPrices = [grid[0], ['Молоко 1 л', '4870101', '480', '310', '24'], grid[2], grid[3]];
    const again = await api(fx.token, 'POST', '/pos/import/products', { locationId: fx.locationId, grid: newPrices });

    expect(again.body.created).toBe(0);
    expect(again.body.updated).toBe(3);

    const reloaded = await prisma.product.findUnique({ where: { id: milk!.id } });
    expect(reloaded?.salePrice).toBe(480);
    // 24 in, 4 sold. Not 24 again.
    expect(await stockAt(milk!.id, fx.locationId)).toBe(20);
    expect(await findLedgerMismatches()).toEqual([]);
  });

  it('matches a product that is already there by barcode, whatever the file calls it', async () => {
    await api(fx.token, 'POST', '/pos/import/products', { locationId: fx.locationId, grid });
    const renamed = [grid[0], ['Молоко питьевое, 1 литр', '4870101', '500', '320', '5']];
    const again = await api(fx.token, 'POST', '/pos/import/products', { locationId: fx.locationId, grid: renamed });

    expect(again.body.created).toBe(0);
    expect(again.body.updated).toBe(1);
    expect(await prisma.product.count({ where: { companyId: fx.companyId, barcode: '4870101' } })).toBe(1);
  });

  it('imports the good rows and reports the bad ones rather than refusing the file', async () => {
    // A shop's own spreadsheet is never clean. Refusing the whole thing over
    // one row is how an import ends with somebody retyping five hundred lines.
    const messy = [
      grid[0],
      ['Молоко 1 л', '4870101', '450', '300', '24'],
      ['', '4870103', '100', '', ''],
      ['Кефир', '', 'по запросу', '', ''],
      ['Сметана', '4870104', '390', '250', '6'],
    ];
    const done = await api(fx.token, 'POST', '/pos/import/products', { locationId: fx.locationId, grid: messy });

    expect(done.status).toBe(201);
    expect(done.body.created).toBe(2);
    expect(done.body.skipped).toBe(2);
    expect(done.body.problems).toHaveLength(2);
    expect(done.body.problems.every((p: any) => typeof p.line === 'number')).toBe(true);
  });

  it('imports once when the same request arrives twice', async () => {
    // A thousand products imported twice is a catalogue nobody can clean up
    // by hand.
    const key = 'import-once';
    const first = await api(fx.token, 'POST', '/pos/import/products', { locationId: fx.locationId, grid }, { 'Idempotency-Key': key });
    const second = await api(fx.token, 'POST', '/pos/import/products', { locationId: fx.locationId, grid }, { 'Idempotency-Key': key });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await prisma.product.count({ where: { companyId: fx.companyId, barcode: { not: null } } })).toBe(3);
  });

  it('refuses a file with nothing importable in it, and says why', async () => {
    const useless = [['Поставщик', 'Телефон'], ['ТОО Ромашка', '+77010000000']];
    const refused = await api(fx.token, 'POST', '/pos/import/products', { locationId: fx.locationId, grid: useless });

    expect(refused.status).toBe(400);
    expect(refused.body.problems[0].message).toContain('Наименование');
  });

  it('is not something a cashier can do', async () => {
    const cashier = await createFixture({ role: 'cashier' });
    const refused = await api(cashier.token, 'POST', '/pos/import/products', { locationId: cashier.locationId, grid });
    expect(refused.status).toBe(403);
  });
});

describe('bringing a catalogue in as a spreadsheet', () => {
  /**
   * A real .xlsx, built here rather than checked in as a fixture: the whole
   * point is that the server parses the zip and the XML, and constructing them
   * proves that rather than proving one file happens to work.
   */
  function buildXlsx(rows: string[][]): string {
    const strings: string[] = [];
    const index = (value: string) => {
      const existing = strings.indexOf(value);
      if (existing !== -1) return existing;
      strings.push(value);
      return strings.length - 1;
    };
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const sheetRows = rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
            // Numbers as numbers, text through the shared-string table — the
            // two shapes Excel actually writes.
            return /^\d+(\.\d+)?$/.test(cell)
              ? `<c r="${ref}"><v>${cell}</v></c>`
              : `<c r="${ref}" t="s"><v>${index(cell)}</v></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join('');

    const files: Record<string, string> = {
      'xl/sharedStrings.xml': `<sst>${strings.map((v) => `<si><t>${escape(v)}</t></si>`).join('')}</sst>`,
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
    };

    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
      const raw = Buffer.from(content, 'utf8');
      const data = deflateRawSync(raw);
      const nameBytes = Buffer.from(name, 'utf8');
      const checksum = crc32(raw);

      const local = Buffer.alloc(30 + nameBytes.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(nameBytes.length, 26);
      nameBytes.copy(local, 30);
      locals.push(local, data);

      const central = Buffer.alloc(46 + nameBytes.length);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(8, 10);
      central.writeUInt32LE(checksum, 16);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(raw.length, 24);
      central.writeUInt16LE(nameBytes.length, 28);
      central.writeUInt32LE(offset, 42);
      nameBytes.copy(central, 46);
      centrals.push(central);

      offset += local.length + data.length;
    }

    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(centrals.length, 8);
    end.writeUInt16LE(centrals.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...locals, directory, end]).toString('base64');
  }

  const priceList = [
    ['Название', 'Цена', 'Закупка', 'Штрихкод'],
    ['Сок «Дар» 1л', '890', '600', '4870000000011'],
    ['Печенье овсяное', '450', '300', ''],
  ];

  it('reads a real .xlsx and says what it would do', async () => {
    // The charter promises XLSX. Telling an owner to re-save their own price
    // list as CSV is the software's job pushed onto them.
    const res = await api(fx.token, 'POST', '/pos/import/products/preview', {
      xlsxBase64: buildXlsx(priceList),
    });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.sample[0].name).toBe('Сок «Дар» 1л');
    // Nothing written by a preview.
    expect(await prisma.product.count({ where: { companyId: fx.companyId } })).toBe(1);
  });

  it('imports from the same file', async () => {
    const res = await api(fx.token, 'POST', '/pos/import/products', {
      locationId: fx.locationId,
      xlsxBase64: buildXlsx(priceList),
    }, { 'Idempotency-Key': 'xlsx-1' });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    const juice = await prisma.product.findFirstOrThrow({ where: { name: 'Сок «Дар» 1л' } });
    expect(juice).toMatchObject({ salePrice: 890, purchasePrice: 600, barcode: '4870000000011' });
  });

  it('says plainly when the file is not a spreadsheet', async () => {
    const res = await api(fx.token, 'POST', '/pos/import/products/preview', {
      xlsxBase64: Buffer.from('это просто текст').toString('base64'),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('.xlsx');
  });

  it('still accepts a pasted grid', async () => {
    // The old path has to keep working: a register already in the field sends
    // a grid and nothing else.
    const res = await api(fx.token, 'POST', '/pos/import/products/preview', {
      grid: priceList,
    });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
  });
});
