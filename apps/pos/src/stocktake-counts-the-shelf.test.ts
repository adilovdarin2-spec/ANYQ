import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Инвентаризация сверяется с тем, что лежит на полке.
 *
 * В сетке продажи `stock` — это доступное: остаток за вычетом брони и
 * карантина. Для продажи это верно и так и задумано. Инвентаризация спрашивает
 * другое — сколько штук на полке, — и сервер сравнивает именно с остатком
 * (`totalOnHand`), а экран показывал доступное. Два числа из двух разных
 * счётов, в соседних строках одного действия.
 *
 * Чем это кончается. Товар, целиком лежащий в карантине, читался как
 * «система: 0»: кладовщик видит три мешка перед собой, пишет «3» и ждёт, что
 * систему поправят на три, — а сервер отвечает «расхождений нет», потому что у
 * него и было три. И наоборот: полка, с которой карантинный товар
 * действительно пропал, подтверждалась нулём, и недостача списывалась без
 * единого слова о том, что пропал именно карантинный.
 *
 * Найдено 01.10.2026 прогоном инвентаризации после обхода ячеек.
 */

const screen = withoutComments(
  readFileSync(resolve(__dirname, 'components', 'CycleCountScreen.tsx'), 'utf8'),
).replace(/\r\n/g, '\n');

describe('с чем сверяется инвентаризация', () => {
  it('с остатком на полке, а не с доступным к продаже', () => {
    expect(screen).toContain('function onHand(');
    expect(screen).toContain('product.stock + (product.reserved ?? 0) + (product.blocked ?? 0)');
  });

  it('и это же число стоит в подсказке поля, а не другое', () => {
    /* Поле и строка «система:» — про одно и то же количество. Разойдясь, они
       заставляют выбирать, какому из двух чисел верить. */
    expect(screen).toContain("{t('count.system')}: {formatStock(onHand(p), p.saleUnit)}");
    expect(screen).toContain('placeholder={formatStock(onHand(p), p.saleUnit)}');
  });

  it('доступное на этом экране больше нигде не печатается', () => {
    // Любое `p.stock` в разметке — это снова то самое расхождение.
    expect(screen).not.toContain('formatStock(p.stock');
  });

  it('и сказано, почему число может выглядеть странно', () => {
    expect(screen).toContain("t('count.reservedFor'");
    expect(screen).toContain("t('count.inQuarantine'");
  });
});
