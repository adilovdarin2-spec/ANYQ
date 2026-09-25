import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_KK, hasServerTranslation, translateServerMessage } from './server';
import { withoutComments } from '../../../../scripts/lib/source-text.mjs';

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
  // Выгрузка в 1С. Русские строки в ней — это имена тегов формата CommerceML
  // («Наименование», «Штрихкод», «ЦенаЗаЕдиницу»), а не слова, которые кто-то
  // читает. Переводить их нельзя тем более: имя тега, сказанное по-казахски,
  // 1С просто не поймёт.
  'commerceml.ts',
  // Проверка живости. Её слова читает внешний монитор и человек, которому
  // пришло письмо ночью, — касса на `/health/deep` не ходит вовсе. Перевод
  // здесь был бы записью в словаре, до которой нельзя добраться.
  'health.ts',
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
    /* Комментарии отсекаются: без этого извлекатель считал текстом сервера и
       прозу. Пример из пояснения к `csvCell` — `Сок "Дар" 1л` — годами лежал в
       списке исключений как сообщение, которого касса не получает никогда. */
    const source = withoutComments(readFileSync(path, 'utf8'));
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
  // Как выгрузка называет столбцы про коробку: сколько штук внутри, как её
  // зовут и какой у неё свой штрихкод. Это тоже вход — с ними сверяют файл, а
  // не показывают их кому-то. И `Упаковка` с большой буквы — имя, которым
  // коробка заводится в базе, когда в файле её никак не назвали: это запись, а
  // не фраза. Кассир своих коробок вообще не видит — их читает кладовщик на
  // приёмке, и там название берётся из базы.
  'вупаковке', 'количествовупаковке', 'колвовупаковке', 'единицвупаковке', 'штвупаковке',
  'вкоробке', 'вблоке', 'вящике', 'фасовка', 'упаковкашт', 'ёмкостьупаковки',
  'упаковка', 'тара', 'видупаковки', 'типупаковки',
  'штрихкодупаковки', 'штрихкодкороба', 'штрихкодкоробки', 'штрихкодблока', 'штрихкодящика',
  'шкупаковки', 'шккороба', 'шкблока',
  'қаптама', 'қаптамада', 'қаптамаштрихкоды',
  'Упаковка',
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
  // tablets under them. «Касса №7» — то же самое: имя новой кассы, которое
  // владелец правит у себя в списке, а не сообщение.
  'Устройство', 'Касса №7',
  // Провал выдачи номера кассе. Это не ответ кассиру, а `throw` внутри
  // сервера после пяти столкновений на уникальном индексе: наружу уходит
  // пятисотка, и текст читает тот, кто смотрит в лог сервера.
  'Не удалось выдать номер кассе',
  // Куски фразы про лимит тарифа, которая собирается из частей в
  // apps/api/src/limits.ts. По отдельности это не сообщения: «точки» и «сейчас
  // 7» никто не показывает. Собранная фраза переведена образцом ниже, и
  // отдельный тест в этом файле проверяет, что образец её ловит, — иначе
  // список исключений извинил бы её целиком.
  'Тариф допускает 7 — 7. Поднять лимит может менеджер ANYQ.',
  'сейчас 7', 'сейчас 7, добавляется 7',
  'точку', 'точки', 'точек',
  'сотрудника', 'сотрудников',
  'товар', 'товара', 'товаров',
  'кассу', 'кассы', 'касс',
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
  'PIN-код', 'Контрагент', 'Сотрудник', 'Касса', 'в продаже', 'закупочная цена', 'код НКТ',
  'лимит долга', 'разрешён долг', 'режим НДС', 'роль', 'стоп-лист', 'устройство', 'цена продажи',
  // Composed by the register from the parts, not shown as the server wrote it.
  '7: 7 — задано «7»', '7: 7 — снято (было «7»)',
  // Never rendered: a corrupt secret is a server fault, not something a cashier
  // can act on, and the note beside a queued receipt is read in the log.
  'Недопустимый символ в ключе: 7', 'попытка 7, повторим', 'попыток исчерпано (7)',
  // Запись в лог о недоставленном уведомлении. Её читает тот, кто держит
  // сервер, а не кассир: до кассы она не доходит никогда, и переводить её
  // значило бы переводить содержимое журнала сервера.
  '[push] не доставлено в 7: 7', 'неизвестный адрес',
  // Отказ админки про роль: приходит только на создание и правку сотрудника,
  // то есть в админку. Касса ролей не назначает.
  'Такой роли нет. Доступны: 7',
  // Отказы админки: их видит сотрудник ANYQ, заводящий компанию, а не кассир.
  // Касса про модули не спрашивает вовсе — этот ответ приходит только на
  // создание компании и правку тарифа, и приходит он в админку.
  'Модули передаются списком', 'Таких модулей нет: 7. Доступны: 7', 'пустое значение',
  // Согласие владельца на доступ поддержки: эти отказы читает сотрудник
  // платформы у себя в панели, когда просит доступ. Кассе они не приходят
  // никогда — она про доступ поддержки не спрашивает.
  'Нужно разрешение владельца: запросите доступ и объясните, зачем',
  'Владелец ещё не ответил на запрос', 'Владелец отказал в доступе', 'Владелец закрыл доступ',
  'Доступ истёк — запросите заново',
  'Объясните владельцу, зачем нужен доступ', 'Напишите причину целиком — владелец решает по ней',
  // Зависимость модулей проверяется там же и приходит туда же — в админку.
  // Целыми фразами, а не шаблоном: строки отсюда переводятся по тексту, а
  // фраза, склеенная из половин, не переводится — см. `REQUIREMENT_REFUSAL`.
  'Модуль «warehouse» не работает без «stock»: приёмка и инвентаризация живут там',
  'Модуль «pharmacy» не работает без «stock»: просроченную партию нужно чем-то списывать, а списание живёт там',
  // Written into a document's own reason line, which the register shows verbatim
  // because the shop's own wording sits in the same field.
  'Пересчёт ячеек: 7', 'Сверка журнала: исправлено позиций 7',
  'Сверка журнала: приведено партий 7', 'Сверка журнала: исправлено позиций 7, приведено партий 7',
  // Кусок сообщения, а не сообщение: по нему маршрут спецификаций решает,
  // отвечать 404 или 400. Показывают при этом целую фразу, и она переведена.
  'не найден',
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

  it('и про коробку из выгрузки — каждой фразой целиком', () => {
    /* Каждое из этих замечаний — цельная фраза, а не общая половина с
       приставкой «Упаковка:». Склеенная переводилась бы наполовину: образец
       ищет фразу от начала до конца, и приставка сбивает его — владелец получил
       бы русский текст ровно там, где читает на своём. */
    const формы = [
      '«Сок»: упаковка «Ящик» без количества штук в ней — не заведена. Добавьте столбец «В упаковке».',
      '«Соль»: в упаковке указано «много» — это не количество, упаковка не заведена.',
      '«Ручка»: в упаковке одна штука и своего штрихкода у неё нет — такая упаковка ничего не даёт, не заведена.',
      '«Сок»: штрихкод упаковки совпадает со штрихкодом штуки — у упаковки он убран, сканер иначе не отличит коробку от пачки.',
      '«Вода»: штрихкод упаковки 4006381333931 уже был в строке 2 — у этой упаковки он убран.',
      '«Сок»: Excel сохранил штрихкод упаковки как 4.87012E+12 — цифры потеряны, восстановить их нельзя. Отформатируйте столбец как текст и выгрузите файл заново. Упаковку заведём без штрихкода.',
      '«Сок»: в штрихкоде упаковки 4006381333932 не сходится контрольная цифра — сканер такой короб не найдёт. Проверьте по коробке.',
    ];
    for (const форма of формы) {
      expect(hasServerTranslation(форма), форма).toBe(true);
      const переведено = translateServerMessage('kk', форма);
      expect(переведено, форма).not.toBe(форма);
      /* Переведено целиком, а не наполовину: фраза говорит про коробку, и
         казахское слово для неё обязано в ней быть.

         Отсутствие русского здесь не проверяется намеренно: одна из фраз
         называет столбец «В упаковке», который человек добавляет в свой же
         русский файл, и переводить это название значило бы отправить его искать
         столбец, которого в Excel не будет. */
      expect(переведено, форма).toContain('қаптама');
    }
    // И вставки доезжают: без них человек не найдёт строку в файле.
    expect(translateServerMessage('kk', формы[0])).toContain('Ящик');
    expect(translateServerMessage('kk', формы[4])).toContain('4006381333931');
  });

  it('и про грязный штрихкод в выгрузке — с названием товара и самим кодом', () => {
    /* Эти два замечания читает владелец, заводящий каталог выгрузкой из прежней
       программы, — то есть в первый свой день и на своём языке. Обе вставки
       обязаны доехать: без названия и без кода человек не найдёт нужную ячейку в
       файле на три тысячи строк, и перевод станет бесполезным ровно там, где
       нужен. */
    const формы = [
      '«Чай «Асем»»: Excel сохранил штрихкод как 4.87012E+12 — цифры потеряны, восстановить их нельзя. Отформатируйте столбец со штрихкодами как текст и выгрузите файл заново. Товар заведём без штрихкода.',
      '«Сигареты»: в штрихкоде 4006381333932 не сходится контрольная цифра — сканер такой код не найдёт. Проверьте по пачке.',
    ];
    for (const форма of формы) {
      expect(hasServerTranslation(форма), форма).toBe(true);
      const переведено = translateServerMessage('kk', форма);
      expect(переведено, форма).not.toBe(форма);
      // Ни одной русской буквы не осталось, кроме названия товара и кода.
      expect(переведено).not.toContain('Отформатируйте');
      expect(переведено).not.toContain('сканер такой код');
    }
    expect(translateServerMessage('kk', формы[0])).toContain('4.87012E+12');
    expect(translateServerMessage('kk', формы[0])).toContain('Асем');
    expect(translateServerMessage('kk', формы[1])).toContain('4006381333932');
    expect(translateServerMessage('kk', формы[1])).toContain('Сигареты');
  });

  it('говорит по-казахски и про лимит тарифа', () => {
    // Фраза собирается из частей, поэтому в исходниках её целиком нет и
    // извлекатель её не видит. Здесь она написана в том виде, в каком её
    // отдаёт сервер: если форма в limits.ts изменится, извлекатель наткнётся
    // на новый скелет, которого нет в списке исключений, и предыдущий тест
    // упадёт.
    const формы = [
      'Тариф допускает 3 точки — сейчас 3. Поднять лимит может менеджер ANYQ.',
      'Тариф допускает 1 сотрудника — сейчас 1. Поднять лимит может менеджер ANYQ.',
      'Тариф допускает 500 товаров — сейчас 400, добавляется 200. Поднять лимит может менеджер ANYQ.',
    ];
    for (const форма of формы) {
      expect(hasServerTranslation(форма), форма).toBe(true);
      const переведено = translateServerMessage('kk', форма);
      expect(переведено).not.toBe(форма);
      expect(переведено).toContain('ANYQ');
    }
    // Числа доезжают в перевод — иначе казахский кассир прочитает фразу без
    // единственного, что в ней важно.
    expect(translateServerMessage('kk', формы[0])).toContain('3');
    expect(translateServerMessage('kk', формы[2])).toContain('200');
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
