import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Про кассовый аппарат кассиру говорят там, где он стоит.
 *
 * В магазине с ККМ продажу надо пробить дважды: в ANYQ и на аппарате, а потом
 * вернуть сюда номер его чека. Чек после продажи об этом молчал, и шаг держался
 * на памяти кассира — весь день, на каждой продаже.
 *
 * Знал про аппарат только экран фискализации, на который заходят раз в день:
 * `fiscalDevice` загружался в `handleShowFiscal`, то есть по открытию того
 * самого экрана. Нефискализированные продажи копились молча, а это ровно то
 * число, которое превращается в штраф, — сам продукт так и пишет о нём в сводке
 * владельца.
 *
 * Найдено 30.09.2026 прогоном фискализации руками.
 */

const APP = withoutComments(readFileSync(resolve(__dirname, 'App.tsx'), 'utf8')).replace(/\r\n/g, '\n');
const RECEIPT = withoutComments(
  readFileSync(resolve(__dirname, 'components', 'ReceiptScreen.tsx'), 'utf8'),
).replace(/\r\n/g, '\n');

describe('чек в магазине с кассовым аппаратом', () => {
  it('исходник разобрался', () => {
    expect(APP).toContain('fiscalDevice');
    expect(RECEIPT).toContain('needsFiscal');
  });

  it('говорит, что продажу надо пробить на аппарате', () => {
    expect(RECEIPT, 'чек снова молчит про ККМ').toContain("t('receipt.punchOnRegister')");
  });

  it('и ведёт туда, где вводят номер его чека', () => {
    /* Без дороги это напоминание без дела: экран фискализации лежит в
       «Операциях», и искать его после каждой продажи никто не станет. */
    expect(RECEIPT).toContain('onOpenFiscal');
    expect(APP, 'кнопка на чеке никуда не ведёт').toContain('onOpenFiscal={handleShowFiscal}');
  });

  it('но только там, где аппарат правда есть', () => {
    // Магазину без ККМ это напоминание — шум на каждой продаже.
    expect(APP).toContain('needsFiscal={!!fiscalDevice}');
  });

  it('и не у отказанной продажи', () => {
    /* Отказанную сначала разбирают: фискализировать нечего, а две тревоги на
       одном экране спорят друг с другом. */
    expect(RECEIPT).toContain('needsFiscal && !sale.syncError');
  });

  it('а про аппарат касса узнаёт до того, как открыли экран фискализации', () => {
    /* Здесь и была причина молчания: устройство загружалось только в
       `handleShowFiscal`. Проверяется, что запрос стоит в эффекте, а не только
       в обработчике открытия экрана. */
    const at = APP.indexOf('fetchPendingFiscal(session.token, currentLocationId)');
    expect(at, 'аппарат снова узнаётся только на своём экране').toBeGreaterThan(-1);
    const before = APP.slice(Math.max(0, at - 400), at);
    expect(before, 'запрос уехал из эффекта').toContain('useEffect(');
  });
});
