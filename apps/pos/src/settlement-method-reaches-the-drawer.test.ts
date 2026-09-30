import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Через ящик проходят только наличные.
 *
 * Расчёт с контрагентом записывался наличным всегда: способ был зашит в код, а
 * экран о нём не спрашивал. Счёт поставщику на четыреста тысяч платят
 * переводом — это обычный способ в Казахстане, — и касса уводила из сверки
 * смены четыреста тысяч, которые из ящика не выходили. Кассир на закрытии
 * оставался с излишком, которого он не делал.
 *
 * Излишек, придуманный кассой, хуже отсутствия сверки: в него верят. Ровно это
 * написано в `shift-tally.ts` про разбитый чек — и повторилось здесь.
 *
 * Сервер способ принимал всегда: `paymentMethod` лежит в теле запроса, а
 * сверка смены считает только расчёты с `cash`. Не хватало одного вопроса на
 * экране.
 *
 * Найдено 30.09.2026 прогоном расчётов с поставщиками.
 */

const read = (name: string, dir = 'components') =>
  withoutComments(readFileSync(resolve(__dirname, dir, name), 'utf8')).replace(/\r\n/g, '\n');

const SCREEN = read('SettlementsScreen.tsx');
const APP = withoutComments(readFileSync(resolve(__dirname, 'App.tsx'), 'utf8')).replace(/\r\n/g, '\n');

describe('расчёт с контрагентом', () => {
  it('исходник разобрался', () => {
    // Иначе всё ниже пройдёт на пустой строке.
    expect(SCREEN).toContain('onPay');
    expect(APP).toContain('handleRecordSettlement');
  });

  it('спрашивает, чем платят', () => {
    expect(SCREEN, 'способ снова не спрашивают').toContain("t('settle.method')");
    expect(SCREEN).toContain("t('settle.transfer')");
  });

  it('и говорит, попадут ли эти деньги в сверку смены', () => {
    /* Кассир должен понимать последствие до того, как нажмёт: «мимо ящика» —
       это не мелкий шрифт, это ответ на вопрос, за что он вечером отвечает. */
    expect(SCREEN).toContain("t('settle.fromDrawer')");
    expect(SCREEN).toContain("t('settle.notFromDrawer')");
  });

  it('и передаёт выбранное, а не «наличные» всегда', () => {
    const at = APP.indexOf('await recordSettlement(');
    expect(at, 'расчёт больше не отправляется').toBeGreaterThan(-1);
    const call = APP.slice(at, APP.indexOf('});', at));
    expect(call, 'способ снова зашит в код').not.toContain("paymentMethod: 'cash'");
    expect(call).toContain('paymentMethod: method');
  });

  it('а в ящик запись идёт только при наличных', () => {
    /* Это и есть цена ошибки: запись в ящик двигает ожидаемую сумму на
       закрытии смены. Безналичный платёж её двигать не должен. */
    const at = APP.indexOf('handleRecordSettlement');
    const body = APP.slice(at, APP.indexOf('async function handleSetCredit', at));
    expect(body.length, 'тело обработчика вырезано пустым').toBeGreaterThan(400);
    expect(body, 'в ящик пишется любой расчёт').toContain("if (shift && method === 'cash')");
  });
});
