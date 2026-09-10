import { detectColumnsWith, parseNumber, type ColumnMap, type ImportField } from './import';

/**
 * Переезд из чужой программы, и разбор того, что приехало.
 *
 * Импорт уже умел читать таблицу и говорить, что в ней не так. Здесь два
 * недостающих куска, из-за которых он не продаёт:
 *
 *   1. **Кто прислал файл.** Владелец не сопоставляет колонки — он выбирает
 *      свою программу, а словарь её заголовков лежит здесь. Сопоставление
 *      колонок руками — то место, на котором люди бросают импорт везде.
 *   2. **Что в этом файле видно про его магазин.** Те же разобранные строки,
 *      посчитанные пятью формулами: сколько денег лежит, что продаётся в
 *      минус, где дубли. Это и есть демонстрация — на его товарах, а не на
 *      выдуманном магазине.
 *
 * Разбор считает **только по тому, что есть в файле**, и про каждую цифру,
 * которую посчитать не удалось, говорит вслух почему (`notes`). Весь смысл
 * приёма в том, что цифры настоящие; одна выдуманная — и он не стоит ничего.
 */

export interface SourceSystem {
  id: string;
  name: string;
  /** Одной строкой: что это за программа, чтобы владелец узнал свою. */
  note: string;
  /** Где у неё лежит выгрузка. См. `stepsVerified`. */
  steps: string[];
  /**
   * Проверены ли шаги на живой выгрузке из этой программы.
   *
   * Везде false, и это правда: меню чужих программ никто из нас не открывал.
   * Показывать выдуманный путь по чужому интерфейсу хуже, чем не показывать
   * никакого — владелец пойдёт искать пункт, которого нет, и решит, что
   * вся система такая же. Пока не проверено, экран говорит «если меню
   * отличается — пришлите любой файл, разберём», и это работает: словарь
   * заголовков ниже от точности пути не зависит.
   */
  stepsVerified: boolean;
  /** Как эта программа называет колонки — поверх общего словаря импорта. */
  aliases: Partial<Record<ImportField, string[]>>;
}

/**
 * Программы, из которых к нам переезжают.
 *
 * Список растёт по мере прихода клиентов, а не заранее: первый магазин на
 * Wipon и оплатит поддержку Wipon. Псевдонимы колонок — самая ценная часть
 * записи, и они не выдуманы: это варианты написания, которые встречаются в
 * русско- и казахоязычных выгрузках вообще, просто собранные по программам.
 */
