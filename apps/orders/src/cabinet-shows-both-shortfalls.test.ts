import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Кабинет владельца показывает обе недостачи, а не одну.
 *
 * Сервер отдаёт их вместе, одним полем: недостачи пересчёта и пропавшее по
 * дороге между точками. Кабинет рисовал только пересчёты — то есть владелец,
 * который смотрит магазин с телефона, не видел ровно ту недостачу, которая
 * вероятнее всего воровство: товар, пропавший в фургоне между двумя своими же
 * точками.
 *
 * В кассе она показывается, в кабинете — нет. Две разные картины одного
 * магазина, и та, что на телефоне, добрее к вору.
 *
 * Найдено 30.09.2026 прогоном кабинета владельца руками.
 */

const SCREEN = withoutComments(
  readFileSync(resolve(__dirname, 'components', 'CabinetScreen.tsx'), 'utf8'),
).replace(/\r\n/g, '\n');

describe('расхождения в кабинете', () => {
  it('исходник разобрался', () => {
    expect(SCREEN).toContain('summary.discrepancies');
  });

  it('показывает недостачи пересчёта', () => {
    expect(SCREEN).toContain('summary.discrepancies.counts.length > 0');
  });

  it('и пропавшее по дороге — тоже', () => {
    expect(SCREEN, 'кабинет снова показывает только пересчёты').toContain(
      'summary.discrepancies.transfers.length > 0',
    );
  });

  it('с ценой, а не только с количеством', () => {
    /* «принято 2 из 3» без цены не отвечает на вопрос, ради которого этот экран
       открывают с телефона: сколько денег утекло. */
    const at = SCREEN.indexOf('summary.discrepancies.transfers.length > 0');
    const block = SCREEN.slice(at, at + 900);
    expect(block, 'пропавшее по дороге снова без цены').toContain('doc.shortfallValue');
  });

  it('и говорит, откуда везли и кто принял', () => {
    // Без этого строка не начинает разговор, а только огорчает.
    const at = SCREEN.indexOf('summary.discrepancies.transfers.length > 0');
    const block = SCREEN.slice(at, at + 900);
    expect(block).toContain('doc.fromLocationName');
    expect(block).toContain('doc.receivedByName');
  });
});
