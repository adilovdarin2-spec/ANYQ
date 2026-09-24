import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Цикл досылки не должен зависеть от того, доехал ли прошлый запрос.
 *
 * Это охрана на ошибку, которую я сделал час назад и поймал только на живой
 * кассе. Полоска в шапке говорила «Онлайн», пока рядом копилось «не
 * отправлено», и я научил её спрашивать «доехал ли последний запрос». Тем же
 * признаком пользовались циклы досылки — и заперлись: признак гас при обрыве,
 * цикл переставал пробовать, а снять признак могла только удачная попытка.
 * Продажа осталась неотправленной и после того, как сервер вернулся.
 *
 * Вопроса два, и они разные. Циклу нужна сеть: пока она есть, пробовать стоит,
 * и упрямство здесь — не грубость, а единственное, что доставляет деньги в
 * книги. Кассиру нужна правда о том, уходят ли его продажи.
 */

const read = (rel: string) => withoutComments(readFileSync(resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n'));

describe('досылка и полоска спрашивают разное', () => {
  it('циклы досылки спрашивают про сеть, а не про доехавший запрос', () => {
    for (const file of ['./hooks/useSalesSync.ts', './hooks/useOutboxSync.ts']) {
      const src = read(file);
      expect(src, `${file}: цикл должен спрашивать сеть`).toContain('useOnlineStatus');
      expect(src, `${file}: заперся бы на собственном признаке`).not.toContain('useServerReachable');
      expect(src, `${file}: и не должен читать признак напрямую`).not.toContain('serverReachable');
    }
  });

  it('а полоска в шапке спрашивает про доехавший запрос', () => {
    const app = read('./App.tsx');
    expect(app).toContain('useServerReachable');
    // Оба экрана — стол и телефон — рисуют шапку отдельно.
    expect((app.match(/online=\{serverAnswering\}/g) ?? []).length).toBe(2);
  });

  it('и сам признак снимается только ответом сервера', () => {
    // Если его начнут гасить где-то ещё — например, по таймеру, — полоска
    // снова начнёт врать, только в другую сторону.
    const api = read('./api.ts');
    expect(api).toContain('noteServerUnreachable');
    expect(api).toContain('noteServerAnswered');
  });
});
