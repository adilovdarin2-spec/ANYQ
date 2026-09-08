import { inflateRawSync } from 'node:zlib';

/**
 * Reading an .xlsx file, just far enough to get a grid of cells out of it.
 *
 * The charter promises XLSX and the import took pasted text and CSV. A shop's
 * price list arrives as a spreadsheet, and telling an owner to re-save it as
 * CSV is asking them to do the software's job — the kind of small friction
 * that makes somebody decide the whole system is awkward.
 *
 * Written out rather than pulled in, and the reasoning is the same as for the
 * TOTP code: the established package has a history of prototype-pollution and
 * ReDoS advisories, and this runs on a file an unauthenticated-ish user hands
 * us. What is actually needed is narrow — unzip two entries and read their
 * XML — so the attack surface of the whole of SheetML is not worth taking on
 * for it.
 *
 * An .xlsx is a ZIP of XML. The two entries that matter:
 *
 *   xl/worksheets/sheet1.xml  the cells, by A1-style reference
 *   xl/sharedStrings.xml      the strings, which cells refer to by index
 *
 * Everything else — styles, themes, charts, macros — is ignored, which is also
 * why this cannot be tricked into executing anything.
 */

/** Refuses a file before it is unzipped. A price list is kilobytes. */
export const MAX_XLSX_BYTES = 8 * 1024 * 1024;

/** And refuses one that inflates to something absurd: the zip-bomb guard. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export type XlsxFailure =
  | { status: 'notZip' }
  | { status: 'tooLarge' }
  | { status: 'noSheet' }
  | { status: 'corrupt'; detail: string };

export type XlsxResult = { status: 'ok'; grid: string[][] } | XlsxFailure;

export function xlsxErrorMessage(failure: XlsxFailure): string {
  switch (failure.status) {
    case 'notZip':
      return 'Это не файл Excel — сохраните как .xlsx или вставьте таблицу из буфера';
    case 'tooLarge':
      return 'Файл слишком большой для импорта';
    case 'noSheet':
      return 'В файле не нашёлся лист с данными';
    case 'corrupt':
      return 'Файл повреждён или в неизвестном формате';
    default:
      return 'Не удалось прочитать файл';
  }
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Every file in the archive.
 *
 * Read from the end, through the central directory, rather than by walking
 * local headers from the front. The local header's size fields are allowed to
 * be zero when a writer streams the file, with the real sizes following the
 * data — so a front-to-back reader works on files Excel writes and silently
 * fails on files some other tool wrote. The central directory always has them.
 */
function readZip(buffer: Buffer): ZipEntry[] | XlsxFailure {
  // End-of-central-directory record: the last thing in the file, found by its
  // signature, searched backwards because a comment may follow it.
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 0xffff; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return { status: 'notZip' };

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  try {
    for (let i = 0; i < count; i += 1) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) return { status: 'corrupt', detail: 'central directory' };

      const method = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localOffset = buffer.readUInt32LE(offset + 42);
      const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

      offset += 46 + nameLength + extraLength + commentLength;

      // Only the two entries that matter are inflated. Everything else in the
      // archive — styles, themes, anything a macro could hide in — is never
      // even decompressed.
      if (!isWanted(name)) continue;
      if (uncompressedSize > MAX_ENTRY_BYTES) return { status: 'tooLarge' };

      // The local header repeats the name and extra field; the data starts
      // after them, and the extra field's length can differ from the central
      // directory's, so it has to be read here rather than reused.
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.subarray(start, start + compressedSize);

      const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
      entries.push({ name, data });
    }
  } catch (err) {
    return { status: 'corrupt', detail: err instanceof Error ? err.message : 'unknown' };
  }

  return entries;
}

function isWanted(name: string): boolean {
  return name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name);
}

