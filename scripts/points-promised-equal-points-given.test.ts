import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeLoyalty } from '../apps/api/src/loyalty';
import { withoutComments } from './lib/source-text.mjs';

/**
 * Баллы, обещанные на чеке, и баллы, которые начислят.
 *
 * Считают их двое. Сервер — по именованной ставке `LOYALTY_EARN_RATE_PERCENT`,
 * и его число единственное настоящее: присланное кассой он отбрасывает. Касса —
 * своим выражением прямо в `App.tsx`, со ставкой, вписанной числом.
 *
 * Касса делает это не от лени: чек печатается и без сети, и строка «Начислено
 * баллов» на нём должна быть. Но покупатель читает её как обещание, и если
 * ставку однажды поменяют на сервере — «давайте не пять, а три», — касса
 * продолжит обещать пять. Спорить покупатель будет у прилавка, а кассиру
 * ответить нечего: он видит ту же бумагу.
 *
 * Поэтому здесь сверяются обе половины: ставка — с константой сервера, а форма
 * выражения — с тем, что вернёт `computeLoyalty` на тех же числах.
 */

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => withoutComments(readFileSync(resolve(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'));

/** Ставка, которую сервер считает единственной настоящей. */
export function serverRate(source: string): number | null {
  const m = /const LOYALTY_EARN_RATE_PERCENT = (\d+);/.exec(source);
  return m ? Number(m[1]) : null;
}

/** Ставка, вписанная в выражение кассы. */
export function tillRate(source: string): number | null {
  const m = /pointsEarned: loyalty && hasRetail \? Math\.floor\(\(cartTotal \* (\d+)\) \/ 100\)/.exec(source);
  return m ? Number(m[1]) : null;
}

describe('обещанные баллы', () => {
  const server = read('apps/api/src/routes/pos.ts');
  const till = read('apps/pos/src/App.tsx');

  it('обе ставки вообще нашлись', () => {
    // Иначе первое, что докажет этот файл, — что он сравнивает два `null`.
    expect(serverRate(server), 'константа сервера не найдена — тест устарел').not.toBeNull();
    expect(tillRate(till), 'выражение кассы не найдено — тест устарел').not.toBeNull();
  });

  it('и они одинаковые', () => {
    expect(tillRate(till), 'касса обещает не ту долю, которую начислят').toBe(serverRate(server));
  });

  it('а выражение кассы даёт то же, что сервер, на тех же числах', () => {
    /* Совпадения ставки мало: половину можно посчитать и от другой суммы, и с
       другим округлением. Здесь проверяется целиком то, что касса напишет на
       чеке, против того, что сервер положит покупателю на счёт. */
    const rate = serverRate(server)!;
    for (const total of [0, 1, 19, 20, 99, 100, 333, 999, 1000, 12345, 99999]) {
      const обещано = Math.floor((total * rate) / 100);
      const начислено = computeLoyalty({
        netAfterDiscount: total,
        availablePoints: 0,
        pointsToRedeem: 0,
        earnRatePercent: rate,
      }).pointsEarned;
      expect(обещано, `чек на ${total}`).toBe(начислено);
    }
  });

  it('и считается от суммы после скидки и баллов, а не от позиций', () => {
    /* Касса берёт `cartTotal` — то, что покупатель платит. Сервер берёт
       `finalTotal` — то же самое. Считать от суммы позиций значило бы начислить
       за скидку, которую магазин сам же и дал. */
    expect(till, 'касса стала считать баллы не от суммы к оплате').toContain('Math.floor((cartTotal * ');
    const rate = serverRate(server)!;
    const начислено = computeLoyalty({
      netAfterDiscount: 1000,
      availablePoints: 400,
      pointsToRedeem: 400,
      earnRatePercent: rate,
    });
    expect(начислено.finalTotal, 'баллы списались не из суммы к оплате').toBe(600);
    expect(начислено.pointsEarned).toBe(Math.floor((600 * rate) / 100));
  });

  it('а сама проверка отличает совпадение от расхождения', () => {
    // Иначе всё выше сторожило бы сравнение, которое всегда истинно.
    expect(serverRate('const LOYALTY_EARN_RATE_PERCENT = 3;')).toBe(3);
    expect(
      tillRate('pointsEarned: loyalty && hasRetail ? Math.floor((cartTotal * 7) / 100) : undefined,'),
    ).toBe(7);
    expect(serverRate('ничего похожего')).toBeNull();
  });
});