export const SOURCE_SYSTEMS: SourceSystem[] = [
  {
    id: 'rekassa',
    name: 'Rekassa',
    note: 'Онлайн-касса на телефоне',
    steps: ['Откройте раздел с товарами', 'Найдите экспорт или выгрузку', 'Сохраните файл Excel или CSV'],
    stepsVerified: false,
    aliases: {
      name: ['наименованиетовара', 'товарнаименование'],
      salePrice: ['ценазаединицу', 'ценатенге'],
      quantity: ['остатокнаскладе'],
    },
  },
  {
    id: 'wipon',
    name: 'Wipon',
    note: 'Касса и учёт для розницы',
    steps: ['Откройте раздел с товарами', 'Найдите экспорт или выгрузку', 'Сохраните файл Excel'],
    stepsVerified: false,
    aliases: {
      name: ['номенклатуратовара'],
      barcode: ['штрихкоды', 'штрихкодшк'],
      purchasePrice: ['ценазакупа', 'закупцена'],
      salePrice: ['ценареализации'],
    },
  },
  {
    id: 'kaspi',
    name: 'Kaspi',
    note: 'Магазин и приём оплаты',
    steps: ['Откройте кабинет продавца', 'Раздел с товарами', 'Скачайте файл товаров'],
    stepsVerified: false,
    aliases: {
      name: ['названиетовара'],
      barcode: ['sku', 'артикул'],
      salePrice: ['ценаkzt', 'цeна'],
      quantity: ['вналичии', 'доступно'],
    },
  },
  {
    id: 'moysklad',
    name: 'МойСклад',
    note: 'Складской учёт и торговля',
    steps: ['Товары и склады → Товары', 'Нажмите «Экспорт»', 'Формат Excel'],
    stepsVerified: false,
    aliases: {
      name: ['наименованиеполное'],
      barcode: ['штрихкодытовара'],
      category: ['группатоваров', 'папка'],
      purchasePrice: ['закупочнаяценаруб', 'ценазакупки'],
      salePrice: ['ценапродажиосновная', 'основнаяцена'],
      quantity: ['остатоквсего', 'доступно'],
      unit: ['единицаизм'],
    },
  },
  {
    id: '1c',
    name: '1С',
    note: 'Торговля, Управление торговлей, Розница',
    steps: ['Справочник «Номенклатура»', 'Ещё → Вывести список', 'Сохранить как Excel'],
    stepsVerified: false,
    aliases: {
      name: ['номенклатураполноенаименование', 'наименованиеполное'],
      category: ['номенклатурнаягруппа', 'видноменклатуры'],
      unit: ['базоваяединица', 'единицахранения'],
      purchasePrice: ['ценапоступления'],
      salePrice: ['ценарозничная', 'ценаопт'],
      quantity: ['конечныйостаток', 'остатокконец'],
    },
  },
  {
    id: 'poster',
    name: 'Poster',
    note: 'Касса для торговых точек',
    steps: ['Раздел «Меню» или «Склад»', 'Нажмите «Экспорт»', 'Файл Excel или CSV'],
    stepsVerified: false,
    aliases: {
      name: ['названиепозиции'],
      category: ['категорияпозиции'],
      purchasePrice: ['себестоимостьпозиции'],
      salePrice: ['ценапозиции'],
    },
  },
  {
    id: 'multikas',
    name: 'Мультикас',
    note: 'Товароучёт и кассы',
    steps: ['Раздел с товарами', 'Выгрузка или экспорт', 'Файл Excel'],
    stepsVerified: false,
    aliases: {
      barcode: ['штрихкодосновной'],
      purchasePrice: ['ценаприхода'],
      salePrice: ['ценапродажная'],
    },
  },
  {
    id: 'other',
    name: 'Excel или другая',
    note: 'Любая таблица с товарами',
    steps: [
      'Откройте свою таблицу товаров',
      'Проверьте, что в первой строке стоят заголовки колонок',
      'Сохраните как .xlsx или скопируйте прямо из Excel',
    ],
    // Единственная запись, где шаги проверены: это наши собственные шаги.
    stepsVerified: true,
    aliases: {},
  },
];

export function findSourceSystem(id: unknown): SourceSystem | null {
  if (typeof id !== 'string') return null;
  return SOURCE_SYSTEMS.find((s) => s.id === id) ?? null;
}

/**
 * Колонки с учётом того, из какой программы файл.
 *
 * Псевдонимы программы идут первым проходом и потому выигрывают: «Цена
 * реализации» в выгрузке Wipon — это цена продажи, даже если в том же файле
 * есть колонка «Цена» от чего-то другого.
 */
export function detectColumnsFor(header: string[], system: SourceSystem | null): ColumnMap {
  return detectColumnsWith(header, system?.aliases ?? {});
}

export interface LossExample {
  name: string;
  purchasePrice: number;
  salePrice: number;
}

export interface DuplicateExample {
  name: string;
  lines: number[];
}

export interface CategoryMargin {
  category: string;
  /** Медианная наценка в процентах от закупочной цены. */
  medianMarkup: number;
  items: number;
}

export interface CatalogueAnalysis {
  /** Строк с товарами — без заголовка и без пустых. */
  products: number;
  /** Какие поля удалось найти в шапке. */
  found: ImportField[];

  /** Закупочная стоимость остатков. null — нет закупочной цены или количества. */
  stockValue: number | null;
  /** Та же полка в ценах продажи. */
  retailValue: number | null;

