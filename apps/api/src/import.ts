export type ImportField =
  | 'name'
  | 'barcode'
  | 'category'
  | 'unit'
  | 'purchasePrice'
  | 'salePrice'
  | 'quantity';

/**
 * What a shop's own spreadsheet calls each column. Nobody is going to rename
 * their headings to match ours, and a system that insists gets the file
 * emailed to somebody who retypes it.
 *
 * Matching is on a squashed form — lowercase, no spaces, dots or dashes — so
 * "Цена продажи", "цена_продажи" and "ЦенаПродажи" are one heading.
 */
const HEADER_ALIASES: Record<ImportField, string[]> = {
  name: ['наименование', 'название', 'товар', 'номенклатура', 'атауы', 'аты', 'name', 'product', 'title'],
  barcode: ['штрихкод', 'штрихкодтовара', 'ean', 'ean13', 'barcode', 'бар', 'шк'],
  category: ['категория', 'группа', 'раздел', 'санат', 'category', 'group'],
  unit: ['ед', 'едизм', 'единица', 'единицаизмерения', 'бірлік', 'unit', 'uom'],
  purchasePrice: ['закуп', 'закупка', 'закупочная', 'закупочнаяцена', 'себестоимость', 'приход', 'purchase', 'cost'],
  salePrice: ['цена', 'ценапродажи', 'розница', 'розничнаяцена', 'продажа', 'бағасы', 'price', 'sale', 'retail'],
  quantity: ['количество', 'колво', 'остаток', 'остатки', 'запас', 'саны', 'qty', 'quantity', 'stock'],
};

export function normaliseHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s._\-/\\]/g, '')
    .trim();
}

export type ColumnMap = Partial<Record<ImportField, number>>;

// Which column is which. A heading that matches nothing is simply ignored —
// spreadsheets are full of columns nobody else needs, and refusing a file for
// having an extra one would be absurd.
export function detectColumns(header: string[]): ColumnMap {
  return detectColumnsWith(header, {});
}

/**
 * The same, plus headings that only one program uses.
 *
 * `extra` wins over the general dictionary, because a program-specific heading
 * is the more specific claim: "Цена реализации" in a Wipon export is the sale
 * price even when the same file also has a column called "Цена", which the
 * general dictionary would otherwise take.
 */
export function detectColumnsWith(
  header: string[],
  extra: Partial<Record<ImportField, string[]>>,
): ColumnMap {
  const map: ColumnMap = {};

  header.forEach((cell, index) => {
    const key = normaliseHeader(cell ?? '');
    if (!key) return;
    for (const [field, aliases] of Object.entries(extra) as [ImportField, string[]][]) {
      if (map[field] !== undefined) continue;
      if (aliases.includes(key)) {
        map[field] = index;
        return;
      }
    }
  });

  header.forEach((cell, index) => {
    const key = normaliseHeader(cell ?? '');
    // A column already claimed above is not offered again: one heading must
    // not end up standing for two fields.
    if (!key || Object.values(map).includes(index)) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ImportField, string[]][]) {
      if (map[field] !== undefined) continue;
      // Exact first, then prefix: "ценапродажи" must not be claimed by "цена".
      if (aliases.includes(key)) {
        map[field] = index;
        return;
      }
    }
  });

  // Second pass for headings that only start with a known word, run after every
  // exact match is settled so a loose match can't steal a column from one.
  header.forEach((cell, index) => {
    const key = normaliseHeader(cell ?? '');
    if (!key || Object.values(map).includes(index)) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ImportField, string[]][]) {
      if (map[field] !== undefined) continue;
      if (aliases.some((alias) => key.startsWith(alias))) {
        map[field] = index;
        return;
      }
    }
  });

  return map;
}

// Numbers as people actually type them: "1 200,50", "1200.5", "1 200 ₸", "—".
//
// A comma is a decimal separator and a space is a thousands separator, which
// is how a Russian or Kazakh locale writes money — so "1,5" is one and a half,
// not fifteen hundred. Where both a comma and a dot appear, the rightmost is
// the decimal point and the other is grouping.
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;

  const cleaned = raw.replace(/[^\d,.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === ',') return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalised: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    normalised = cleaned.slice(0, decimalAt).replace(/[,.]/g, '') + '.' + cleaned.slice(decimalAt + 1);
  } else if (lastComma >= 0) {
    normalised = cleaned.replace(/,/g, '.');
  } else {
    normalised = cleaned;
  }

  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

export interface ExistingProduct {
  id: string;
  name: string;
  barcode: string | null;
}

export interface ImportRow {
  /** 1-based row number in the file the person is looking at, header included. */
  line: number;
  name: string;
  barcode: string | null;
  category: string | null;
  unit: string;
  purchasePrice: number;
  salePrice: number;
  quantity: number;
  /** Set when this row updates a product that already exists. */
  existingProductId: string | null;
}

export interface ImportProblem {
  line: number;
  /** blocking — the row cannot be imported. warning — it can, but somebody should look. */
  severity: 'error' | 'warning';
  message: string;
}

export interface ImportPlan {
  rows: ImportRow[];
  problems: ImportProblem[];
  created: number;
  updated: number;
  /** Rows dropped because nothing could be done with them. */
  skipped: number;
}

const MAX_NAME_LENGTH = 200;

