import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { crc32 } from 'node:zlib';
import {
  MAX_XLSX_BYTES,
  parseCellRef,
  parseSharedStrings,
  parseSheet,
  xlsxErrorMessage,
  xlsxToGrid,
} from './xlsx';

/**
 * Builds a real .xlsx in memory.
 *
 * A genuine ZIP with a central directory, rather than a fixture file checked
 * into the repo: the reader's whole job is to parse that structure, and a test
 * that constructs it proves the parsing rather than proving one file happens
 * to work.
 */
function buildXlsx(files: Record<string, string>, { store = false } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf8');
    const data = store ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name, 'utf8');
    const checksum = crc32(raw);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(store ? 0 : 8, 10);
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

  return Buffer.concat([...locals, directory, end]);
}

function sheet(rows: string): string {
  return `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;
}

describe('parseCellRef', () => {
  it('reads a single-letter column', () => {
    expect(parseCellRef('A1')).toEqual({ column: 0, row: 0 });
    expect(parseCellRef('C5')).toEqual({ column: 2, row: 4 });
  });

  it('reads a multi-letter column', () => {
    // A price list wide enough to reach AA is ordinary, and counting letters
    // one at a time stops at Z.
    expect(parseCellRef('AA1')).toEqual({ column: 26, row: 0 });
    expect(parseCellRef('BC12')).toEqual({ column: 54, row: 11 });
  });

  it('refuses something that is not a reference', () => {
    expect(parseCellRef('1A')).toBeNull();
    expect(parseCellRef('')).toBeNull();
  });
});

describe('parseSharedStrings', () => {
  it('reads plain strings', () => {
    const xml = '<sst><si><t>Хлеб</t></si><si><t>Молоко</t></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(['Хлеб', 'Молоко']);
  });

  it('joins a string split across formatting runs', () => {
    // Bold one word of a product name and Excel writes several runs. Taking
    // the first would read a third of the name.
    const xml = '<sst><si><r><t>Сыр </t></r><r><t>Российский</t></r></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(['Сыр Российский']);
  });

  it('decodes escaped characters', () => {
    const xml = '<sst><si><t>Сок &quot;Дар&quot; &amp; Co</t></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(['Сок "Дар" & Co']);
  });

  it('does not double-decode an escaped ampersand', () => {
    // "&amp;lt;" is the text "&lt;", not the character "<".
    const xml = '<sst><si><t>A &amp;lt; B</t></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(['A &lt; B']);
  });

  it('keeps an empty string as a position', () => {
    // The indexes are positional; dropping an empty one shifts every string
    // after it onto the wrong cell.
    const xml = '<sst><si><t>A</t></si><si/><si><t>C</t></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(['A', '', 'C']);
  });
});

describe('parseSheet', () => {
  it('places cells by their own reference, not by counting them', () => {
    // Excel omits empty cells entirely. A row with something in A and in D is
    // two cells, and counting them would move the fourth column into the
    // second.
    const xml = sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>Хлеб</t></is></c><c r="D1"><v>250</v></c></row>');
    expect(parseSheet(xml, [])).toEqual([['Хлеб', '', '', '250']]);
  });

  it('resolves a shared-string cell through the table', () => {
    const xml = sheet('<row r="1"><c r="A1" t="s"><v>1</v></c></row>');
    expect(parseSheet(xml, ['Молоко', 'Хлеб'])).toEqual([['Хлеб']]);
  });

  it('leaves a shared-string index that points nowhere empty, rather than crashing', () => {
    const xml = sheet('<row r="1"><c r="A1" t="s"><v>99</v></c></row>');
    expect(parseSheet(xml, ['Молоко'])).toEqual([['']]);
  });

  it('reads numbers as the text they were written as', () => {
    // The import parses numbers itself, and re-formatting them here would
    // change 1290.5 into something else on the way.
    const xml = sheet('<row r="1"><c r="A1"><v>1290.5</v></c></row>');
    expect(parseSheet(xml, [])).toEqual([['1290.5']]);
  });

  it('keeps a gap between rows', () => {
    // A blank row in the middle of a list is common, and collapsing it would
    // shift every row below by one — which matters when a person is comparing
    // the preview against their own file.
    const xml = sheet('<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c></row>');
    expect(parseSheet(xml, ['Первый', 'Третий'])).toEqual([['Первый'], [], ['Третий']]);
  });

  it('handles a self-closing empty cell', () => {
    const xml = sheet('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"/></row>');
    expect(parseSheet(xml, ['Хлеб'])).toEqual([['Хлеб', '']]);
  });
});

describe('reading a whole file', () => {
  const files = {
    'xl/sharedStrings.xml': '<sst><si><t>Название</t></si><si><t>Цена</t></si><si><t>Хлеб белый</t></si></sst>',
    'xl/worksheets/sheet1.xml': sheet(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>250</v></c></row>',
    ),
  };

  it('gets the grid out of a real zip', () => {
    const result = xlsxToGrid(buildXlsx(files));
    expect(result).toEqual({ status: 'ok', grid: [['Название', 'Цена'], ['Хлеб белый', '250']] });
  });

  it('reads an uncompressed entry too', () => {
    // Some tools store small files rather than deflating them.
    expect(xlsxToGrid(buildXlsx(files, { store: true }))).toMatchObject({ status: 'ok' });
  });

  it('ignores everything that is not a sheet or the string table', () => {
    // Styles, themes, anything a macro could hide in — never even decompressed.
    const withExtras = {
      ...files,
      'xl/styles.xml': '<styleSheet/>',
      'xl/vbaProject.bin': 'not xml at all',
      'docProps/app.xml': '<Properties/>',
    };
    expect(xlsxToGrid(buildXlsx(withExtras))).toMatchObject({ status: 'ok' });
  });

  it('takes the first sheet when there are several', () => {
    const twoSheets = {
      ...files,
      'xl/worksheets/sheet2.xml': sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>Заметки</t></is></c></row>'),
    };
    const result = xlsxToGrid(buildXlsx(twoSheets));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.grid[0][0]).toBe('Название');
  });

  it('orders sheets numerically, so sheet2 does not come before sheet10’s neighbour', () => {
    const many = {
      'xl/worksheets/sheet10.xml': sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>Десятый</t></is></c></row>'),
      'xl/worksheets/sheet2.xml': sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>Второй</t></is></c></row>'),
    };
    const result = xlsxToGrid(buildXlsx(many));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // sheet2 sorts before sheet10 when compared numerically; a plain string
    // sort would put sheet10 first.
    expect(result.grid[0][0]).toBe('Второй');
  });

  it('works without a shared string table', () => {
    const inlineOnly = {
      'xl/worksheets/sheet1.xml': sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>Хлеб</t></is></c></row>'),
    };
    expect(xlsxToGrid(buildXlsx(inlineOnly))).toEqual({ status: 'ok', grid: [['Хлеб']] });
  });

  it('says it is not a spreadsheet when handed something else', () => {
    expect(xlsxToGrid(Buffer.from('это обычный текст, а не таблица'))).toEqual({ status: 'notZip' });
  });

  it('says it is not a spreadsheet when handed an empty buffer', () => {
    expect(xlsxToGrid(Buffer.alloc(0))).toEqual({ status: 'notZip' });
  });

  it('says there is no data when the archive holds no sheet', () => {
    expect(xlsxToGrid(buildXlsx({ 'xl/styles.xml': '<styleSheet/>' }))).toEqual({ status: 'noSheet' });
  });

  it('refuses a file too large to be a price list before unzipping it', () => {
    // The guard is on the compressed size, so a zip bomb is refused before any
    // work is done on it.
    const huge = Buffer.alloc(MAX_XLSX_BYTES + 1);
    expect(xlsxToGrid(huge)).toEqual({ status: 'tooLarge' });
  });

  it('says something a person can act on for every failure', () => {
    expect(xlsxErrorMessage({ status: 'notZip' })).toContain('.xlsx');
    expect(xlsxErrorMessage({ status: 'noSheet' })).toContain('лист');
    expect(xlsxErrorMessage({ status: 'tooLarge' })).toContain('большой');
  });
});
