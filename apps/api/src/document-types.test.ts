import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * У каждого документа, который пишет сервер, есть русское название.
 *
 * Тип документа хранится английским кодом, а на экран идёт слово из карты
 * `DOCUMENT_TYPE_LABELS`; чего в карте нет, показывается как есть. Так в
 * истории документов и появилось `reconciliation` — единственное английское
 * слово на русском экране, поставленное туда починкой сверки, которая сама по
 * себе работает правильно.
 *
 * Проверка читает исходники маршрутов: список, переписанный сюда руками,
 * отстанет ровно так же, как отстала карта. Ей достаточно грубого разбора —
 * все строковые литералы `type: '...'` в маршрутах, — потому что ошибка первого
 * рода тут дешёвая: лишний код попадёт в список исключений вместе с причиной,
 * а не молча выпадет из проверки.
 */

const ROUTES = resolve(__dirname, 'routes');

/**
 * Коды, которые пишутся в поле `type`, но документами не являются.
 *
 * Каждый назван, а не подобран правилом: правило — это место, где спрячется
 * следующая ошибка.
 */
const NOT_A_DOCUMENT = new Set([
  // Тип токена кабинета владельца.
  'cabinet',
  // Тип контрагента: поставщик или покупатель.
  'supplier',
  'customer',
  // Тип точки: магазин или склад.
  'shop',
  'warehouse',
  // Способ оплаты в строке платежа.
  'cash',
  'kaspi',
  'card',
  'credit',
  'mixed',
  // Вид товара в выгрузке номенклатуры.
  'piece',
  'weight',
]);

function typesWrittenByRoutes(): string[] {
  const found = new Set<string>();
  for (const entry of readdirSync(ROUTES)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    const source = readFileSync(join(ROUTES, entry), 'utf8');
    for (const match of source.matchAll(/\btype: '([a-z_]+)'/g)) found.add(match[1]);
  }
  return [...found].filter((type) => !NOT_A_DOCUMENT.has(type)).sort();
}

function labelledTypes(): string[] {
  const source = readFileSync(resolve(__dirname, 'routes/pos.ts'), 'utf8');
  const block = /const DOCUMENT_TYPE_LABELS: Record<string, string> = \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
  return [...block.matchAll(/^\s*'?([a-z_]+)'?:/gm)].map((m) => m[1]);
}

describe('названия документов', () => {
  it('разбор находит и типы, и карту', () => {
    // Страховка на саму проверку: переименуют карту или перепишут маршруты —
    // тест начнёт проходить, ничего не проверяя.
    expect(typesWrittenByRoutes().length).toBeGreaterThan(8);
    expect(labelledTypes().length).toBeGreaterThan(8);
  });

  it('каждый тип, который пишет сервер, назван по-русски', () => {
    const labelled = new Set(labelledTypes());
    for (const type of typesWrittenByRoutes()) {
      expect(labelled.has(type), `нет русского названия для ${type}`).toBe(true);
    }
  });

  it('в карте нет названий для того, чего сервер не пишет', () => {
    // Лишняя строка — это мёртвое название и подозрение, что где-то есть код,
    // который его ждёт.
    const written = new Set(typesWrittenByRoutes());
    for (const type of labelledTypes()) {
      expect(written.has(type), `сервер не пишет документов типа ${type}`).toBe(true);
    }
  });
});
