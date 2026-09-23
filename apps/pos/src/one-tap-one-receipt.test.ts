import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Одно нажатие — один чек.
 *
 * Кнопка подтверждения оплаты — единственная во всём продукте, которая берёт
 * деньги, и у неё не было ничего: ни `disabled`, ни признака отправки. Защищало
 * только то, что React успевает закрыть окно между двумя щелчками. На планшете
 * с большой корзиной это не гарантия, а надежда, а касса стоит на прилавке, и
 * палец бывает в перчатке.
 *
 * Ключ операции здесь не спасает: `completeSale` выдаёт продаже новый
 * идентификатор на каждый вызов, и для сервера это два разных чека. Гость
 * платит дважды, товар списывается дважды, объясняет кассир.
 *
 * Проверяется, что обе двери подтверждения — обычная и разделённый платёж —
 * идут через одну и ту же задвижку, и что задвижка снимается при ошибке:
 * окно остаётся открытым только когда что-то сорвалось, и запертая кнопка
 * тогда означала бы, что деньги взяты, а пробить нечем.
 */

const MODAL = resolve(__dirname, 'components', 'PaymentModal.tsx');
const SPLIT = resolve(__dirname, 'components', 'SplitPaymentEditor.tsx');

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('подтверждение оплаты', () => {
  const modal = read(MODAL);

  it('файл вообще разобрался', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(modal).toContain('export function PaymentModal');
    expect(modal.length).toBeGreaterThan(1000);
  });

  it('проходит через задвижку, а не зовёт наружу напрямую', () => {
    /* Ни одного прямого `onConfirm(` в разметке: единственное место, где он
       зовётся, — внутри `confirmOnce`. */
    const прямые = [...modal.matchAll(/onClick=\{[^}]*\bonConfirm\(/g)];
    expect(прямые.map((m) => m[0]), 'кнопка зовёт оплату мимо задвижки').toEqual([]);
    expect(modal).toContain('confirmOnce([{ method: selected, amount: total }])');
  });

  it('и разделённый платёж — через ту же', () => {
    // Вторая дверь к тем же деньгам. Своя задвижка у неё разошлась бы с этой.
    expect(modal).toContain('onConfirm={confirmOnce}');
    expect(read(SPLIT), 'редактор не должен заводить свой путь наружу').toContain('onConfirm(entered)');
  });

  it('задвижка держится ссылкой, а не состоянием', () => {
    /* Состояние обновляется к следующей отрисовке, и второй щелчок в том же
       кадре прочитал бы старое значение — то есть ровно в том случае, ради
       которого всё это написано. */
    expect(modal).toContain('const confirmed = useRef(false)');
    expect(modal).toMatch(/if \(confirmed\.current\) return;\s*\n\s*confirmed\.current = true;/);
  });

  it('и снимается, когда оплата не прошла', () => {
    // Память кассы переполнена — окно остаётся, и кнопка обязана работать.
    expect(modal).toMatch(/useEffect\(\(\) => \{\s*\n\s*if \(error\) confirmed\.current = false;/);
  });
});
