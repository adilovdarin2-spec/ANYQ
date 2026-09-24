import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Умолчание при заведении компании — это то, что клиент купил.
 *
 * Умолчанием пользуются. Подключают магазин, соглашаются с предложенным и идут
 * дальше; спорят с ним раз в двадцать подключений. Поэтому набор модулей по
 * умолчанию — не «что-нибудь безопасное», а самый дешёвый проданный тариф.
 *
 * Стояла здесь одна розница — набор, которого нет ни в одном тарифе. Самая
 * дешёвая «Точка» на странице цен обещает «приёмку, инвентаризацию, списание»,
 * и все три живут в модуле «Товар и остатки». То есть магазин, подключённый по
 * умолчанию, не нашёл бы приёмку, за которую заплатил, — и узнал бы об этом в
 * первый же день, разгружая поставку.
 *
 * Разъезжаются эти два места молча: страница цен в одном приложении, форма
 * заведения в другом, и между ними нет ничего, кроме этой проверки.
 */

const read = (rel: string) => withoutComments(readFileSync(resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n'));

describe('умолчание при заведении компании', () => {
  it('включает и розницу, и товар с остатками', () => {
    const drawer = read('./components/CreateCompanyDrawer.tsx');
    const defaults = /useState<ModuleKey\[\]>\(\[([^\]]*)\]\)/.exec(drawer);
    expect(defaults, 'не нашлось умолчание модулей — разошёлся разбор, а не код').not.toBeNull();

    const picked = (defaults![1].match(/'([a-z]+)'/g) ?? []).map((q) => q.slice(1, -1));
    expect(picked).toContain('retail');
    expect(picked, 'без «Товар и остатки» не будет приёмки, обещанной в самом дешёвом тарифе').toContain('stock');
  });

  it('и не включает того, за что клиент не платил', () => {
    // Умолчание щедрее купленного — это не подарок, а счёт, который выставят
    // не тому: склад, опт и аптека продаются отдельно.
    const drawer = read('./components/CreateCompanyDrawer.tsx');
    const picked = (/useState<ModuleKey\[\]>\(\[([^\]]*)\]\)/.exec(drawer)![1].match(/'([a-z]+)'/g) ?? []).map((q) =>
      q.slice(1, -1),
    );
    for (const paid of ['warehouse', 'supply', 'pharmacy', 'restaurant']) {
      expect(picked, `${paid} продаётся отдельно`).not.toContain(paid);
    }
  });

  it('а самый дешёвый тариф по-прежнему обещает приёмку', () => {
    // Самопроверка на то, от чего эта охрана отсчитывает. Уберут обещание со
    // страницы цен — проверка выше начнёт держать вчерашнее.
    const pricing = read('../../orders/src/components/PricingScreen.tsx');
    expect(pricing).toContain('Приёмка, инвентаризация, списание');
  });
});