// Turns a grid of strings into what will actually be written, plus everything
// wrong with it, each pinned to the row the person can see on screen.
//
// Nothing is written here. An import that starts applying rows and stops at
// the first bad one leaves a catalogue nobody can reason about — half in, half
// not, and no way to tell which. So the whole file is judged first, and the
// person decides whether to proceed.
export function buildImportPlan(
  grid: string[][],
  existing: ExistingProduct[],
  /**
   * Headings peculiar to the program the file came out of. Passed as plain data
   * rather than as the program itself, so the catalogue of programs can depend
   * on the importer and not the other way round.
   */
  extraAliases: Partial<Record<ImportField, string[]>> = {},
): ImportPlan {
  const problems: ImportProblem[] = [];
  const rows: ImportRow[] = [];

  const nonEmpty = grid.filter((row) => row.some((cell) => (cell ?? '').trim() !== ''));
  if (nonEmpty.length === 0) {
    return { rows: [], problems: [{ line: 0, severity: 'error', message: 'Файл пуст' }], created: 0, updated: 0, skipped: 0 };
  }

  const [header, ...body] = nonEmpty;
  const columns = detectColumnsWith(header, extraAliases);

  if (columns.name === undefined) {
    problems.push({
      line: 1,
      severity: 'error',
      message: 'Не найден столбец с названием товара. Назовите его «Наименование» и повторите.',
    });
    return { rows: [], problems, created: 0, updated: 0, skipped: nonEmpty.length - 1 };
  }
  if (columns.salePrice === undefined) {
    problems.push({
      line: 1,
      severity: 'error',
      message: 'Не найден столбец с ценой продажи. Назовите его «Цена» и повторите.',
    });
    return { rows: [], problems, created: 0, updated: 0, skipped: nonEmpty.length - 1 };
  }

  const byBarcode = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));
  const seenBarcodes = new Map<string, number>();
  const seenNames = new Map<string, number>();

  let skipped = 0;

  body.forEach((raw, index) => {
    // +2: one for the header, one because people count from one.
    const line = index + 2;
    const cell = (field: ImportField): string => {
      const at = columns[field];
      return at === undefined ? '' : (raw[at] ?? '').trim();
    };

    const name = cell('name');
    if (!name) {
      problems.push({ line, severity: 'error', message: 'Нет названия — строка пропущена' });
      skipped += 1;
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      problems.push({ line, severity: 'error', message: 'Слишком длинное название — строка пропущена' });
      skipped += 1;
      return;
    }

    const salePrice = parseNumber(cell('salePrice'));
    if (salePrice === null || salePrice < 0) {
      problems.push({ line, severity: 'error', message: `«${name}»: цена продажи не распознана — строка пропущена` });
      skipped += 1;
      return;
    }

    const purchaseRaw = cell('purchasePrice');
    const purchasePrice = parseNumber(purchaseRaw);
    if (purchaseRaw && purchasePrice === null) {
      problems.push({ line, severity: 'warning', message: `«${name}»: закупочная цена не распознана, записана как 0` });
    }
    if (purchasePrice !== null && purchasePrice > salePrice) {
      problems.push({ line, severity: 'warning', message: `«${name}»: закупка дороже продажи — проверьте` });
    }

    const quantityRaw = cell('quantity');
    const quantity = parseNumber(quantityRaw);
    if (quantityRaw && quantity === null) {
      problems.push({ line, severity: 'warning', message: `«${name}»: количество не распознано, записано как 0` });
    }
    if (quantity !== null && quantity < 0) {
      problems.push({ line, severity: 'warning', message: `«${name}»: отрицательный остаток, записан как 0` });
    }

    const barcodeRaw = cell('barcode');
    const barcode = barcodeRaw || null;

    // A barcode twice in one file means two rows claim the same goods, and
    // whichever lands second silently wins. Better to say so and keep the
    // first than to import a catalogue with a coin-flip in it.
    if (barcode) {
      const seenAt = seenBarcodes.get(barcode);
      if (seenAt !== undefined) {
        problems.push({ line, severity: 'error', message: `«${name}»: штрихкод ${barcode} уже был в строке ${seenAt} — строка пропущена` });
        skipped += 1;
        return;
      }
      seenBarcodes.set(barcode, line);
    }

    const nameKey = name.toLowerCase();
    const nameSeenAt = seenNames.get(nameKey);
    if (nameSeenAt !== undefined && !barcode) {
      problems.push({ line, severity: 'error', message: `«${name}»: такое название уже было в строке ${nameSeenAt} — строка пропущена` });
      skipped += 1;
      return;
    }
    seenNames.set(nameKey, line);

    // Matched on barcode first because it identifies goods; a name is what
    // somebody typed, and two shops spell the same thing three ways.
    const match = (barcode ? byBarcode.get(barcode) : undefined) ?? byName.get(nameKey) ?? null;

    rows.push({
      line,
      name,
      barcode,
      category: cell('category') || null,
      unit: cell('unit') || 'шт',
      // Whole tenge, because that is what every price in this system is. A
      // file quoting 199,90 lands as 200 rather than being refused.
      purchasePrice: Math.max(Math.round(purchasePrice ?? 0), 0),
      salePrice: Math.round(salePrice),
      quantity: Math.max(quantity ?? 0, 0),
      existingProductId: match?.id ?? null,
    });
  });

  return {
    rows,
    problems,
    created: rows.filter((r) => !r.existingProductId).length,
    updated: rows.filter((r) => r.existingProductId).length,
    skipped,
  };
}
