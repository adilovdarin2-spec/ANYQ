import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * «Кому продаём» не спрятано за розницу.
 *
 * Строка клиента появилась ради баллов и стояла под `hasRetail` вместе с ними.
 * У склада модуля `retail` нет — значит не было строки, значит назвать
 * покупателя было негде. А продажа в долг требует известного клиента, и
 * получалось, что опт, у которого половина оборота под запись, не мог
 * отпустить в долг вообще: сервер это умел и даже отдавал кассе долг с
 * лимитом, а экран не спрашивал кому.
 *
 * Обратно это уезжает одной строкой и без единого падающего теста: строку
 * подвинут внутрь блока `hasRetail`, чтобы скидка и баллы стояли рядом, — и
 * склад снова онемеет. Поэтому проверяется не поведение, а место.
 */

const read = (name: string) => readFileSync(resolve(__dirname, 'components', name), 'utf8').replace(/\r\n/g, '\n');

const КОРЗИНЫ = ['CartPanel.tsx', 'CartSheet.tsx'];

/** Стоит ли `<CustomerRow` внутри блока `{hasRetail && (…)}`. */
export function внутриРозничногоБлока(source: string): boolean {
  const gate = source.indexOf('{hasRetail && (');
  const row = source.indexOf('<CustomerRow');
  if (gate < 0 || row < 0) return false;
  if (row < gate) return false;

  let depth = 0;
  for (let i = gate; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return row < i;
    }
  }
  return false;
}

describe('строка клиента', () => {
  it('есть в обеих корзинах — и на столе, и на телефоне', () => {
    // Второй экран забывают чаще первого, и забывают тихо: на разработческом
    // мониторе открыт стол, а кассир за прилавком с телефоном.
    for (const name of КОРЗИНЫ) {
      expect(read(name), name).toContain('<CustomerRow');
    }
  });

  it('и ни в одной не спрятана за модуль розницы', () => {
    for (const name of КОРЗИНЫ) {
      expect(внутриРозничногоБлока(read(name)), `${name}: строка клиента снова под hasRetail`).toBe(false);
    }
  });

  it('а сама проверка отличает одно от другого', () => {
    // Иначе первое, что она докажет, — что ничего не ищет.
    const спрятана = `
      {hasRetail && (
        <>
          <DiscountEditor />
          <CustomerRow showPoints={hasRetail} />
        </>
      )}
      <div className="total" />
    `;
    const снаружи = `
      {hasRetail && (
        <>
          <DiscountEditor />
        </>
      )}
      <CustomerRow showPoints={hasRetail} />
    `;
    expect(внутриРозничногоБлока(спрятана)).toBe(true);
    expect(внутриРозничногоБлока(снаружи)).toBe(false);
  });

  it('и баллы при этом остаются розничными', () => {
    // Обратная сторона: вынести строку — не значит выдать складу баллы.
    // Признак `showPoints` — то место, где это решается, и он должен остаться.
    for (const name of КОРЗИНЫ) {
      expect(read(name), name).toContain('showPoints={hasRetail}');
    }
  });
});
