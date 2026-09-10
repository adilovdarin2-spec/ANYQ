import { describe, expect, it } from 'vitest';
import { buildSummary, worthSending, type SummaryInput } from './daily-summary';

/** Тот же неразрывный пробел, что и в сообщении. Записан escape-ом, чтобы
 *  разница между ним и обычным пробелом была видна в исходнике. */
const NB = ' ';

const QUIET: SummaryInput = {
  shopName: 'Магазин на Абая',
  netRevenue: 0,
  grossMargin: 0,
  cashDifference: 0,
  countedShifts: 0,
  runningOut: 0,
  expiringValue: 0,
  unfiscalised: 0,
  ledgerMismatched: 0,
};

const GOOD_DAY: SummaryInput = {
  ...QUIET,
  netRevenue: 412800,
  grossMargin: 96400,
  countedShifts: 2,
};

describe('стоит ли будить владельца', () => {
  it('в день без выручки и без находок — не стоит', () => {
    // Уведомление «вчера ничего не произошло» обучает владельца их не читать,
    // и следующее, важное, он пролистнёт вместе с этим.
    expect(worthSending(QUIET)).toBe(false);
  });

  it('была выручка — стоит', () => {
    expect(worthSending(GOOD_DAY)).toBe(true);
  });

  it('выручки не было, но касса не сошлась — стоит', () => {
    expect(worthSending({ ...QUIET, cashDifference: -3200 })).toBe(true);
  });

  it('и каждая находка по отдельности будит', () => {
    for (const field of ['runningOut', 'expiringValue', 'unfiscalised', 'ledgerMismatched'] as const) {
      expect(worthSending({ ...QUIET, [field]: 1 }), field).toBe(true);
    }
  });
});

describe('текст сводки', () => {
  it('в заголовке — выручка', () => {
    expect(buildSummary(GOOD_DAY).title).toBe(`Магазин на Абая: вчера 412${NB}800${NB}₸`);
  });

  it('суммы набраны неразрывным пробелом', () => {
    // В узкой строке уведомления «412 800» с обычным пробелом переносится и
    // читается как две разные суммы.
    expect(buildSummary(GOOD_DAY).title).not.toContain('412 800');
  });

  it('спокойный день говорит, что сошлось', () => {
    expect(buildSummary(GOOD_DAY).body).toBe(`Заработали 96${NB}400${NB}₸. Касса сошлась по 2 сменам.`);
  });

  it('недостача идёт первой, а не после выручки', () => {
    // Ради этого предложения сводка и существует: разница, увиденная утром,
    // ещё восстановима.
    const { body } = buildSummary({ ...GOOD_DAY, cashDifference: -3200 });
    expect(body).toBe(`Наличных не хватает 3${NB}200${NB}₸.`);
  });

  it('излишек тоже назван — это тоже расхождение', () => {
    const { body } = buildSummary({ ...GOOD_DAY, cashDifference: 1500 });
    expect(body).toBe(`Наличных больше на 1${NB}500${NB}₸.`);
  });

  it('деньги важнее полок: недостача впереди сроков годности', () => {
    const { body } = buildSummary({ ...GOOD_DAY, cashDifference: -3200, expiringValue: 38400, runningOut: 5 });
    expect(body.startsWith('Наличных не хватает')).toBe(true);
    expect(body).toBe(
      `Наличных не хватает 3${NB}200${NB}₸. Ещё: кончается 5 позиций, испортится на 38${NB}400${NB}₸.`,
    );
  });

  it('несошедшийся журнал попадает в сводку — на нём стоит всё остальное', () => {
    expect(buildSummary({ ...GOOD_DAY, ledgerMismatched: 3 }).body).toBe('Журнал не сходится: 3 позиции.');
  });

  it('нефискализованные чеки названы: это то, что превращается в штраф', () => {
    expect(buildSummary({ ...GOOD_DAY, unfiscalised: 7 }).body).toBe('Не ушло в налоговую 7 чеков.');
  });

  it('считаемые слова склоняются по-русски, а не по-английски', () => {
    // 1 позиция, 2 позиции, 5 позиций, 11 позиций, 21 позиция — правило из
    // трёх форм, а не «одна или много».
    const forms = [1, 2, 5, 11, 21, 22, 25].map(
      (n) => buildSummary({ ...QUIET, runningOut: n }).body,
    );
    expect(forms).toEqual([
      'Кончается 1 позиция.',
      'Кончается 2 позиции.',
      'Кончается 5 позиций.',
      'Кончается 11 позиций.',
      'Кончается 21 позиция.',
      'Кончается 22 позиции.',
      'Кончается 25 позиций.',
    ]);
  });

  it('и чеки тоже', () => {
    const forms = [1, 3, 5].map((n) => buildSummary({ ...QUIET, unfiscalised: n }).body);
    expect(forms).toEqual([
      'Не ушло в налоговую 1 чек.',
      'Не ушло в налоговую 3 чека.',
      'Не ушло в налоговую 5 чеков.',
    ]);
  });

  it('день без продаж, но с находкой, честно называет и то и другое', () => {
    const message = buildSummary({ ...QUIET, runningOut: 4 });
    expect(message.title).toBe('Магазин на Абая: вчера продаж не было');
    expect(message.body).toBe('Кончается 4 позиции.');
  });

  it('без закрытых смен не утверждает, что касса сошлась', () => {
    // «Касса сошлась» при нуле посчитанных смен — это неправда, сказанная
    // уверенным голосом.
    const { body } = buildSummary({ ...GOOD_DAY, countedShifts: 0 });
    expect(body).toContain('Смен к пересчёту нет.');
    expect(body).not.toContain('сошлась');
  });

  it('текст помещается в уведомление', () => {
    // Всё, что длиннее, обрезает система — и обрезает ровно на том, что мы
    // поставили в конец.
    const worst = buildSummary({
      shopName: 'Магазин на Абая',
      netRevenue: 412800,
      grossMargin: 96400,
      cashDifference: -3200,
      countedShifts: 2,
      runningOut: 12,
      expiringValue: 38400,
      unfiscalised: 7,
      ledgerMismatched: 3,
    });
    expect(worst.title.length).toBeLessThanOrEqual(65);
    expect(worst.body.length).toBeLessThanOrEqual(180);
  });
});
