import { describe, expect, it } from 'vitest';
import {
  matchPriceList,
  readDeliveryNote,
  normaliseBarcode,
  readPriceList,
  summarisePriceList,
  type OurProduct,
} from './price-list';

const OURS: OurProduct[] = [
  { id: 'p1', name: 'Хлеб «Тандыр»', barcode: '4870001112223', purchasePrice: 180, unit: 'шт' },
  { id: 'p2', name: 'Молоко 2,5%', barcode: null, purchasePrice: 400, unit: 'шт' },
  { id: 'p3', name: 'Сахар 1 кг', barcode: '4870009998887', purchasePrice: 500, unit: 'шт' },
];

describe('чтение прайса', () => {
  it('читает название, штрихкод и цену', () => {
    const { rows } = readPriceList([
      ['Наименование', 'Штрихкод', 'Цена'],
      ['Хлеб «Тандыр»', '4870001112223', '190'],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line: 2, supplierName: 'Хлеб «Тандыр»', barcode: '4870001112223', supplierPrice: 190 });
  });

  it('понимает, как прайс называет свою цену', () => {
    // «Цена поставщика» и «оптовая цена» — то, чем эта колонка называется в
    // прайсе, и общий словарь импорта про них не знает.
    const { rows } = readPriceList([
      ['Товар', 'Цена поставщика'],
      ['Хлеб', '190'],
    ]);
    expect(rows[0].supplierPrice).toBe(190);
  });

  it('берёт минимальную партию, когда поставщик её указал', () => {
    const { rows } = readPriceList([
      ['Наименование', 'Цена', 'Минимальная партия'],
      ['Хлеб', '190', '12'],
    ]);
    expect(rows[0].minQuantity).toBe(12);
  });

  it('без цены говорит об этом, но строки всё равно читает', () => {
    // Прайс без цены бесполезен для сравнения и полезен для сопоставления:
    // видно хотя бы, что из присланного у нас есть.
    const { rows, problems } = readPriceList([
      ['Наименование', 'Штрихкод'],
      ['Хлеб', '4870001112223'],
    ]);
    expect(rows).toHaveLength(1);
    expect(problems.join(' ')).toContain('цено');
  });

  it('без названия читать нечего', () => {
    const { rows, problems } = readPriceList([['Цена'], ['190']]);
    expect(rows).toEqual([]);
    expect(problems[0]).toContain('названием');
  });

  it('пустые строки пропускает, а не считает товаром', () => {
    const { rows } = readPriceList([
      ['Наименование', 'Цена'],
      ['', '190'],
      ['Хлеб', '190'],
    ]);
    expect(rows).toHaveLength(1);
  });

  it('цену читает так же, как импорт: «1 200,50»', () => {
    const { rows } = readPriceList([['Наименование', 'Цена'], ['Мешок', '1 200,50']]);
    expect(rows[0].supplierPrice).toBe(1201);
  });

  it('отрицательную цену не берёт', () => {
    const { rows } = readPriceList([['Наименование', 'Цена'], ['Хлеб', '-5']]);
    expect(rows[0].supplierPrice).toBeNull();
  });
});

describe('штрихкод', () => {
  it('короткое за штрихкод не считается', () => {
    // «12» в колонке штрихкода — это чей-то артикул или номер строки, и
    // сопоставлять по нему значит привезти не то.
    expect(normaliseBarcode('12')).toBeNull();
    expect(normaliseBarcode('')).toBeNull();
    expect(normaliseBarcode('4870001112223')).toBe('4870001112223');
  });

  it('пробелы внутри не мешают', () => {
    expect(normaliseBarcode('487 000 111 2223')).toBe('4870001112223');
  });
});

describe('сопоставление с каталогом', () => {
  it('по штрихкоду — даже когда названия разные', () => {
    const [line] = matchPriceList(
      [{ line: 2, supplierName: 'ХЛЕБ ТАНДЫР 400Г', barcode: '4870001112223', supplierPrice: 190, minQuantity: null }],
      OURS,
    );
    expect(line.productId).toBe('p1');
    expect(line.matchedBy).toBe('barcode');
    expect(line.ourName).toBe('Хлеб «Тандыр»');
  });

  it('по названию, когда штрихкода нет', () => {
    const [line] = matchPriceList(
      [{ line: 2, supplierName: 'молоко 2,5%', barcode: null, supplierPrice: 420, minQuantity: null }],
      OURS,
    );
    expect(line.productId).toBe('p2');
    expect(line.matchedBy).toBe('name');
  });

  it('похожее название не сопоставляется', () => {
    // Здесь и живёт соблазн: «Молоко 2.5» почти то же самое. Почти —
    // это привезённое не то, и оно дороже, чем найти строку руками.
    const [line] = matchPriceList(
      [{ line: 2, supplierName: 'Молоко 2.5 процента', barcode: null, supplierPrice: 420, minQuantity: null }],
      OURS,
    );
    expect(line.productId).toBeNull();
    expect(line.matchedBy).toBe('none');
  });

  it('штрихкод сильнее названия', () => {
    const [line] = matchPriceList(
      [{ line: 2, supplierName: 'Сахар 1 кг', barcode: '4870001112223', supplierPrice: 190, minQuantity: null }],
      OURS,
    );
    // Название совпало бы с сахаром, штрихкод — с хлебом. Товар определяет
    // штрихкод.
    expect(line.productId).toBe('p1');
  });

  it('считает, на сколько поставщик поднял цену', () => {
    const [line] = matchPriceList(
      [{ line: 2, supplierName: 'Хлеб «Тандыр»', barcode: null, supplierPrice: 216, minQuantity: null }],
      OURS,
    );
    // 180 → 216 это ровно 20 %.
    expect(line.priceChangePercent).toBe(20);
  });

  it('и на сколько опустил', () => {
    const [line] = matchPriceList(
      [{ line: 2, supplierName: 'Сахар 1 кг', barcode: null, supplierPrice: 450, minQuantity: null }],
      OURS,
    );
    expect(line.priceChangePercent).toBe(-10);
  });

  it('не с чем сравнивать — не выдумывает ноль', () => {
    const [line] = matchPriceList(
      [{ line: 2, supplierName: 'Новинка', barcode: null, supplierPrice: 100, minQuantity: null }],
      OURS,
    );
    expect(line.priceChangePercent).toBeNull();
    expect(line.ourPurchasePrice).toBeNull();
  });
});

