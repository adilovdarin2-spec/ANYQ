import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { capNote } from './cap-note';

/**
 * Витрина не меняет введённое число молча.
 *
 * Оптовый закупщик набирает мешками: он вводит «100», поле показывает «30», и
 * до сегодняшнего дня объяснения не было нигде. Метка об остатке появляется
 * только когда его меньше пяти, а «+» просто переставал нажиматься.
 *
 * Само ограничение правильное — принять заказ на большее значило бы пообещать
 * за поставщика то, чего у него нет. Дорого именно молчание: заявку не
 * перечитывают по строкам, заказ уезжает урезанным, и замечают это, когда
 * приходит не та машина.
 */

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('подпись про остаток', () => {
  it('называет и сколько, и в чём', () => {
    // «Больше нет» без числа не отвечает на вопрос закупщика: ему нужно знать,
    // сколько взять здесь и сколько искать в другом месте.
    expect(capNote(30, 'шт')).toBe('Это весь остаток — 30 шт');
    expect(capNote(4, 'мешок')).toContain('4 мешок');
  });
});

describe('где она показывается', () => {
  it('и в списке, и в корзине — вводить можно в обоих', () => {
    for (const file of ['./components/ProductRow.tsx', './components/CartSidebar.tsx']) {
      const src = read(file);
      expect(src, `${file}: счётчик без объяснения`).toContain('qty-capped');
      expect(src, `${file}: подпись должна быть общей, а не переписанной на месте`).toContain('capNote');
    }
  });

  it('ровно тогда, когда строка упёрлась в остаток', () => {
    // Не «когда остатка мало»: это разные вопросы. Мало — предупреждение перед
    // выбором; упёрлась — ответ на «почему не больше».
    expect(read('./components/ProductRow.tsx')).toContain('qty > 0 && qty >= product.stock');
    expect(read('./components/CartSidebar.tsx')).toContain('line.qty >= line.maxStock && (');
  });
});

describe('а само ограничение остаётся', () => {
  it('количество не поднимается выше остатка', () => {
    // Если снять ограничение, подпись станет враньём: она утверждает, что
    // больше взять нельзя.
    const app = read('./App.tsx');
    expect(app).toContain('Math.min(Math.max(qty, 0), l.maxStock)');
  });

  it('и остаток строки берётся из каталога, а не придумывается', () => {
    expect(read('./App.tsx')).toContain('maxStock: product.stock');
  });
});
