import { detectColumnsWith, parseNumber, type ImportField } from './import';

/**
 * Прайс поставщика — и что из него на самом деле нужно брать.
 *
 * Оптовик присылает таблицу: название, штрихкод, цена. Дальше в магазине
 * начинается работа, которую никто не любит: найти каждую позицию у себя,
 * вспомнить, почём брали в прошлый раз, прикинуть, сколько осталось, и
 * выписать заказ. На три тысячи позиций это вечер.
 *
 * Здесь эта работа делается один раз и на сервере. Файл читается тем же
 * словарём заголовков, что и импорт товаров, — прайс и выгрузка каталога это
 * одна и та же таблица, просто присланная с другой стороны. Позиции
 * сопоставляются с нашими по штрихкоду, а если его нет — по названию. Сколько
 * брать, считает тот же расчёт дефицита, что показывает экран пополнения:
 * второй способ прикинуть означал бы, что экран и заказ однажды разойдутся.
 *
 * Чего здесь нет намеренно: попыток угадать. Строка, которую не удалось
 * сопоставить, так и называется — «нет у нас», а не подставляется по
 * похожести. Ошибочно сопоставленный товар в заказе поставщику — это
 * привезённое не то, и стоит дороже, чем ручной поиск одной строки.
 */

export interface PriceListRow {
  /** Номер строки в файле, который человек видит на экране. */
  line: number;
  supplierName: string;
  barcode: string | null;
  /** Цена поставщика, в целых тенге. null — прочитать не удалось. */
  supplierPrice: number | null;
  /** Сколько поставщик просит взять минимум, если сказал. */
  minQuantity: number | null;
}

export interface OurProduct {
  id: string;
  name: string;
  barcode: string | null;
  /** Наша последняя закупочная цена — то, с чем сравнивают присланную. */
  purchasePrice: number;
  unit: string;
}

export type MatchKind = 'barcode' | 'name' | 'none';

export interface MatchedLine extends PriceListRow {
  productId: string | null;
  ourName: string | null;
  ourUnit: string | null;
  ourPurchasePrice: number | null;
  matchedBy: MatchKind;
  /**
   * На сколько процентов цена поставщика отличается от нашей последней
   * закупочной. Положительное — подорожало. null, когда сравнивать не с чем.
   */
  priceChangePercent: number | null;
}

/** Как прайс поставщика называет свои колонки — поверх общего словаря импорта. */
const PRICE_LIST_ALIASES: Partial<Record<ImportField, string[]>> = {
  salePrice: ['ценапоставщика', 'ценапрайс', 'оптоваяцена', 'ценаопт', 'прайс'],
  quantity: ['минимальнаяпартия', 'минпартия', 'кратность', 'минзаказ'],
};

export function normaliseBarcode(raw: string): string | null {
  const digits = raw.replace(/\s/g, '');
  return digits.length >= 6 ? digits : null;
}

/**
 * Читает прайс в строки.
 *
 * Колонка цены ищется как «цена продажи» общего словаря: с точки зрения
 * поставщика это и есть его цена продажи. Отдельного поля под «минимальную
 * партию» в словаре импорта нет, поэтому она приезжает в поле количества —
 * место занято тем же смыслом «сколько штук».
 */
export function readPriceList(grid: string[][]): { rows: PriceListRow[]; problems: string[] } {
  const problems: string[] = [];
  const nonEmpty = grid.filter((row) => row.some((cell) => (cell ?? '').trim() !== ''));
  if (nonEmpty.length < 2) {
    return { rows: [], problems: ['В файле нет ни одной строки с товаром'] };
  }

  const [header, ...body] = nonEmpty;
  const columns = detectColumnsWith(header, PRICE_LIST_ALIASES);

  if (columns.name === undefined) {
    return { rows: [], problems: ['Не найден столбец с названием товара'] };
  }
  if (columns.salePrice === undefined) {
    problems.push('Не найден столбец с ценой — сравнить с вашей закупкой не получится');
  }

  const rows: PriceListRow[] = [];
  body.forEach((raw, index) => {
    const cell = (field: ImportField): string => {
      const at = columns[field];
      return at === undefined ? '' : (raw[at] ?? '').trim();
    };

    const supplierName = cell('name');
    if (!supplierName) return;

    const price = parseNumber(cell('salePrice'));
    const minQuantity = parseNumber(cell('quantity'));

    rows.push({
      line: index + 2,
      supplierName,
      barcode: normaliseBarcode(cell('barcode')),
      supplierPrice: price === null || price < 0 ? null : Math.round(price),
      minQuantity: minQuantity !== null && minQuantity > 0 ? minQuantity : null,
    });
  });

  return { rows, problems };
}

/**
 * Сопоставляет прайс с нашим каталогом.
 *
 * Сначала по штрихкоду — он определяет товар. Название это то, что кто-то
 * когда-то набрал, и один и тот же сыр у поставщика и у нас записан по-разному
 * чаще, чем одинаково. Поэтому по названию сопоставляем только точное
 * совпадение без учёта регистра: «похоже» здесь означает «привезли не то».
 */
