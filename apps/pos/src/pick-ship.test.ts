import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Отгружается то, что сборщик видит на экране.
 *
 * Числа сборщика везла только кнопка «Сохранить сборку». Сама отгрузка
 * отправляла одни коды маркировки, а количества сервер брал из сохранённого
 * раньше — и строка, которую никто не сохранял, уезжала целиком. Для магазина,
 * который не собирает вовсе, это правильно и должно остаться. Для того, кто
 * собирает, это превращало экран во враньё: сборщик вписывал 25 из 30, кнопка
 * по этим же цифрам называлась «Отгрузить неполностью» — и со склада
 * списывалось тридцать.
 *
 * Стоило это в обе стороны. Пять пачек, никуда не уехавших, исчезали из
 * остатка: их не продаст касса и не найдёт инвентаризация, пока кто-нибудь не
 * пересчитает полку. А покупателю уходила накладная на тридцать.
 *
 * Найдено это не тестом, а тем, что заказ с витрины собрали руками и посмотрели
 * в журнал.
 */

const src = readFileSync(resolve(__dirname, 'components/PickOrderScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');

/** Тело функции по её началу — со счётом фигурных скобок. */
function functionBody(source: string, signature: string): string {
  const at = source.indexOf(signature);
  if (at < 0) return '';
  const open = source.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return '';
}

describe('отгрузка несёт количества', () => {
  const ship = functionBody(src, 'async function ship()');

  it('разбор вообще нашёл отгрузку', () => {
    // Иначе первое, что докажет этот файл, — что он находит что угодно.
    expect(ship.length, 'не нашлась отгрузка — разошёлся разбор, а не код').toBeGreaterThan(50);
    expect(functionBody(src, 'async function такойФункцииНет')).toBe('');
  });

  it('записывает собранное перед тем, как отгрузить', () => {
    expect(ship).toContain('onSavePick(pickedLines())');
    expect(ship).toContain('onShip(');
  });

  it('и не отгружает, если записать не вышло', () => {
    /* Иначе будет хуже прежнего: сборщик увидит «отгружено», а уедет
       количество из заказа — то самое, от которого он отказался. */
    expect(ship).toMatch(/if\s*\(!\(await onSavePick\(pickedLines\(\)\)\)\)\s*return;/);
  });

  it('а кнопка зовёт именно её, а не голую отгрузку', () => {
    // Здесь ошибка и жила: onClick вызывал onShip напрямую, мимо количеств.
    expect(src).toContain('onClick={ship}');
    expect(src, 'голый вызов отгрузки в разметке — это обход сохранения').not.toMatch(
      /onClick=\{\(\)\s*=>\s*\n?\s*onShip\(/,
    );
  });

  it('и подпись на кнопке считается по тем же числам, что уезжают', () => {
    // Подпись «Отгрузить неполностью» — обещание. Пока она берётся из shortfall,
    // а shortfall из lines, обещание и действие смотрят в одно место.
    expect(src).toContain("shortfall > 0");
    expect(src).toContain("t('pick.shipPartial')");
  });
});
