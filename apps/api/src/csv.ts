/**
 * Writing CSV that opens correctly in the spreadsheet the owner actually has.
 *
 * Which, in Kazakhstan, is Excel with a Russian locale, and that decides two
 * things the RFC does not:
 *
 *  - **The separator is a semicolon.** Russian Excel reads the comma as a
 *    decimal separator, so a comma-separated file lands entirely in column A
 *    and the owner concludes the export is broken. It is a real trade for
 *    strict RFC 4180, and openability wins: a file nobody can open has no
 *    correctness to speak of.
 *
 *  - **The file starts with a byte-order mark.** Without it Excel guesses the
 *    encoding from the bytes and guesses cp1251, so every product name comes
 *    out as mojibake. Three bytes are the difference between an export and a
 *    support call.
 */

export const CSV_SEPARATOR = ';';

/** UTF-8 BOM. Excel reads the file as cp1251 without it. */
export const CSV_BOM = '﻿';

/**
 * One cell.
 *
 * Quoted whenever it holds a separator, a quote or a newline — a product named
 * `Сок "Дар" 1л` and an address with a line break both occur, and either one
 * unquoted shifts every column after it.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'да' : 'нет';

  const text = String(value);
  if (!/[";\n\r,]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(CSV_SEPARATOR);
}

/**
 * A whole file, header first.
 *
 * `\r\n` because that is what Excel expects; a bare `\n` is read fine by
 * everything else, so there is nothing to lose by using the stricter one.
 */
export function csvFile(header: string[], rows: unknown[][]): string {
  return CSV_BOM + [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}

/**
 * A filename a person can find again in their downloads folder a month later.
 *
 * Dated, because an owner exports the same thing repeatedly and
 * `products (3).csv` tells them nothing about which is which.
 */
export function csvFilename(dataset: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `anyq-${dataset}-${date}.csv`;
}
