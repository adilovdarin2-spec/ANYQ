import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_KK, hasServerTranslation, translateServerMessage } from './server';

const REPO_ROOT = resolve(__dirname, '../../../..');
const CYRILLIC = /[А-яЁё]/;

/**
 * The API modules a register can provoke.
 *
 * Not just the route files. The first version of this guard read only the
 * `error:` lines written inline at a route, and missed every refusal composed
 * in a pure module and handed to the route to send — which is most of the
 * interesting ones, because that is where the judgement lives. A live register
 * found the gap before this test did. It now reads whole modules and asks about
 * every Russian string in them.
 *
 * Left out: the admin panel and the supplier portal, which nobody reads at a
 * till, and the integration harness, which is fixtures.
 */
const SKIPPED = [
  'routes/companies.ts',
  'routes/auth.ts',
  'routes/supply.ts',
  // The owner's cabinet, which is not a register either. It lives in the
  // storefront app, which has no language switch, so its refusals are read in
  // Russian by design — and a Kazakh translation nobody can reach would be a
  // dictionary entry pretending to be a feature.
  'routes/cabinet.ts',
  'cabinet.ts',
  // The owner's morning summary. Its text is never rendered by a register: the
  // server composes it and the phone's operating system displays it as a push
  // notification, so the register's dictionary cannot reach it even in
  // principle. Saying it in Kazakh needs the server to know the owner's own
  // language, which it does not — the same limitation server.ts describes for
  // every other message, except that here there is no Russian fallback on a
  // screen to soften it. Written down in docs/PRODUCT_PLAN.md rather than
  // pretended away.
  'daily-summary.ts',
];

function apiModules(): string[] {
  const found: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry).split('\\').join('/');
      if (statSync(path).isDirectory()) {
        if (entry !== 'integration') walk(path);
      } else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
        found.push(path);
      }
    }
  })(resolve(REPO_ROOT, 'apps/api/src').split('\\').join('/'));
  return found.filter((path) => !SKIPPED.some((skip) => path.endsWith(skip)));
}

/**
 * Russian text the server holds, whether or not it is a message.
 *
 * A template's slots are filled with something plausible so the patterns in
 * `server.ts` are exercised the way a real response would exercise them.
 */
