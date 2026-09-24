import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ru } from './i18n/ru';
import { kk } from './i18n/kk';
// @ts-expect-error — общий разборщик написан на .mjs и типов не имеет.
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * У каждого дела в очереди владельца есть строка «почему оно здесь».
 *
 * Над этой строкой в `OwnerQueue` написано прямо: «не украшение — очередь
 * переставляет дела в порядке, которого владелец не задавал, и обязана
 * объяснить, почему двадцать тенге стоят выше ста тысяч».
 *
 * Ключ собирается шаблоном — `queue.why.${task.kind}`, — и поэтому пропажа
 * ничем себя не выдаёт: ни компилятор, ни поиск по слову «queue.why» её не
 * видят. `translate` на неизвестный ключ возвращает `undefined`, React рисует
 * пустоту, и дело стоит в списке молча.
 *
 * Пропавшим оказался `empty_catalogue` — то самое дело, которое владелец видит
 * первым: пока не заведён ни один товар, очередь состоит из него одного. То
 * есть молчала она ровно на самом первом экране.
 */

const QUEUE = resolve(__dirname, 'owner-queue.ts');
const COMPONENT = resolve(__dirname, 'components', 'OwnerQueue.tsx');

/** Виды дел, объявленные типом. */
export function taskKinds(source: string): string[] {
  const m = /type OwnerTaskKind\s*=\s*([^;]+);/s.exec(source);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe('очередь владельца объясняет каждое дело', () => {
  const queue = withoutComments(readFileSync(QUEUE, 'utf8').replace(/\r\n/g, '\n'));
  const component = withoutComments(readFileSync(COMPONENT, 'utf8').replace(/\r\n/g, '\n'));
  const kinds = taskKinds(queue);

  it('виды дел вообще разобрались', () => {
    // Иначе первое, что докажет этот файл, — что пустой список всем доволен.
    expect(kinds.length, 'не разобрался тип OwnerTaskKind').toBeGreaterThan(5);
    expect(taskKinds('type Nechto = 1;')).toEqual([]);
  });

  it('и ключ по-прежнему собирается из вида', () => {
    /* Если объяснение начнут выбирать иначе — например, через switch, — этот
       файл проверяет не то, что происходит, и должен об этом сказать. */
    expect(component).toContain('`queue.why.${task.kind}`');
  });

  it.each([
    ['по-русски', ru as Record<string, string>],
    ['по-казахски', kk as Record<string, string>],
  ])('у каждого вида есть объяснение %s', (_язык, dictionary) => {
    const без = kinds.filter((kind) => !dictionary[`queue.why.${kind}`]);
    expect(без, 'дело встанет в очередь без строки «почему»').toEqual([]);
  });

  it('и лишних объяснений нет', () => {
    /* Обратная сторона: фраза без вида — это либо опечатка в ключе, из-за
       которой настоящий вид остался молча, либо вид, который убрали. */
    const кодом = new Set(kinds);
    const лишние = Object.keys(ru)
      .filter((key) => key.startsWith('queue.why.'))
      .map((key) => key.slice('queue.why.'.length))
      .filter((kind) => !кодом.has(kind));
    expect(лишние).toEqual([]);
  });

  it('а у самого первого дела объяснение особенно обязано быть', () => {
    // Пока не заведён ни один товар, очередь состоит из него одного — это
    // первое, что новый владелец вообще видит в кассе.
    expect(queue).toContain("kind: 'empty_catalogue'");
    expect((ru as Record<string, string>)['queue.why.empty_catalogue']).toBeTruthy();
    expect((kk as Record<string, string>)['queue.why.empty_catalogue']).toBeTruthy();
  });
});
