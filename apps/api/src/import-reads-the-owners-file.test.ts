import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { xlsxToGrid, sheetsInTabOrder } from './xlsx';
import { buildImportPlan, detectColumns, findHeaderRow, looksLikeTotalRow, tidyName } from './import';

/**
 * Файл владельца читается таким, каким он его пришлёт.
 *
 * «Их файл каталога окажется кривым» — первая строка в списке рисков запуска, и
 * день загрузки каталога это день запуска. Прогон выдуманной, но совершенно
 * обычной выгрузки из 1С нашёл четыре места, на каждом из которых каталог не
 * загружался вовсе или загружался неправильно.
 *
 * Найдено 01.10.2026 прогоном импорта грязным файлом.
 */

/** Минимальный .xlsx: zip из перечисленных частей. */
function buildXlsx(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);

    const entry = Buffer.alloc(46 + nameBytes.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    nameBytes.copy(entry, 46);

    locals.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }

  const body = Buffer.concat(locals);
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, end]);
}

function sheet(rows: string[][]): string {
  const cells = rows
    .map((row, r) => {
      const inner = row
        .map((value, c) => {
          const ref = String.fromCharCode(65 + c) + (r + 1);
          return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${inner}</row>`;
    })
    .join('');
  return `<worksheet><sheetData>${cells}</sheetData></worksheet>`;
}

const WORKBOOK = (sheets: { name: string; rid: string; state?: string }[]) =>
  `<workbook><sheets>${sheets
    .map((s) => `<sheet name="${s.name}" sheetId="1"${s.state ? ` state="${s.state}"` : ''} r:id="${s.rid}"/>`)
    .join('')}</sheets></workbook>`;

const RELS = (map: Record<string, string>) =>
  `<Relationships>${Object.entries(map)
    .map(([id, target]) => `<Relationship Id="${id}" Target="${target}"/>`)
    .join('')}</Relationships>`;

describe('какой лист книги читаем', () => {
  it('первый по ярлыкам, а не первый по имени части', () => {
    /* Перетащить лист мышью в начало книги меняет порядок ярлыков и не меняет
       имён частей внутри архива. Типичный файл магазина: пустой «Лист1» от
       шаблона остался частью sheet1.xml, а каталог лежит в sheet2.xml. */
    const file = buildXlsx({
      'xl/workbook.xml': WORKBOOK([
        { name: 'Прайс', rid: 'rId2' },
        { name: 'Лист1', rid: 'rId1' },
      ]),
      'xl/_rels/workbook.xml.rels': RELS({
        rId1: 'worksheets/sheet1.xml',
        rId2: 'worksheets/sheet2.xml',
      }),
      'xl/worksheets/sheet1.xml': sheet([['Отчёт выгружен 01.10.2026']]),
      'xl/worksheets/sheet2.xml': sheet([['Наименование', 'Цена'], ['Хлеб', '250']]),
    });

    const result = xlsxToGrid(file);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.grid[0][0]).toBe('Наименование');
    // И сказано, что прочитали, — иначе разбор на ноль строк ничем не объясним.
    expect(result.sheet).toBe('Прайс');
    expect(result.otherSheets).toEqual(['Лист1']);
  });

  it('скрытые листы пропускаются — их не видит и Excel', () => {
    const file = buildXlsx({
      'xl/workbook.xml': WORKBOOK([
        { name: 'Служебный', rid: 'rId1', state: 'hidden' },
        { name: 'Товары', rid: 'rId2' },
      ]),
      'xl/_rels/workbook.xml.rels': RELS({
        rId1: 'worksheets/sheet1.xml',
        rId2: 'worksheets/sheet2.xml',
      }),
      'xl/worksheets/sheet1.xml': sheet([['служебные расчёты']]),
      'xl/worksheets/sheet2.xml': sheet([['Наименование', 'Цена']]),
    });

    const result = xlsxToGrid(file);
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.sheet).toBe('Товары');
    expect(result.grid[0][0]).toBe('Наименование');
  });

  it('а без книги и связок — по-прежнему по имени части', () => {
    // Самодельные выгрузки пишут и такое; для однолистовой книги это верно.
    const file = buildXlsx({
      'xl/worksheets/sheet1.xml': sheet([['Наименование', 'Цена']]),
    });
    const result = xlsxToGrid(file);
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.grid[0][0]).toBe('Наименование');
    expect(result.sheet).toBe('');
  });

  it('`sheetId` не принимается за ссылку на часть', () => {
    /* `sheetId="1"` кончается на `Id` ровно как `r:id`, и без двоеточия в
       образце лист связался бы с чужой частью. */
    const sheets = sheetsInTabOrder(
      '<workbook><sheets><sheet name="Прайс" sheetId="7" r:id="rId3"/></sheets></workbook>',
      RELS({ rId3: 'worksheets/sheet9.xml', rId7: 'worksheets/sheetWRONG.xml' }),
    );
    expect(sheets).toEqual([{ name: 'Прайс', part: 'xl/worksheets/sheet9.xml' }]);
  });
});

describe('где в файле шапка таблицы', () => {
  const header = ['Наименование', 'Штрих-код', 'Цена продажи'];

  it('находится под названием отчёта и пустой строкой', () => {
    const rows = [['Остатки товаров на 01.10.2026'], [''], header, ['Хлеб', '4870000000001', '250']];
    expect(findHeaderRow(rows)).toBe(2);
  });

  it('а когда она первая — остаётся первой', () => {
    expect(findHeaderRow([header, ['Хлеб', '4870000000001', '250']])).toBe(0);
  });

  it('берётся та строка, где узналось больше столбцов', () => {
    /* Выше шапки встречается строка с одним знакомым словом — «Наименование
       поставщика: ТОО „Береке“». Шапка — та, где столбцов больше. */
    const rows = [['Наименование поставщика: ТОО «Береке»'], header];
    expect(findHeaderRow(rows)).toBe(1);
  });

  it('а когда названия товара нет нигде — остаётся первая, чтобы отказ говорил про неё', () => {
    expect(findHeaderRow([['Дата', 'Сумма'], ['01.10.2026', '1000']])).toBe(0);
  });

  it('и глубже десятой строки не ищется — там уже товары', () => {
    const deep = [...Array.from({ length: 12 }, () => ['что-то']), header];
    expect(findHeaderRow(deep)).toBe(0);
  });
});

describe('план импорта по обычной выгрузке', () => {
  const grid = [
    ['Остатки товаров на 01.10.2026', '', '', '', ''],
    ['', '', '', '', ''],
    ['Наименование', 'Штрих-код', 'Ед. изм.', 'Цена закупки', 'Цена продажи'],
    ['Хлеб «Алматинский»', '4870000000001', 'шт', '180', '250'],
    ['Масло   подсолнечное 1 л', '4870000000018', 'шт', '890', '1 190'],
    ['Итого', '', '', '1 070', '1 440'],
  ];

  const plan = buildImportPlan(grid, []);

  it('шапка найдена, и об этом сказано', () => {
    expect(plan.rows).toHaveLength(2);
    expect(plan.problems.some((p) => p.message.includes('Шапка таблицы найдена в строке 3'))).toBe(true);
  });

  it('номер строки — тот, что владелец увидит слева в Excel', () => {
    /* Считался порядковый номер среди непустых строк. Пустая строка в середине
       выгрузки — обычное дело, и человека отправляли чинить не ту строку. */
    expect(plan.rows.map((row) => row.line)).toEqual([4, 5]);
  });

  it('закупочная цена прочитана — иначе наценка стопроцентная', () => {
    /* «Цена закупки» начинается со слова «цена» и ни одним прежним синонимом не
       ловилась: весь каталог заезжал с себестоимостью ноль, и первый же отчёт
       о прибыли был выдумкой. */
    expect(plan.rows.map((row) => row.purchasePrice)).toEqual([180, 890]);
    expect(plan.rows.map((row) => row.salePrice)).toEqual([250, 1190]);
  });

  it('итог отчёта не становится товаром', () => {
    expect(plan.rows.some((row) => row.name === 'Итого')).toBe(false);
    expect(plan.problems.some((p) => p.message.includes('итог отчёта'))).toBe(true);
  });

  it('двойные пробелы в названии схлопнуты', () => {
    // Иначе повторная загрузка того же файла заводит товар второй раз.
    expect(plan.rows[1].name).toBe('Масло подсолнечное 1 л');
  });
});

describe('заголовки столбцов', () => {
  it('«Цена закупки» и «Цена продажи» различаются', () => {
    const columns = detectColumns(['Наименование', 'Цена закупки', 'Цена продажи']);
    expect(columns.purchasePrice).toBe(1);
    expect(columns.salePrice).toBe(2);
  });

  it('и в обратном порядке — тоже', () => {
    const columns = detectColumns(['Наименование', 'Цена продажи', 'Цена закупки']);
    expect(columns.salePrice).toBe(1);
    expect(columns.purchasePrice).toBe(2);
  });

  it('родня по смыслу ловится по слову внутри заголовка', () => {
    const columns = detectColumns(['Товар', 'Цена поступления с НДС', 'Цена реализации']);
    expect(columns.purchasePrice).toBe(1);
    expect(columns.salePrice).toBe(2);
  });

  it('и когда слово стоит не в начале — тоже', () => {
    /* Здесь ни один синоним не начало заголовка: помогает только поиск по
       вхождению, и включён он ровно ради таких заголовков. */
    const columns = detectColumns(['Товар', 'Последняя закупочная, ₸', 'Отпускная для розницы']);
    expect(columns.purchasePrice).toBe(1);
    expect(columns.salePrice).toBe(2);
  });

  it('а «Наименование поставщика» названием товара не крадётся через это правило', () => {
    /* Поиск по вхождению включён только для двух цен: для остального он слишком
       жаден. Здесь «Наименование поставщика» достаётся названию по прежнему
       правилу «начинается с», и это ровно то, что было и раньше. */
    const columns = detectColumns(['Наименование поставщика', 'Цена']);
    expect(columns.name).toBe(0);
  });
});

describe('мелочи, из которых состоит чужой файл', () => {
  it('итоговую строку узнаём в её обычных написаниях', () => {
    for (const name of ['Итого', 'ИТОГО:', 'итого', 'Всего', 'Сумма', 'Барлығы', 'TOTAL']) {
      expect(looksLikeTotalRow(name), name).toBe(true);
    }
  });

  it('и не принимаем за неё товар, который просто так называется', () => {
    for (const name of ['Итоговый набор посуды', 'Всего понемногу', 'Сумка хозяйственная']) {
      expect(looksLikeTotalRow(name), name).toBe(false);
    }
  });

  it('пробелы в названии приводятся к одному, включая неразрывный', () => {
    expect(tidyName('  Масло   подсолнечное  1 л ')).toBe('Масло подсолнечное 1 л');
    expect(tidyName('Вода  «Тассай»')).toBe('Вода «Тассай»');
    expect(tidyName('Хлеб')).toBe('Хлеб');
  });
});