function russianStrings(): string[] {
  const found = new Set<string>();
  for (const path of apiModules()) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/'([^'\n]*)'/g)) {
      if (CYRILLIC.test(match[1])) found.add(match[1]);
    }
    for (const match of source.matchAll(/`([^`\n]*)`/g)) {
      if (CYRILLIC.test(match[1])) found.add(match[1].replace(/\$\{[^}]*\}/g, '7'));
    }
  }
  return [...found].sort();
}

/**
 * Russian the server holds that is not a sentence said to a cashier.
 *
 * Everything here is named rather than matched by a rule, because the rule
 * would be the place the next mistake hides. Three kinds:
 *
 *  - **Column headers a spreadsheet is matched against.** The importer reads
 *    whatever the shop's own file calls things. This is input, not output, and
 *    translating it would stop the importer recognising Russian files. Kazakh
 *    synonyms already sit beside the Russian ones.
 *  - **Columns and cells of the CSV export.** The export is a file that lands
 *    in Excel or 1C, where somebody's formulas already refer to these columns
 *    by name. It is generated on the server, so the register could not
 *    retranslate it anyway.
 *  - **Labels the register renders itself.** Document types, write-off reasons,
 *    picking stages and audit field names arrive with a code beside them, and
 *    the register says them in its own dictionary. Translating the server's
 *    copy would be translating a string nobody displays.
 */
const NOT_A_MESSAGE = new Set<string>([
  // Column names the importer matches a spreadsheet against, normalised.
  'атауы', 'аты', 'бар', 'бағасы', 'бірлік', 'группа', 'е', 'ед', 'едизм', 'единица',
  'единицаизмерения', 'закуп', 'закупка', 'закупочная', 'закупочнаяцена', 'запас',
  'категория', 'колво', 'количество', 'название', 'наименование', 'номенклатура',
  'остатки', 'остаток', 'приход', 'продажа', 'раздел', 'розница', 'розничнаяцена',
  'санат', 'саны', 'себестоимость', 'товар', 'цена', 'ценапродажи', 'шк', 'шт',
  'штрихкод', 'штрихкодтовара',
  // The same, added per source program: how each one names its columns. Never
  // shown to anybody — a spreadsheet is matched against them.
  'артикул', 'базоваяединица', 'видноменклатуры', 'вналичии', 'группатоваров',
  'доступно', 'единицаизм', 'единицахранения', 'закупочнаяценаруб', 'закупцена',
  'категорияпозиции', 'конечныйостаток', 'названиепозиции', 'названиетовара',
  'наименованиеполное', 'наименованиетовара', 'номенклатураполноенаименование',
  'номенклатуратовара', 'номенклатурнаягруппа', 'основнаяцена', 'остатоквсего',
  'остатокконец', 'остатокнаскладе', 'папка', 'себестоимостьпозиции',
  'товарнаименование', 'цeна', 'ценаkzt', 'ценазаединицу', 'ценазакупа',
  'ценазакупки', 'ценаопт', 'ценапозиции', 'ценапоступления', 'ценаприхода',
  'ценапродажиосновная', 'ценапродажная', 'ценареализации', 'ценарозничная',
  'ценатенге', 'штрихкодосновной', 'штрихкодшк', 'штрихкоды', 'штрихкодытовара',
  // How a supplier's price list names its own columns. Input, like the rest.
  'кратность', 'минзаказ', 'минимальнаяпартия', 'минпартия', 'оптоваяцена',
  'прайс', 'ценапоставщика', 'ценапрайс',
  // And how a delivery note names its own — the same kind of thing, read from
  // the other side of the transaction.
  'кол', 'отгружено', 'привезено', 'ценабезндс',
  // Names of other companies' programs. A brand is not translated, and
  // translating one would stop the owner recognising his own.
  '1С', 'МойСклад', 'Мультикас',
  // Columns and cells of the CSV export.
  'Баллы', 'В карантине', 'В продаже', 'Дата', 'Документ', 'Доступно', 'Единица',
  'Заказ', 'Закупочная цена', 'Зарезервировано', 'Изменение', 'Кассир', 'Категория',
  'Клиент', 'Количество', 'Кто', 'Лимит долга', 'НКТ', 'Название', 'Оплата', 'Остаток',
  'Причина', 'Разрешён долг', 'Режим НДС', 'Сумма', 'Телефон', 'Тип', 'Товар', 'Цена',
  'Цена продажи', 'Чек', 'Штрихкод', 'Ячейка', 'да', 'нет', 'не размещено',
  'Удалённый сотрудник', 'Неизвестно', 'неизвестно',
  // A device's first name before anybody renames it. Stored on the row and
  // edited by the shop from then on, so translating it would rename their
  // tablets under them.
  'Устройство',
  // Cells of the export, again: the reason a movement happened and how a sale
  // was paid for. These used to go out as `write_off` and `cash` — English
  // values in Russian columns, in a file that opens in the owner's Excel. The
  // register never sees them: it is answered with the code and says the word
  // in its own dictionary, which is why the same word appears twice in this
  // repository and only one of them is a message.
  'В долг', 'Возврат от покупателя', 'Выдача заказа', 'Заказ на стол', 'Карта',
  'Наличные', 'Начальный остаток', 'Перемещение (куда)', 'Перемещение (откуда)',
  'Перемещение отменено', 'Приёмка партии', 'Приёмка товара',
  'Производство (выпуск)', 'Производство (расход)', 'Смешанная',
  // Document types, write-off reasons and picking stages: the register has the
  // code and says these in its own words.
  'Продажа', 'Возврат покупателю', 'Приёмка', 'Перемещение', 'Списание',
  'Инвентаризация', 'Карантин', 'Производство', 'Заказ поставщику', 'Возврат поставщику',
  'Сверка журнала',
  'Блокировка ячейки', 'Брак', 'Недостача', 'Повреждение', 'Просрочка', 'Другое',
  'Ждёт сборки', 'Собирается', 'Собран', 'Отгружен', 'Отменён',
  // Audit field names, said by the register from the `field` code beside them.
  'PIN-код', 'Контрагент', 'Сотрудник', 'в продаже', 'закупочная цена', 'код НКТ',
  'лимит долга', 'разрешён долг', 'режим НДС', 'роль', 'стоп-лист', 'цена продажи',
  // Composed by the register from the parts, not shown as the server wrote it.
  '7: 7 изменён', '7: 7 — задано «7»', '7: 7 — снято (было «7»)',
  // Never rendered: a corrupt secret is a server fault, not something a cashier
  // can act on, and the note beside a queued receipt is read in the log.
  'Недопустимый символ в ключе: 7', 'попытка 7, повторим', 'попыток исчерпано (7)',
  // Written into a document's own reason line, which the register shows verbatim
  // because the shop's own wording sits in the same field.
  'Пересчёт ячеек: 7', 'Сверка журнала: исправлено позиций 7',
  // An example inside a doc comment.
  'Сок "Дар" 1л',
  // Written to the server's own log, never sent to anybody. The operator
  // reading it is looking at a terminal, not at a till.
  '(пусто)',
  '[cors] отказано источнику 7. Разрешены: 7. ',
  'Если это ваш собственный фронтенд — добавьте его в ALLOWED_ORIGINS ровно в том виде, ',
  'в каком браузер шлёт Origin: со схемой, без завершающего слэша.',
]);

describe('the server, in the cashier\'s language', () => {
  it('covers every message a register can be answered with', () => {
    // This is the guard that keeps the list honest. The server's text is the
    // key here, so a message edited or added on the server silently stops being
    // translated — the register falls back to Russian and nothing breaks, which
    // is exactly why nobody would notice. This notices.
    const missing = russianStrings().filter(
      (text) => !NOT_A_MESSAGE.has(text) && !hasServerTranslation(text),
    );
    expect(missing).toEqual([]);
  });

  it('does not keep entries for messages the server no longer sends', () => {
    // The other direction. A stale entry is harmless at runtime and misleading
    // to read: it suggests the server still says something it stopped saying.
    const said = new Set(russianStrings());
    const stale = Object.keys(SERVER_KK).filter((message) => !said.has(message));
    expect(stale).toEqual([]);
  });

  it('does not excuse a string the server has stopped holding', () => {
    // The exclusion list earns the same treatment. Left to rot it would start
    // excusing messages that no longer exist, and eventually excuse one that
    // does under a name somebody reused.
    const said = new Set(russianStrings());
    const unused = [...NOT_A_MESSAGE].filter((text) => !said.has(text));
    expect(unused).toEqual([]);
  });

  it('actually says something different, rather than echoing the Russian', () => {
    const echoed = Object.entries(SERVER_KK)
      .filter(([russian, kazakh]) => russian === kazakh)
      .map(([russian]) => russian);
    expect(echoed).toEqual([]);
  });

  it('leaves Russian alone', () => {
    expect(translateServerMessage('ru', 'Смена уже закрыта')).toBe('Смена уже закрыта');
  });

  it('shows an unrecognised message exactly as it arrived', () => {
    // Better a Russian sentence that says what happened than a Kazakh one that
    // says nothing did.
    const unknown = 'Что-то новое, чего здесь ещё нет';
    expect(translateServerMessage('kk', unknown)).toBe(unknown);
  });

  it('puts a value where Kazakh puts it, not where Russian did', () => {
    // Russian leads with the noun and trails the code; Kazakh leads with the
    // code. A positional substitution would have produced the Russian order.
    expect(translateServerMessage('kk', 'Ячейка A-01 уже есть на этой точке')).toBe('A-01 ұяшығы бұл нүктеде бар');
    expect(translateServerMessage('kk', 'Ячейки B-07 нет на этой точке')).toBe('B-07 ұяшығы бұл нүктеде жоқ');
    // And where Russian puts two numbers in one order, Kazakh puts them in the
    // other: the receipt total comes first there, the amount paid second.
    expect(translateServerMessage('kk', 'Оплачено 500 ₸ при сумме чека 900 ₸')).toBe(
      'Чек сомасы 900 ₸ болғанда 500 ₸ төленді',
    );
  });
});