describe('итог по прайсу', () => {
  it('считает совпавшие, подорожавшие и подешевевшие', () => {
    const lines = matchPriceList(
      [
        { line: 2, supplierName: 'Хлеб «Тандыр»', barcode: null, supplierPrice: 216, minQuantity: null },
        { line: 3, supplierName: 'Сахар 1 кг', barcode: null, supplierPrice: 450, minQuantity: null },
        { line: 4, supplierName: 'Неизвестное', barcode: null, supplierPrice: 100, minQuantity: null },
      ],
      OURS,
    );
    const summary = summarisePriceList(lines);
    expect(summary).toMatchObject({ rows: 3, matched: 2, unmatched: 1, dearer: 1, cheaper: 1 });
  });

  it('называет самое заметное подорожание', () => {
    const lines = matchPriceList(
      [
        { line: 2, supplierName: 'Хлеб «Тандыр»', barcode: null, supplierPrice: 216, minQuantity: null },
        { line: 3, supplierName: 'Сахар 1 кг', barcode: null, supplierPrice: 750, minQuantity: null },
      ],
      OURS,
    );
    expect(summarisePriceList(lines).biggestRise).toEqual({ name: 'Сахар 1 кг', percent: 50 });
  });

  it('на прайсе без цен ничего не выдумывает', () => {
    const lines = matchPriceList(
      [{ line: 2, supplierName: 'Хлеб «Тандыр»', barcode: null, supplierPrice: null, minQuantity: null }],
      OURS,
    );
    const summary = summarisePriceList(lines);
    expect(summary.dearer).toBe(0);
    expect(summary.cheaper).toBe(0);
    expect(summary.biggestRise).toBeNull();
  });
});

describe('накладная поставщика', () => {
  it('читает количество и цену', () => {
    const { rows } = readDeliveryNote([
      ['Наименование', 'Штрихкод', 'Количество', 'Цена'],
      ['Вода 1 л', '4870001112223', '24', '120'],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ supplierName: 'Вода 1 л', quantity: 24, supplierPrice: 120 });
  });

  it('понимает «отгружено» и «кол-во»', () => {
    expect(readDeliveryNote([['Товар', 'Отгружено'], ['Вода', '12']]).rows[0].quantity).toBe(12);
    expect(readDeliveryNote([['Товар', 'Кол-во'], ['Вода', '7']]).rows[0].quantity).toBe(7);
  });

  it('строку без количества не выбрасывает', () => {
    // Молча пропущенная позиция — это недостача, которую заметят через неделю.
    const { rows } = readDeliveryNote([
      ['Наименование', 'Количество'],
      ['Вода 1 л', ''],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBeNull();
  });

  it('без колонки количества говорит, что вписывать придётся руками', () => {
    const { problems } = readDeliveryNote([['Наименование'], ['Вода 1 л']]);
    expect(problems.join(' ')).toContain('вручную');
  });

  it('без колонки цены предупреждает, чем она заменится', () => {
    const { problems } = readDeliveryNote([
      ['Наименование', 'Количество'],
      ['Вода 1 л', '10'],
    ]);
    expect(problems.join(' ')).toContain('последней закупочной');
  });

  it('дробное количество читается: товар бывает в килограммах', () => {
    expect(readDeliveryNote([['Товар', 'Количество'], ['Сыр', '2,5']]).rows[0].quantity).toBe(2.5);
  });

  it('отрицательное количество не берётся', () => {
    expect(readDeliveryNote([['Товар', 'Количество'], ['Сыр', '-3']]).rows[0].quantity).toBeNull();
  });

  it('сопоставляется с каталогом тем же способом, что и прайс', () => {
    const { rows } = readDeliveryNote([
      ['Наименование', 'Штрихкод', 'Количество', 'Цена'],
      ['ХЛЕБ ТАНДЫР 400Г', '4870001112223', '24', '190'],
    ]);
    const [line] = matchPriceList(rows, OURS);
    expect(line.productId).toBe('p1');
    expect(line.matchedBy).toBe('barcode');
  });

  it('пустой файл читать нечего', () => {
    expect(readDeliveryNote([[]]).rows).toEqual([]);
  });
});