/** The text of one `<t>` run, which may be a self-closing empty one. */
function runText(run: string): string {
  if (run.endsWith('/>')) return '';
  return decodeEntities(run.replace(/<[^>]+>/g, ''));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    // Last, or an escaped ampersand in an entity would be decoded twice.
    .replace(/&amp;/g, '&');
}

/**
 * The shared string table.
 *
 * One `<si>` per string, and a string may be split across several `<t>` runs
 * when part of it is formatted differently — bold a single word in a product
 * name and Excel writes three runs. Joining them is the difference between
 * reading the name and reading a third of it.
 */
export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  // Self-closing first: `[^>]*` would otherwise match the slash of `<si/>`,
  // read it as an opening tag, and run on to the next `</si>` — swallowing the
  // string after it and shifting every index that follows.
  const items = xml.match(/<si\b[^>]*\/>|<si\b[^>]*>[\s\S]*?<\/si>/g) ?? [];
  for (const item of items) {
    const runs = item.match(/<t\b[^>]*\/>|<t\b[^>]*>[\s\S]*?<\/t>/g) ?? [];
    strings.push(runs.map(runText).join(''));
  }
  return strings;
}

/** 'BC12' → { column: 54, row: 11 }, both zero-based. */
export function parseCellRef(ref: string): { column: number; row: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) return null;
  let column = 0;
  for (const char of match[1]) column = column * 26 + (char.charCodeAt(0) - 64);
  return { column: column - 1, row: Number(match[2]) - 1 };
}

/**
 * The cells of one sheet, as a rectangular grid of text.
 *
 * Positions come from each cell's own reference rather than from counting
 * `<c>` elements, because Excel omits empty cells entirely: a row with
 * something in A and in D is written as two cells, and counting them would
 * move the fourth column into the second.
 */
export function parseSheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const cells = xml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? [];

  for (const cell of cells) {
    const refMatch = /\br="([A-Z]+\d+)"/.exec(cell);
    if (!refMatch) continue;
    const position = parseCellRef(refMatch[1]);
    if (!position) continue;

    const type = /\bt="([^"]+)"/.exec(cell)?.[1] ?? 'n';
    let value = '';

    if (type === 'inlineStr') {
      const runs = cell.match(/<t\b[^>]*\/>|<t\b[^>]*>[\s\S]*?<\/t>/g) ?? [];
      value = runs.map(runText).join('');
    } else {
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cell)?.[1] ?? '';
      if (type === 's') {
        // A shared-string cell holds an index, not text.
        const index = Number(decodeEntities(raw));
        value = Number.isInteger(index) && index >= 0 && index < sharedStrings.length ? sharedStrings[index] : '';
      } else {
        value = decodeEntities(raw);
      }
    }

    while (rows.length <= position.row) rows.push([]);
    const row = rows[position.row];
    while (row.length <= position.column) row.push('');
    row[position.column] = value;
  }

  return rows;
}

/**
 * An .xlsx buffer to a grid of strings.
 *
 * The first worksheet only. A price list with several sheets is usually one
 * list and several notes, and guessing which is the data would be worse than
 * taking the first and letting the preview show what was read — which the
 * import already makes the person confirm before anything is written.
 */
export function xlsxToGrid(buffer: Buffer): XlsxResult {
  if (buffer.length > MAX_XLSX_BYTES) return { status: 'tooLarge' };

  const entries = readZip(buffer);
  if (!Array.isArray(entries)) return entries;

  const sheets = entries
    .filter((entry) => entry.name.startsWith('xl/worksheets/'))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (sheets.length === 0) return { status: 'noSheet' };

  const sharedEntry = entries.find((entry) => entry.name === 'xl/sharedStrings.xml');
  const sharedStrings = sharedEntry ? parseSharedStrings(sharedEntry.data.toString('utf8')) : [];

  try {
    return { status: 'ok', grid: parseSheet(sheets[0].data.toString('utf8'), sharedStrings) };
  } catch (err) {
    return { status: 'corrupt', detail: err instanceof Error ? err.message : 'unknown' };
  }
}
