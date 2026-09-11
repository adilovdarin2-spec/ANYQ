import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Инвентаризация обязана присылать момент обхода, а не момент отправки.
 *
 * Это главное обещание пересчёта: считать можно при работающей кассе. Сервер
 * отматывает журнал к `countedAt` и применяет разницу, которую кладовщик
 * утверждал, — а не ставит абсолютную цифру поверх дневной торговли. Серверная
 * половина написана правильно и покрыта тестами.
 *
 * Сломана была клиентская: в `handleCreateCount` стояло `new Date()` с
 * комментарием «момент обхода, а не момент отправки» — то есть комментарий
 * утверждал ровно обратное тому, что делала строка под ним. Отмотка становилась
 * пустой операцией. Проверено вживую: пересчёт при одной продаже во время
 * обхода давал поправку +1 и возвращал остаток к дообходному — продажа
 * исчезала.
 *
 * Проверка читает исходники, потому что ошибка живёт не в функции, а в том,
 * какое значение передали: чистой функции, которую можно было бы вызвать, здесь
 * нет — есть состояние экрана и вызов API. Такой тест стоит немного, но ловит
 * ровно тот возврат к `new Date()`, который однажды уже случился.
 */

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

describe('момент пересчёта', () => {
  it('касса отправляет время, пришедшее с экрана, а не своё', () => {
    const app = read('./App.tsx');
    const call = app.slice(app.indexOf('async function handleCreateCount'), app.indexOf('async function loadProduction'));

    // Страховка на саму проверку: если функцию переименуют, вырезанный кусок
    // станет пустым и тест начнёт проходить, ничего не проверяя.
    expect(call.length).toBeGreaterThan(200);
    expect(call).toContain('createCount(');

    expect(call).toContain('countedAt: payload.countedAt');
    expect(call).not.toContain('countedAt: new Date()');
  });

  it('экран засекает время, когда лист открыли', () => {
    const screen = read('./components/CycleCountScreen.tsx');
    expect(screen.length).toBeGreaterThan(500);

    // Открытие листа — нажатие «+», и только там ставится отметка.
    expect(screen).toContain('setStartedAt(new Date().toISOString())');
    // Отправка берёт её, а не текущее время.
    expect(screen).toContain('countedAt: startedAt');
    // И отметка сбрасывается, иначе следующий лист унаследует чужой момент.
    expect(screen).toContain('setStartedAt(null)');
  });
});
