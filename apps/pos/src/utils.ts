import { translate } from './i18n';
import { getLanguage } from './i18n/useLanguage';

export function genId(prefix: string): string {
  // A sale's id is what the server matches a retry against, so two registers
  // generating the same one would make the second register's sale replay the
  // first's receipt and vanish. Timestamp + six random characters is not a
  // strong enough guarantee for that; randomUUID is. The old shape stays as a
  // fallback for the contexts where crypto.randomUUID isn't exposed — older
  // Android WebViews, and any non-secure origin.
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${unique}`;
}

export function formatMoney(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₸`;
}

export function formatWeight(kg: number): string {
  // Not a component, so it reads the language rather than taking a hook.
  // The abbreviation happens to be spelled the same in both languages; it
  // lives in the dictionary anyway so that no display text sits in code.
  const kilograms = translate(getLanguage(), 'unit.kg');
  return `${kg.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} ${kilograms}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

export function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/**
 * A scanner returns one number and no context: the bottle's barcode and the
 * case's look identical to it, so the lookup has to answer both "which
 * product" and "how many of it" at once.
 *
 * Deliberately duplicated from the API's resolveScannedBarcode rather than
 * shared: the register has to read a case barcode with the network down, so
 * this has to run against the catalog it already holds.
 *
 * A unit barcode wins over a pack barcode on a tie — whatever someone is
 * holding at a register is far more likely to be the unit.
 */
export function resolveScannedBarcode(
  barcode: string,
  products: { id: string; barcode: string; packagings: { id: string; unitsPerPack: number; barcode: string }[] }[],
): { productId: string; unitsPerPack: number } | null {
  const code = barcode.trim();
  if (!code) return null;

  const product = products.find((p) => p.barcode === code);
  if (product) return { productId: product.id, unitsPerPack: 1 };

  for (const candidate of products) {
    const pack = candidate.packagings.find((p) => p.barcode === code);
    if (pack) return { productId: candidate.id, unitsPerPack: pack.unitsPerPack };
  }
  return null;
}

/**
 * Turns whatever landed in the box into a grid of cells.
 *
 * Copying a selection out of Excel puts tab-separated text on the clipboard,
 * so pasting is a complete import path that needs no file, no upload and no
 * spreadsheet library — which matters, because telling a shop owner to "save
 * as CSV first" is exactly the friction that ends a one-day launch.
 *
 * A saved CSV is handled too. Excel in a Russian or Kazakh locale writes
 * semicolons rather than commas, so the delimiter is worked out from the text
 * instead of assumed.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const counts: Record<string, number> = {
    '\t': (firstLine.match(/\t/g) ?? []).length,
    ';': (firstLine.match(/;/g) ?? []).length,
    ',': (firstLine.match(/,/g) ?? []).length,
  };
  // Tab first: a pasted selection is unambiguous, while a comma inside a
  // product name would otherwise win the count on its own.
  if (counts['\t'] > 0) return '\t';
  if (counts[';'] >= counts[',']) return counts[';'] > 0 ? ';' : ',';
  return ',';
}

export function parseSheet(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted cell is one literal quote.
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell === '') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      // Swallow the second half of a CRLF rather than emitting a blank row.
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.map((r) => r.map((c) => c.trim()));
}