export function matchPriceList(rows: PriceListRow[], ours: OurProduct[]): MatchedLine[] {
  const byBarcode = new Map<string, OurProduct>();
  for (const product of ours) {
    const barcode = product.barcode ? normaliseBarcode(product.barcode) : null;
    if (barcode && !byBarcode.has(barcode)) byBarcode.set(barcode, product);
  }
  const byName = new Map<string, OurProduct>();
  for (const product of ours) {
    const key = product.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, product);
  }

  return rows.map((row) => {
    const byCode = row.barcode ? byBarcode.get(row.barcode) : undefined;
    const matched = byCode ?? byName.get(row.supplierName.trim().toLowerCase());
    const matchedBy: MatchKind = byCode ? 'barcode' : matched ? 'name' : 'none';

    const ourPrice = matched?.purchasePrice ?? null;
    const change =
      ourPrice !== null && ourPrice > 0 && row.supplierPrice !== null
        ? Math.round(((row.supplierPrice - ourPrice) / ourPrice) * 100)
        : null;

    return {
      ...row,
      productId: matched?.id ?? null,
      ourName: matched?.name ?? null,
      ourUnit: matched?.unit ?? null,
      ourPurchasePrice: ourPrice,
      matchedBy,
      priceChangePercent: change,
    };
  });
}

export interface PriceListSummary {
  rows: number;
  matched: number;
  unmatched: number;
  /** Сколько позиций поставщик поднял в цене против нашей закупки. */
  dearer: number;
  /** И сколько опустил — их обычно не замечают. */
  cheaper: number;
  /** Самое заметное подорожание, чтобы не искать глазами. */
  biggestRise: { name: string; percent: number } | null;
}

export function summarisePriceList(lines: MatchedLine[]): PriceListSummary {
  let dearer = 0;
  let cheaper = 0;
  let biggestRise: { name: string; percent: number } | null = null;

  for (const line of lines) {
    if (line.priceChangePercent === null) continue;
    if (line.priceChangePercent > 0) {
      dearer += 1;
      if (!biggestRise || line.priceChangePercent > biggestRise.percent) {
        biggestRise = { name: line.ourName ?? line.supplierName, percent: line.priceChangePercent };
      }
    } else if (line.priceChangePercent < 0) {
      cheaper += 1;
    }
  }

  const matched = lines.filter((line) => line.productId !== null).length;
  return {
    rows: lines.length,
    matched,
    unmatched: lines.length - matched,
    dearer,
    cheaper,
    biggestRise,
  };
}

// --- накладная поставщика ----------------------------------------------------

export interface DeliveryRow extends PriceListRow {
  /** Сколько привезли. null — количество прочитать не удалось. */
  quantity: number | null;
}

/**
 * Как накладная называет колонку с количеством.
 *
 * У прайса на этом месте кратность отгрузки, у накладной — сколько штук
 * приехало. Слово одно, смысл разный, поэтому и словарь разный.
 */
const DELIVERY_ALIASES: Partial<Record<ImportField, string[]>> = {
  salePrice: ['ценапоставщика', 'ценабезндс', 'ценазаединицу', 'цена'],
  quantity: ['количество', 'колво', 'кол', 'отгружено', 'привезено', 'quantity', 'qty'],
};

/**
 * Читает накладную поставщика.
 *
 * Смысл ровно один: приёмка сегодня — это сорок минут ручного ввода, и это
 * самая ненавидимая операция в магазине. Распознавание фотографии бумажной
 * накладной требует внешней службы; а накладная, присланная файлом — а её
 * присылают файлом чаще, чем кажется, — читается тем же разбором, что и
 * каталог, и печатать не нужно ничего.
 *
 * Строка без количества не выбрасывается: пусть кладовщик увидит её и впишет
 * число сам. Молча пропущенная позиция — это недостача, которую заметят через
 * неделю.
 */
export function readDeliveryNote(grid: string[][]): { rows: DeliveryRow[]; problems: string[] } {
  const problems: string[] = [];
  const nonEmpty = grid.filter((row) => row.some((cell) => (cell ?? '').trim() !== ''));
  if (nonEmpty.length < 2) {
    return { rows: [], problems: ['В файле нет ни одной строки с товаром'] };
  }

  const [header, ...body] = nonEmpty;
  const columns = detectColumnsWith(header, DELIVERY_ALIASES);

  if (columns.name === undefined) {
    return { rows: [], problems: ['Не найден столбец с названием товара'] };
  }
  if (columns.quantity === undefined) {
    problems.push('Не найден столбец с количеством — впишите его вручную по каждой строке');
  }
  if (columns.salePrice === undefined) {
    problems.push('Не найден столбец с ценой — приёмка встанет по вашей последней закупочной');
  }

  const rows: DeliveryRow[] = [];
  body.forEach((raw, index) => {
    const cell = (field: ImportField): string => {
      const at = columns[field];
      return at === undefined ? '' : (raw[at] ?? '').trim();
    };

    const supplierName = cell('name');
    if (!supplierName) return;

    const price = parseNumber(cell('salePrice'));
    const quantity = parseNumber(cell('quantity'));

    rows.push({
      line: index + 2,
      supplierName,
      barcode: normaliseBarcode(cell('barcode')),
      supplierPrice: price === null || price < 0 ? null : Math.round(price),
      minQuantity: null,
      quantity: quantity === null || quantity < 0 ? null : quantity,
    });
  });

  return { rows, problems };
}
