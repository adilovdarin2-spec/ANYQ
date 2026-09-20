import { describe, it, expect } from 'vitest';
import { reconcileBalances, summarize, mismatchExplanation, reconcileBatches, reconcileCodes, reconcileHolds } from './reconciliation';
import type { CachedQuantity, LedgerTotal, HoldRow } from './reconciliation';

const ledger: LedgerTotal[] = [
  { productId: 'water', binLocation: 'A-01', total: 10 },
  { productId: 'bread', binLocation: 'A-01', total: 4 },
  { productId: 'water', binLocation: 'B-02', total: 6 },
];
const cached: CachedQuantity[] = [
  { productId: 'water', binLocation: 'A-01', quantity: 10 },
  { productId: 'bread', binLocation: 'A-01', quantity: 4 },
  { productId: 'water', binLocation: 'B-02', quantity: 6 },
];

describe('reconcileBalances', () => {
  it('says nothing when every shelf agrees with the ledger', () => {
    expect(reconcileBalances(ledger, cached)).toEqual([]);
  });

  it('catches a shelf that drifted from its own history', () => {
    // The only thing that can catch a write which changed stock without
    // writing a movement — including one introduced tomorrow.
    const drifted = cached.map((row) =>
      row.productId === 'water' && row.binLocation === 'A-01' ? { ...row, quantity: 7 } : row,
    );
    expect(reconcileBalances(ledger, drifted)).toEqual([
      { productId: 'water', binLocation: 'A-01', ledger: 10, cached: 7, difference: -3, kind: 'drift' },
    ]);
  });

  it('catches goods sitting on a shelf that no movement ever put there', () => {
    const orphan = [...cached, { productId: 'milk', binLocation: 'C-01', quantity: 5 }];
    expect(reconcileBalances(ledger, orphan)).toContainEqual({
      productId: 'milk',
      binLocation: 'C-01',
      ledger: 0,
      cached: 5,
      difference: 5,
      kind: 'orphan_row',
    });
  });

  it('catches a history with no shelf behind it', () => {
    const withExtraHistory = [...ledger, { productId: 'milk', binLocation: 'C-01', total: 5 }];
    expect(reconcileBalances(withExtraHistory, cached)).toContainEqual({
      productId: 'milk',
      binLocation: 'C-01',
      ledger: 5,
      cached: 0,
      difference: -5,
      kind: 'missing_row',
    });
  });

  it('treats goods that arrived and all left again as correctly absent, not missing', () => {
    const nettedOut = [...ledger, { productId: 'milk', binLocation: 'C-01', total: 0 }];
    expect(reconcileBalances(nettedOut, cached)).toEqual([]);
  });

  it('ignores an empty shelf row with no history — there is nothing to disagree about', () => {
    const emptyRow = [...cached, { productId: 'milk', binLocation: 'C-01', quantity: 0 }];
    expect(reconcileBalances(ledger, emptyRow)).toEqual([]);
  });

  it('keeps the same product on two shelves apart', () => {
    // A shelf-level check is the point: a location total can agree while both
    // of its shelves are wrong in opposite directions.
    const swapped: CachedQuantity[] = [
      { productId: 'water', binLocation: 'A-01', quantity: 6 },
      { productId: 'bread', binLocation: 'A-01', quantity: 4 },
      { productId: 'water', binLocation: 'B-02', quantity: 10 },
    ];
    const result = reconcileBalances(ledger, swapped);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.difference).sort()).toEqual([-4, 4]);
  });

  it('puts the largest disagreement first', () => {
    // A hundred one-unit drifts are a different problem from a single case of
    // forty, and an owner wants the one that matters.
    const messy: CachedQuantity[] = [
      { productId: 'water', binLocation: 'A-01', quantity: 11 },
      { productId: 'bread', binLocation: 'A-01', quantity: 44 },
      { productId: 'water', binLocation: 'B-02', quantity: 6 },
    ];
    expect(reconcileBalances(ledger, messy).map((m) => m.productId)).toEqual(['bread', 'water']);
  });
});

describe('summarize', () => {
  it('reports how much was checked and how far it is out', () => {
    const drifted = cached.map((row) =>
      row.productId === 'water' && row.binLocation === 'A-01' ? { ...row, quantity: 7 } : row,
    );
    expect(summarize(ledger, reconcileBalances(ledger, drifted))).toEqual({
      checked: 3,
      mismatched: 1,
      totalDrift: 3,
    });
  });

  it('adds drift in both directions rather than letting it cancel out', () => {
    const swapped: CachedQuantity[] = [
      { productId: 'water', binLocation: 'A-01', quantity: 6 },
      { productId: 'bread', binLocation: 'A-01', quantity: 4 },
      { productId: 'water', binLocation: 'B-02', quantity: 10 },
    ];
    expect(summarize(ledger, reconcileBalances(ledger, swapped)).totalDrift).toBe(8);
  });

  it('reports a clean check as clean', () => {
    expect(summarize(ledger, [])).toEqual({ checked: 3, mismatched: 0, totalDrift: 0 });
  });
});

describe('mismatchExplanation', () => {
  it('names each failure in terms somebody can act on', () => {
    expect(mismatchExplanation('drift')).toBe('Остаток не сходится с журналом движений');
    expect(mismatchExplanation('orphan_row')).toBe('Остаток есть, а движений по нему нет');
    expect(mismatchExplanation('missing_row')).toBe('Движения есть, а строки остатка нет');
  });
});

