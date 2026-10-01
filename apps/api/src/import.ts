import { normaliseBarcode, barcodeProblemMessage, articleFromGtin, sameArticle } from './barcode';

export type ImportField =
  | 'name'
  | 'barcode'
  | 'category'
  | 'unit'
  | 'purchasePrice'
  | 'salePrice'
  | 'quantity'
  /** Сколько штук в коробке. Без этого столбца упаковки у строки нет вовсе. */
  | 'unitsPerPack'
  /** Как эту коробку называют: «Блок», «Ящик». Есть не всегда. */
  | 'packName'
  /** Свой штрихкод коробки — тот, который сканируют на приёмке. */
  | 'packBarcode'
  /** Тот же артикул, записанный четырнадцатью знаками: так его пишет 1С. */
  | 'gtin';

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
  /* Упаковочные столбцы стоят раньше своих однокоренных, и это не вкусовщина.

     Заголовки разбираются в три прохода, и третий берёт поле, чей синоним
     оказался *началом* заголовка. «Штрихкод коробки» начинается со «штрихкод»,
     «Упаковка, шт» — с «упаковка», и в порядке по умолчанию штрихкод коробки
     достался бы штрихкоду товара: касса искала бы единицу по коду короба и не
     находила ни того, ни другого.

     Поэтому конкретное объявлено раньше общего. Обратной опасности нет: простое
     «Штрихкод» не начинается со «штрихкодупаковки». */
  packBarcode: [
    'штрихкодупаковки', 'штрихкодкороба', 'штрихкодкоробки', 'штрихкодблока', 'штрихкодящика',
    'шкупаковки', 'шккороба', 'шкблока', 'packbarcode', 'casebarcode', 'қаптамаштрихкоды',
  ],
  unitsPerPack: [
    'вупаковке', 'количествовупаковке', 'колвовупаковке', 'единицвупаковке', 'штвупаковке',
    'вкоробке', 'вблоке', 'вящике', 'кратность', 'фасовка', 'упаковкашт', 'ёмкостьупаковки',
    'unitsperpack', 'packsize', 'packqty', 'қаптамада',
  ],
  packName: ['упаковка', 'тара', 'видупаковки', 'типупаковки', 'қаптама', 'packaging', 'package'],
  gtin: ['gtin', 'gtin13', 'gtin14', 'кодgtin', 'глобальныйкодтовара', 'глобальныйномер'],
  barcode: ['штрихкод', 'штрихкодтовара', 'ean', 'ean13', 'barcode', 'бар', 'шк'],
  category: ['категория', 'группа', 'раздел', 'санат', 'category', 'group'],
  unit: ['ед', 'едизм', 'единица', 'единицаизмерения', 'бірлік', 'unit', 'uom'],
  purchasePrice: [
    'закуп', 'закупка', 'закупочная', 'закупочнаяцена', 'себестоимость', 'приход',
    // «Цена закупки» начинается с «цена» и потому не ловилась ни одним прежним синонимом.
    'ценазакупки', 'ценазакупа', 'ценапокупки', 'ценаприхода', 'ценапоступления', 'входящаяцена',
    'сатыпалубағасы', 'purchase', 'cost',
  ],
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

  /* И последний проход — по слову внутри заголовка, и только для двух цен.

     Две цены — единственная пара столбцов, чьи заголовки начинаются одинаково и
     различаются тем, что стоит дальше: «Цена закупки» и «Цена продажи». Проход по
     началу их не различает, и закупочная просто терялась — весь каталог заезжал с
     себестоимостью ноль, и первый же отчёт показывал стопроцентную наценку.

     Только для цен: для остального поиск по вхождению слишком жаден — «Наименование
     поставщика» стало бы названием товара. */
  const PRICE_MARKERS: Partial<Record<ImportField, string[]>> = {
    purchasePrice: ['закуп', 'себестоим', 'приход', 'поступлен', 'покупк'],
    salePrice: ['продаж', 'розниц', 'реализац'],
  };
  header.forEach((cell, index) => {
    const key = normaliseHeader(cell ?? '');
    if (!key || Object.values(map).includes(index)) return;
    for (const [field, markers] of Object.entries(PRICE_MARKERS) as [ImportField, string[]][]) {
      if (map[field] !== undefined) continue;
      if (markers.some((marker) => key.includes(marker))) {
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
  /**
   * Коробка, в которой этот товар приходит от поставщика.
   *
   * `null` — упаковки у строки нет, и это обычное дело: половина каталога
   * штучная. Заводится она только тогда, когда в файле есть, сколько штук
   * внутри: без этого числа «коробка» — просто слово, по которому нельзя ни
   * принять, ни пересчитать.
   */
  packaging: ImportPackaging | null;
  /** Set when this row updates a product that already exists. */
  existingProductId: string | null;
}

export interface ImportPackaging {
  name: string;
  unitsPerPack: number;
  /** Свой штрихкод коробки, если он в файле есть. */
  barcode: string | null;
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

/**
 * Итоговая строка — не товар.
 *
 * Почти каждая выгрузка кончается «Итого» с суммами по столбцам. Без этой
 * проверки в каталог заводился товар «Итого» ценой 5 625 ₸ и остатком 1 246 штук —
 * он вставал в сетку кассы и в начальные остатки, то есть сразу в деньги.
 *
 * Список закрыт и сравнивается целиком, а не по вхождению: товаров, названных ровно
 * «Итого», не бывает, а вот «Итоговый набор посуды» вполне бывает.
 */
const TOTAL_ROW_NAMES = new Set([
  'итого', 'итог', 'всего', 'сумма', 'общийитог', 'итогопоотчёту',
  'барлығы', 'жиыны', 'сомасы',
  'total', 'grandtotal', 'sum', 'subtotal',
]);

export function looksLikeTotalRow(name: string): boolean {
  return TOTAL_ROW_NAMES.has(
    name.toLowerCase().replace(/ё/g, 'е').replace(/[\s.:,_\-]/g, ''),
  );
}

/**
 * Название товара без лишних пробелов внутри.
 *
 * «Масло   подсолнечное 1 л» и «Масло подсолнечное 1 л» — один товар, а совпадение
 * со старым каталогом ищется по названию. Двойной пробел, случайно стоящий в
 * файле, делает повторную загрузку уже исправленного файла вторым товаром с тем
 * же штрихкодом — а повторная загрузка в день запуска случается постоянно.
 *
 * Неразрывный пробел тоже пробел: Excel ставит его сам.
 */
export function tidyName(raw: string): string {
  return raw.replace(/[\s\u00a0]+/g, ' ').trim();
}

/**
 * Сколько первых строк смотрим в поисках заголовка.
 *
 * Выше шапки не бывает много: название отчёта, дата, организация, пустая строка.
 * Большая глубина начала бы искать заголовок среди товаров.
 */
const HEADER_SEARCH_DEPTH = 10;

/**
 * Какая строка — шапка таблицы.
 *
 * Бралась первая непустая, и для вставленной из Excel таблицы это верно. А
 * выгрузка почти всегда начинается с шапки отчёта: «Остатки товаров на 01.10.2026»,
 * пустая строка, и только потом «Наименование | Штрих-код | Цена». Импорт читал
 * заголовком название отчёта, не находил ни одного столбца и отвечал «Назовите
 * столбец „Наименование“» — совет переименовать столбец, который так и назван. Весь
 * каталог при этом не загружался вовсе, а день загрузки каталога — это день запуска.
 *
 * Шапка — строка, в которой узналось больше всего столбцов и есть название
 * товара; при равенстве — верхняя. Если ни в одной названия нет, возвращается первая:
 * тогда отказ говорит про неё, как и раньше.
 */
export function findHeaderRow(
  rows: string[][],
  extraAliases: Partial<Record<ImportField, string[]>> = {},
): number {
  let best = 0;
  let bestScore = 0;
  const depth = Math.min(rows.length, HEADER_SEARCH_DEPTH);
  for (let index = 0; index < depth; index += 1) {
    const columns = detectColumnsWith(rows[index], extraAliases);
    if (columns.name === undefined) continue;
    const score = Object.keys(columns).length;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }
  return best;
}

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

  /* Номер строки несётся рядом с самой строкой — тот, что владелец увидит слева в
     Excel. Считать его по порядку среди непустых значит отправить человека чинить
     строку 7, в которой стоит совсем другой товар: пустые строки внутри выгрузки
     встречаются ровно там, где кончается раздел. */
  const nonEmpty = grid
    .map((cells, index) => ({ cells, line: index + 1 }))
    .filter((row) => row.cells.some((cell) => (cell ?? '').trim() !== ''));
  if (nonEmpty.length === 0) {
    return { rows: [], problems: [{ line: 0, severity: 'error', message: 'Файл пуст' }], created: 0, updated: 0, skipped: 0 };
  }

  const headerAt = findHeaderRow(nonEmpty.map((row) => row.cells), extraAliases);
  const header = nonEmpty[headerAt].cells;
  const body = nonEmpty.slice(headerAt + 1);
  const columns = detectColumnsWith(header, extraAliases);

  if (headerAt > 0) {
    // Сказано вслух: «взяли не ту строку за шапку» — тоже способ потерять товары.
    problems.push({
      line: nonEmpty[headerAt].line,
      severity: 'warning',
      message: `Шапка таблицы найдена в строке ${nonEmpty[headerAt].line} — всё, что выше, пропущено`,
    });
  }

  if (columns.name === undefined) {
    problems.push({
      // Строка файла, а не единица: человек пойдёт смотреть именно туда.
      line: nonEmpty[headerAt].line,
      severity: 'error',
      message: 'Не найден столбец с названием товара. Назовите его «Наименование» и повторите.',
    });
    return { rows: [], problems, created: 0, updated: 0, skipped: nonEmpty.length - 1 };
  }
  if (columns.salePrice === undefined) {
    problems.push({
      line: nonEmpty[headerAt].line,
      severity: 'error',
      message: 'Не найден столбец с ценой продажи. Назовите его «Цена» и повторите.',
    });
    return { rows: [], problems, created: 0, updated: 0, skipped: nonEmpty.length - 1 };
  }

  const byBarcode = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));
  const seenBarcodes = new Map<string, number>();
  const seenNames = new Map<string, number>();
  /* Штрихкоды коробок живут в том же пространстве, что и штрихкоды штук:
     сканер один, и он не знает, короб перед ним или пачка. Два товара с одним
     кодом короба — это приёмка, которая кладёт на полку не тот товар. */
  const seenPackBarcodes = new Map<string, number>();

  let skipped = 0;

  body.forEach(({ cells: raw, line }) => {
    const cell = (field: ImportField): string => {
      const at = columns[field];
      return at === undefined ? '' : (raw[at] ?? '').trim();
    };

    const name = tidyName(cell('name'));
    if (!name) {
      problems.push({ line, severity: 'error', message: 'Нет названия — строка пропущена' });
      skipped += 1;
      return;
    }
    if (looksLikeTotalRow(name)) {
      // Не ошибка файла, а его обычный конец, — но сказать надо: иначе разбор
      // на одну строку меньше, чем видно в файле, выглядит потерей.
      problems.push({ line, severity: 'warning', message: `Строка «${name}» — это итог отчёта, а не товар; пропущена` });
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

    /* Штрихкод из чужого файла разбирается, а не берётся как есть.

       До 25.09.2026 он попадал в каталог дословно: `4.87012E+12`, `'4870…`,
       `4870 1234 56789` — и ни одного замечания. Кассир сканировал пачку, касса
       отвечала «не найден», и объяснить это было нечем.

       Строку при этом не отбрасываем даже при негодном коде: товар настоящий, и
       найти его по названию можно. Потерять из-за штрихкода весь товар хуже, чем
       завести его без штрихкода и сказать об этом. */
    const barcodeRaw = cell('barcode');
    const reading = normaliseBarcode(barcodeRaw);
    let barcode = reading.barcode;
    if (reading.problem) {
      problems.push({
        line,
        // Экспонента — потеря данных, о которой человек обязан узнать и
        // которую исправит только он. Несходящаяся контрольная цифра — повод
        // проверить пачку, а не переделывать файл.
        severity: reading.problem === 'excel-notation' ? 'error' : 'warning',
        message: barcodeProblemMessage(reading.problem, name, barcodeRaw),
      });
    }

    /* GTIN — тот же артикул, записанный четырнадцатью знаками.

       1С и системы маркировки выгружают именно его, и в файле он бывает вместо
       штрихкода, а не рядом с ним. Пропустив такой столбец, мы завели бы
       каталог совсем без кодов: сигареты — а это заметная часть выручки
       продуктового — не искались бы ни одним сканером.

       Записывается он в том виде, в каком напечатан на пачке: обычный поиск
       сравнивает строки точно, и четырнадцать знаков в каталоге означали бы
       товар, который находит сканер маркировки и не находит обычный. */
    const gtinRaw = cell('gtin');
    const gtinReading = normaliseBarcode(gtinRaw);
    const gtinArticle = gtinReading.barcode ? articleFromGtin(gtinReading.barcode) : null;
    if (gtinReading.problem && !barcode) {
      // Про испорченный GTIN говорим, только если заменить его нечем: иначе это
      // замечание про столбец, которым всё равно не пользуются.
      problems.push({
        line,
        severity: gtinReading.problem === 'excel-notation' ? 'error' : 'warning',
        message: barcodeProblemMessage(gtinReading.problem, name, gtinRaw),
      });
    }
    if (!barcode && gtinArticle) barcode = gtinArticle;
    else if (barcode && gtinArticle && !sameArticle(barcode, gtinArticle)) {
      /* Два разных числа в одной строке — это не опечатка в записи, а
         несогласие: одно из них про другой товар. Выбираем штрихкод, потому что
         именно его печатают на ценнике и им пользуются каждый день, и говорим —
         решить, какое верное, может только магазин. */
      problems.push({
        line,
        severity: 'warning',
        message: `«${name}»: штрихкод ${barcode} и GTIN ${gtinArticle} — это разные товары. Взят штрихкод; проверьте, какой из них про этот.`,
      });
    }

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

    const packaging = readPackaging({
      line,
      name,
      unitsRaw: cell('unitsPerPack'),
      packNameRaw: cell('packName'),
      packBarcodeRaw: cell('packBarcode'),
      unitBarcode: barcode,
      seenPackBarcodes,
      problems,
    });

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
      packaging,
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

/** Как назвать коробку, если в файле её никак не назвали. */
const DEFAULT_PACK_NAME = 'Упаковка';

interface PackagingInput {
  line: number;
  name: string;
  unitsRaw: string;
  packNameRaw: string;
  packBarcodeRaw: string;
  /** Штрихкод самой штуки: коробка не может носить тот же код. */
  unitBarcode: string | null;
  seenPackBarcodes: Map<string, number>;
  problems: ImportProblem[];
}

/**
 * Коробка из строки файла — или `null`, если её там нет.
 *
 * Упаковки заводили по одной руками, и для каталога в три тысячи позиций это
 * означало, что их не заводят вовсе. Половина товара приходит коробками, и без
 * них приёмка считается в штуках: кладовщик принимает двадцать коробок и
 * вбивает двести сорок штук, каждый раз умножая в уме.
 *
 * Ни одна ошибка здесь не отбрасывает строку. Товар настоящий и нужен в
 * каталоге; коробку к нему можно завести и потом, руками, — а вот потерять
 * товар из-за числа в соседнем столбце нельзя.
 */
export function readPackaging(input: PackagingInput): ImportPackaging | null {
  const { line, name, unitsRaw, problems } = input;
  const packName = input.packNameRaw.trim();

  if (!unitsRaw.trim()) {
    /* Название коробки без числа — не коробка. Принять его значило бы завести
       упаковку, которой не в чем измерить: приёмка по ней посчитала бы ноль. */
    if (packName) {
      problems.push({
        line,
        severity: 'warning',
        message: `«${name}»: упаковка «${packName}» без количества штук в ней — не заведена. Добавьте столбец «В упаковке».`,
      });
    }
    return null;
  }

  const units = parseNumber(unitsRaw);
  if (units === null || !Number.isFinite(units) || units <= 0) {
    problems.push({
      line,
      severity: 'warning',
      message: `«${name}»: в упаковке указано «${unitsRaw.trim()}» — это не количество, упаковка не заведена.`,
    });
    return null;
  }

  const packBarcodeRaw = input.packBarcodeRaw;
  const reading = normaliseBarcode(packBarcodeRaw);
  if (reading.problem) {
    problems.push({
      line,
      severity: reading.problem === 'excel-notation' ? 'error' : 'warning',
      message: barcodeProblemMessage(reading.problem, name, packBarcodeRaw, 'pack'),
    });
  }
  let packBarcode = reading.barcode;

  /* Коробка с кодом штуки — это одна и та же строка, прочитанная дважды.
     Оставив её, мы получили бы сканирование, которое иногда значит штуку, а
     иногда двенадцать, и разобраться по остатку было бы невозможно. */
  if (packBarcode && packBarcode === input.unitBarcode) {
    problems.push({
      line,
      severity: 'warning',
      message: `«${name}»: штрихкод упаковки совпадает со штрихкодом штуки — у упаковки он убран, сканер иначе не отличит коробку от пачки.`,
    });
    packBarcode = null;
  }

  if (packBarcode) {
    const seenAt = input.seenPackBarcodes.get(packBarcode);
    if (seenAt !== undefined) {
      problems.push({
        line,
        severity: 'warning',
        message: `«${name}»: штрихкод упаковки ${packBarcode} уже был в строке ${seenAt} — у этой упаковки он убран.`,
      });
      packBarcode = null;
    } else {
      input.seenPackBarcodes.set(packBarcode, line);
    }
  }

  /* Коробка из одной штуки не считает ничего — кроме случая, когда у неё свой
     штрихкод: тогда это второй код той же штуки, и сканировать его надо. */
  if (units === 1 && !packBarcode) {
    problems.push({
      line,
      severity: 'warning',
      message: `«${name}»: в упаковке одна штука и своего штрихкода у неё нет — такая упаковка ничего не даёт, не заведена.`,
    });
    return null;
  }

  return {
    name: packName || DEFAULT_PACK_NAME,
    unitsPerPack: units,
    barcode: packBarcode,
  };
}
