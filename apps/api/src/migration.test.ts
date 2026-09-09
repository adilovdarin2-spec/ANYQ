import { describe, expect, it } from 'vitest';
import {
  SOURCE_SYSTEMS,
  analyseCatalogue,
  detectColumnsFor,
  findSourceSystem,
} from './migration';
import { normaliseHeader } from './import';

const wipon = findSourceSystem('wipon')!;
const moysklad = findSourceSystem('moysklad')!;

describe('справочник программ', () => {
  it('псевдонимы записаны в том виде, в каком заголовки сравниваются', () => {
    // Заголовок из файла приводится normaliseHeader к нижнему регистру без
    // пробелов и знаков. Псевдоним с пробелом или заглавной буквой не совпадёт
    // никогда — и никто этого не заметит, потому что импорт просто молча не
    // найдёт колонку и свалится на общий словарь.
    const bad: string[] = [];
    for (const system of SOURCE_SYSTEMS) {
      for (const aliases of Object.values(system.aliases)) {
        for (const alias of aliases) {
          if (normaliseHeader(alias) !== alias) bad.push(`${system.id}: ${alias}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('в списке нет двух программ с одним id', () => {
    const ids = SOURCE_SYSTEMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('у каждой программы есть шаги и название', () => {
    for (const system of SOURCE_SYSTEMS) {
      expect(system.name.length).toBeGreaterThan(0);
      expect(system.steps.length).toBeGreaterThan(0);
    }
    // Проверен на живой выгрузке пока только собственный вариант «Excel или
    // другая». Если однажды кто-то поставит stepsVerified: true, не открыв
    // чужую программу, этот счётчик заставит объясниться.
    expect(SOURCE_SYSTEMS.filter((s) => s.stepsVerified).map((s) => s.id)).toEqual(['other']);
  });

  it('неизвестный id — это null, а не падение', () => {
    expect(findSourceSystem('нет такой')).toBeNull();
    expect(findSourceSystem(undefined)).toBeNull();
    expect(findSourceSystem(42)).toBeNull();
  });
});

describe('колонки с учётом программы', () => {
  it('словарь программы выигрывает у общего', () => {
    // «Цена» общий словарь считает ценой продажи. В выгрузке Wipon цена
    // продажи называется «Цена реализации», а «Цена» — это что-то другое,
    // и подставить её было бы хуже, чем не найти ничего.
    const map = detectColumnsFor(['Наименование', 'Цена', 'Цена реализации'], wipon);
    expect(map.salePrice).toBe(2);
  });

  it('общий словарь добирает то, чего нет у программы', () => {
    const map = detectColumnsFor(['Наименование', 'Штрихкод', 'Количество'], moysklad);
    expect(map.name).toBe(0);
    expect(map.barcode).toBe(1);
    expect(map.quantity).toBe(2);
  });

  it('без программы работает как обычный импорт', () => {
    const map = detectColumnsFor(['Товар', 'Цена'], null);
    expect(map.name).toBe(0);
    expect(map.salePrice).toBe(1);
  });

  it('одна колонка не достаётся двум полям', () => {
    const map = detectColumnsFor(['Наименование полное', 'Цена продажи основная'], moysklad);
    const used = Object.values(map);
    expect(new Set(used).size).toBe(used.length);
  });
});

const HEADER = ['Наименование', 'Штрихкод', 'Категория', 'Закуп', 'Цена', 'Остаток'];

describe('разбор каталога', () => {
  it('считает, сколько денег лежит на полках', () => {
    const analysis = analyseCatalogue([
      HEADER,
      ['Хлеб', '111', 'Хлеб', '180', '280', '40'],
      ['Молоко', '222', 'Молочное', '400', '480', '10'],
    ]);
    // 180×40 + 400×10 = 11 200
    expect(analysis.stockValue).toBe(11200);
    // 280×40 + 480×10 = 16 000
    expect(analysis.retailValue).toBe(16000);
    expect(analysis.products).toBe(2);
  });

  it('находит товары, которые продаются в минус, и показывает их', () => {
    const analysis = analyseCatalogue([
      HEADER,
      ['Сахар', '111', 'Бакалея', '500', '450', '5'],
      ['Мука', '222', 'Бакалея', '300', '290', '5'],
      ['Хлеб', '333', 'Хлеб', '180', '280', '5'],
    ]);
    expect(analysis.atLoss?.count).toBe(2);
    expect(analysis.atLoss?.examples.map((e) => e.name)).toEqual(['Сахар', 'Мука']);
  });

  it('продажа ровно в ноль считается отдельно от убытка', () => {
    const analysis = analyseCatalogue([
      HEADER,
      ['Пакет', '111', 'Прочее', '30', '30', '100'],
      ['Сахар', '222', 'Бакалея', '500', '450', '5'],
    ]);
    expect(analysis.atZero).toBe(1);
    expect(analysis.atLoss?.count).toBe(1);
  });

  it('дубль по названию и штрихкоду сразу — это один дубль, а не два', () => {
    const analysis = analyseCatalogue([
      HEADER,
      ['Кофе 250 г', '111', 'Кофе', '900', '1500', '4'],
      ['Кофе 250 г', '111', 'Кофе', '900', '1500', '2'],
    ]);
    expect(analysis.duplicates.count).toBe(1);
    expect(analysis.duplicates.examples).toHaveLength(1);
    expect(analysis.duplicates.examples[0].lines).toEqual([2, 3]);
  });

  it('три строки одного товара — это два лишних', () => {
    const analysis = analyseCatalogue([
      HEADER,
      ['Чай', '', 'Чай', '300', '600', '1'],
      ['чай', '', 'Чай', '300', '600', '1'],
      ['ЧАЙ', '', 'Чай', '300', '600', '1'],
    ]);
    expect(analysis.duplicates.count).toBe(2);
  });

  it('считает товары без штрихкода', () => {
    const analysis = analyseCatalogue([
      HEADER,
      ['Хлеб', '', 'Хлеб', '180', '280', '10'],
      ['Молоко', '222', 'Молочное', '400', '480', '10'],
      ['Булка', '', 'Хлеб', '90', '150', '10'],
    ]);
    expect(analysis.noBarcode).toBe(2);
  });

  it('без колонки закупки не выдумывает ноль, а говорит почему', () => {
    const analysis = analyseCatalogue([
      ['Наименование', 'Цена', 'Остаток'],
      ['Хлеб', '280', '40'],
    ]);
    expect(analysis.stockValue).toBeNull();
    expect(analysis.atLoss).toBeNull();
    expect(analysis.markup).toBeNull();
    expect(analysis.notes.some((n) => n.includes('закупочной цены'))).toBe(true);
  });

  it('без колонки остатков не считает деньги на полках', () => {
    const analysis = analyseCatalogue([
      ['Наименование', 'Закуп', 'Цена'],
      ['Хлеб', '180', '280'],
    ]);
    expect(analysis.stockValue).toBeNull();
    expect(analysis.notes.some((n) => n.includes('остатков'))).toBe(true);
    // Наценку при этом посчитать можно — она не зависит от количества.
    expect(analysis.markup?.median).toBe(56);
  });

  it('всегда предупреждает, что залежавшийся товар по файлу не виден', () => {
    const analysis = analyseCatalogue([HEADER, ['Хлеб', '111', 'Хлеб', '180', '280', '40']]);
    expect(analysis.notes.some((n) => n.includes('Даты продаж'))).toBe(true);
  });

  it('наценка: медиана, край и разрез по категориям', () => {
    const analysis = analyseCatalogue([
      HEADER,
      ['Хлеб', '1', 'Хлеб', '100', '110', '1'],   // 10 %
      ['Булка', '2', 'Хлеб', '100', '120', '1'],  // 20 %
      ['Батон', '3', 'Хлеб', '100', '130', '1'],  // 30 %
      ['Кофе', '4', 'Кофе', '100', '200', '1'],   // 100 %
    ]);
    expect(analysis.markup?.min).toBe(10);
    expect(analysis.markup?.max).toBe(100);
    expect(analysis.markup?.median).toBe(25);
    // У «Кофе» одна позиция — это не разброс наценки, а совпадение.
    expect(analysis.markup?.byCategory.map((c) => c.category)).toEqual(['Хлеб']);
    expect(analysis.markup?.byCategory[0].medianMarkup).toBe(20);
    expect(analysis.markup?.byCategory[0].items).toBe(3);
  });

  it('пустой файл не считается и говорит об этом', () => {
    const analysis = analyseCatalogue([[], ['', '']]);
    expect(analysis.products).toBe(0);
    expect(analysis.notes).toEqual(['В файле нет ни одной строки с товаром']);
  });

  it('строки без названия не попадают в счёт товаров', () => {
    const analysis = analyseCatalogue([
      HEADER,
      ['Хлеб', '111', 'Хлеб', '180', '280', '40'],
      ['', '222', 'Хлеб', '180', '280', '40'],
    ]);
    expect(analysis.products).toBe(1);
  });

  it('читает цены и количества так же, как импорт: «1 200,50»', () => {
    const analysis = analyseCatalogue([
      HEADER,
      ['Мешок муки', '111', 'Бакалея', '1 200,50', '1 500', '2'],
    ]);
    expect(analysis.stockValue).toBe(2401);
  });

  it('словарь программы применяется и в разборе', () => {
    const analysis = analyseCatalogue(
      [
        ['Наименование', 'Цена закупа', 'Цена реализации', 'Остаток'],
        ['Хлеб', '180', '280', '40'],
      ],
      wipon,
    );
    expect(analysis.stockValue).toBe(7200);
    expect(analysis.markup?.median).toBe(56);
  });
});