describe('reconcileBatches', () => {
  it('молчит, когда партии сходятся с остатком', () => {
    expect(reconcileBatches([{ productId: 'pcm', batched: 20 }], [{ productId: 'pcm', quantity: 20 }])).toEqual([]);
  });

  it('молчит, когда партий меньше остатка', () => {
    // Часть товара заведена без партий — это законно, а не расхождение.
    // Требовать серию там, где её не заводили, значило бы сломать обычный
    // магазин ради аптеки.
    expect(reconcileBatches([{ productId: 'pcm', batched: 12 }], [{ productId: 'pcm', quantity: 20 }])).toEqual([]);
  });

  it('называет превышение — товар, который касса предложит, а полка не отдаст', () => {
    expect(reconcileBatches([{ productId: 'pcm', batched: 20 }], [{ productId: 'pcm', quantity: 14 }])).toEqual([
      { productId: 'pcm', batched: 20, stock: 14, excess: 6 },
    ]);
  });

  it('партия без остатка вообще — расхождение на всю партию', () => {
    expect(reconcileBatches([{ productId: 'pcm', batched: 8 }], [])).toEqual([
      { productId: 'pcm', batched: 8, stock: 0, excess: 8 },
    ]);
  });

  it('крупные расхождения идут первыми', () => {
    const out = reconcileBatches(
      [{ productId: 'a', batched: 12 }, { productId: 'b', batched: 30 }],
      [{ productId: 'a', quantity: 10 }, { productId: 'b', quantity: 5 }],
    );
    expect(out.map((row) => row.productId)).toEqual(['b', 'a']);
  });
});

describe('reconcileHolds', () => {
  const row = (over: Partial<HoldRow> = {}): HoldRow => ({
    productId: 'p',
    binLocation: '',
    quantity: 10,
    reserved: 0,
    blocked: 0,
    ...over,
  });

  it('молчит, когда удержано меньше, чем лежит', () => {
    expect(reconcileHolds([row({ reserved: 3, blocked: 2 })])).toEqual([]);
  });

  it('и когда удержано ровно всё — это тоже не расхождение', () => {
    // Полка, занятая целиком под заказ, — обычное дело, а не поломка.
    expect(reconcileHolds([row({ reserved: 10 })])).toEqual([]);
  });

  it('называет превышение', () => {
    expect(reconcileHolds([row({ quantity: 0, blocked: 7 })])).toEqual([
      { productId: 'p', binLocation: '', quantity: 0, reserved: 0, blocked: 7, excess: 7 },
    ]);
  });

  it('считает бронь и блокировку вместе, а не по отдельности', () => {
    // По отдельности каждая помещается, вместе — нет, и продать нельзя ничего.
    expect(reconcileHolds([row({ quantity: 10, reserved: 6, blocked: 6 })])[0].excess).toBe(2);
  });

  it('крупные расхождения первыми', () => {
    const out = reconcileHolds([
      row({ productId: 'a', quantity: 0, blocked: 2 }),
      row({ productId: 'b', quantity: 0, blocked: 9 }),
    ]);
    expect(out.map((r) => r.productId)).toEqual(['b', 'a']);
  });
});

describe('reconcileCodes', () => {
  /**
   * Восьмая книга: коды маркировки против полки.
   *
   * Беда та же, что у партий — товар ушёл, запись осталась, — но запись эта
   * государственная: лишний код на сверке значит упаковку, которая по
   * документам у магазина, а на полке её нет.
   */
  it('молчит, когда кодов столько же, сколько упаковок', () => {
    expect(reconcileCodes([{ productId: 'cig', coded: 20 }], [{ productId: 'cig', quantity: 20 }])).toEqual([]);
  });

  it('и когда кодов меньше — тоже', () => {
    // Товар, купленный до маркировки, лежит без кодов, пока остаток не
    // промаркируют. Это законное состояние, а не расхождение.
    expect(reconcileCodes([{ productId: 'cig', coded: 5 }], [{ productId: 'cig', quantity: 40 }])).toEqual([]);
  });

  it('но говорит, когда кодов больше', () => {
    expect(reconcileCodes([{ productId: 'cig', coded: 7 }], [{ productId: 'cig', quantity: 4 }])).toEqual([
      { productId: 'cig', coded: 7, stock: 4, excess: 3 },
    ]);
  });

  it('и товар, которого на полке нет вовсе, — это весь его код', () => {
    // Полка пуста, а коды остались: ровно то, что оставляет за собой недостача
    // по инвентаризации.
    expect(reconcileCodes([{ productId: 'cig', coded: 2 }], [])).toEqual([
      { productId: 'cig', coded: 2, stock: 0, excess: 2 },
    ]);
  });

  it('и худшее расхождение идёт первым', () => {
    // Владелец читает сверху и до тех пор, пока не надоест.
    const out = reconcileCodes(
      [
        { productId: 'a', coded: 3 },
        { productId: 'b', coded: 30 },
      ],
      [
        { productId: 'a', quantity: 1 },
        { productId: 'b', quantity: 1 },
      ],
    );
    expect(out.map((r) => r.productId)).toEqual(['b', 'a']);
  });
});