  /** Товары, где цена продажи не выше закупочной. */
  atLoss: { count: number; examples: LossExample[] } | null;
  /** Из них ровно в ноль — не убыток, но и не заработок. */
  atZero: number | null;

  duplicates: { count: number; examples: DuplicateExample[] };
  noBarcode: number;
  noPurchasePrice: number;

  markup: { median: number; min: number; max: number; byCategory: CategoryMargin[] } | null;

  /** Что посчитать не удалось и почему. Показывается владельцу как есть. */
  notes: string[];
}

const MAX_EXAMPLES = 5;
/** Меньше трёх товаров в категории — это не разброс наценки, а совпадение. */
const MIN_CATEGORY_ITEMS = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Разбор каталога по файлу выгрузки.
 *
 * Считает по сырой сетке, а не по плану импорта: план осознанно выбрасывает
 * дубли и битые строки, а разбор именно про них и должен рассказать.
 */
export function analyseCatalogue(grid: string[][], system: SourceSystem | null = null): CatalogueAnalysis {
  const notes: string[] = [];
  const nonEmpty = grid.filter((row) => row.some((cell) => (cell ?? '').trim() !== ''));

  if (nonEmpty.length < 2) {
    return {
      products: 0,
      found: [],
      stockValue: null,
      retailValue: null,
      atLoss: null,
      atZero: null,
      duplicates: { count: 0, examples: [] },
      noBarcode: 0,
      noPurchasePrice: 0,
      markup: null,
      notes: ['В файле нет ни одной строки с товаром'],
    };
  }

  const [header, ...body] = nonEmpty;
  const columns = detectColumnsFor(header, system);
  const found = (Object.keys(columns) as ImportField[]).filter((f) => columns[f] !== undefined);

  const hasPurchase = columns.purchasePrice !== undefined;
  const hasQuantity = columns.quantity !== undefined;
  const hasBarcode = columns.barcode !== undefined;
  const hasCategory = columns.category !== undefined;

  let products = 0;
  let stockValue = 0;
  let retailValue = 0;
  let noBarcode = 0;
  let noPurchasePrice = 0;
  let atZero = 0;

  const lossExamples: LossExample[] = [];
  // Товары, а не строки. Дубль в файле — это один товар, заведённый дважды, и
  // считать его двумя убыточными значит завысить ту самую цифру, которую мы
  // показываем владельцу как находку. Одна выдуманная цифра — и разбор не
  // стоит ничего.
  const atLoss = new Set<string>();
  const atZeroKeys = new Set<string>();
  const markups: number[] = [];
  const byCategory = new Map<string, number[]>();
  const nameLines = new Map<string, { name: string; lines: number[] }>();
  const barcodeLines = new Map<string, { name: string; lines: number[] }>();

  body.forEach((raw, index) => {
    const line = index + 2;
    const cell = (field: ImportField): string => {
      const at = columns[field];
      return at === undefined ? '' : (raw[at] ?? '').trim();
    };

    const name = cell('name');
    if (!name) return;
    products += 1;

    const sale = parseNumber(cell('salePrice'));
    const purchaseRaw = cell('purchasePrice');
    const purchase = parseNumber(purchaseRaw);
    const quantity = parseNumber(cell('quantity'));

    if (hasPurchase && (purchase === null || purchase <= 0)) noPurchasePrice += 1;

    if (purchase !== null && purchase > 0 && quantity !== null && quantity > 0) {
      stockValue += purchase * quantity;
      if (sale !== null && sale > 0) retailValue += sale * quantity;
    }

    if (purchase !== null && purchase > 0 && sale !== null && sale >= 0) {
      // Тот же ключ, что и у поиска дублей: штрихкод определяет товар, а имя —
      // это то, что кто-то набрал.
      const identity = cell('barcode') || name.toLowerCase();
      if (sale < purchase) {
        if (!atLoss.has(identity)) {
          atLoss.add(identity);
          if (lossExamples.length < MAX_EXAMPLES) {
            lossExamples.push({ name, purchasePrice: Math.round(purchase), salePrice: Math.round(sale) });
          }
        }
      } else if (sale === purchase) {
        if (!atZeroKeys.has(identity)) {
          atZeroKeys.add(identity);
          atZero += 1;
        }
      } else {
        const markup = ((sale - purchase) / purchase) * 100;
        markups.push(markup);
        if (hasCategory) {
          const category = cell('category') || 'Без категории';
          const list = byCategory.get(category) ?? [];
          list.push(markup);
          byCategory.set(category, list);
        }
      }
    }

    const barcode = cell('barcode');
    if (hasBarcode && !barcode) noBarcode += 1;
    if (barcode) {
      const seen = barcodeLines.get(barcode) ?? { name, lines: [] };
      seen.lines.push(line);
      barcodeLines.set(barcode, seen);
    }

    const key = name.toLowerCase();
    const seenName = nameLines.get(key) ?? { name, lines: [] };
    seenName.lines.push(line);
    nameLines.set(key, seenName);
  });

  // Дубль — одна и та же карточка заведена дважды. Считаем и по названию, и по
  // штрихкоду, но один товар в ответе показываем один раз: строки, попавшие в
  // обе корзины, — это тот же самый дубль, а не два разных.
  const duplicateExamples: DuplicateExample[] = [];
  const countedLines = new Set<number>();
  let duplicateCount = 0;

  for (const source of [barcodeLines, nameLines]) {
    for (const entry of source.values()) {
      if (entry.lines.length < 2) continue;
      if (entry.lines.every((l) => countedLines.has(l))) continue;
      entry.lines.forEach((l) => countedLines.add(l));
      duplicateCount += entry.lines.length - 1;
      if (duplicateExamples.length < MAX_EXAMPLES) {
        duplicateExamples.push({ name: entry.name, lines: entry.lines.slice(0, 6) });
      }
    }
  }

  if (!hasPurchase) notes.push('В файле нет закупочной цены — не посчитать ни деньги на полках, ни наценку');
  if (!hasQuantity) notes.push('В файле нет остатков — не посчитать, сколько денег лежит в товаре');
  if (!hasBarcode) notes.push('В файле нет штрихкодов — сверяли только по названиям');
  if (!hasCategory) notes.push('В файле нет категорий — разброс наценки по категориям не считали');
  // Про залежавшийся товар молчим намеренно: в выгрузке нет дат продаж, и это
  // видно только со второй недели работы. Обещать это по файлу нельзя.
  notes.push('Даты продаж в выгрузку не входят — залежавшийся товар будет виден со второй недели работы');

  const categoryMargins: CategoryMargin[] = [...byCategory.entries()]
    .filter(([, list]) => list.length >= MIN_CATEGORY_ITEMS)
    .map(([category, list]) => ({ category, medianMarkup: Math.round(median(list)), items: list.length }))
    .sort((a, b) => a.medianMarkup - b.medianMarkup);

  return {
    products,
    found,
    stockValue: hasPurchase && hasQuantity ? Math.round(stockValue) : null,
    retailValue: hasPurchase && hasQuantity && retailValue > 0 ? Math.round(retailValue) : null,
    atLoss: hasPurchase ? { count: atLoss.size, examples: lossExamples } : null,
    atZero: hasPurchase ? atZero : null,
    duplicates: { count: duplicateCount, examples: duplicateExamples },
    noBarcode: hasBarcode ? noBarcode : 0,
    noPurchasePrice: hasPurchase ? noPurchasePrice : 0,
    markup:
      markups.length > 0
        ? {
            median: Math.round(median(markups)),
            min: Math.round(Math.min(...markups)),
            max: Math.round(Math.max(...markups)),
            byCategory: categoryMargins,
          }
        : null,
    notes,
  };
}
