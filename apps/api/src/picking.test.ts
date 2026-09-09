import { describe, it, expect } from 'vitest';
import {
  orderStage,
  orderStageLabel,
  pickErrorMessage,
  resolvePick,
  resolveShipment,
} from './picking';
import type { OrderedLine, ResolvedPick } from './picking';

const line = (over: Partial<OrderedLine> = {}): OrderedLine => ({
  productId: 'water',
  quantity: 10,
  pickedQuantity: null,
  onHand: 50,
  ...over,
});

describe('picking an order', () => {
  it('records what was found', () => {
    const result = resolvePick([line({ quantity: 10 })], [{ productId: 'water', quantity: 9 }]);
    expect(result).toEqual({
      status: 'ok',
      lines: [{ productId: 'water', ordered: 10, picked: 9, shortfall: 1, touched: true }],
      complete: false,
      shortfall: 1,
    });
  });

  it('calls a full pick complete', () => {
    const result = resolvePick([line({ quantity: 10 })], [{ productId: 'water', quantity: 10 }]);
    expect(result).toMatchObject({ complete: true, shortfall: 0 });
  });

  it('treats zero as a finding, not as nothing', () => {
    // It is how a picker says "this is not there", which is a different claim
    // from not mentioning the line at all.
    const result = resolvePick([line({ quantity: 10 })], [{ productId: 'water', quantity: 0 }]);
    expect(result).toMatchObject({
      status: 'ok',
      lines: [{ productId: 'water', ordered: 10, picked: 0, shortfall: 10 }],
    });
  });

  it('keeps racks already walked when a later rack is submitted', () => {
    // A picker works rack by rack, and a partial submission must not undo the
    // earlier ones.
    const result = resolvePick(
      [
        line({ productId: 'water', quantity: 10, pickedQuantity: 10 }),
        line({ productId: 'bread', quantity: 5, pickedQuantity: null }),
      ],
      [{ productId: 'bread', quantity: 5 }],
    );
    expect(result).toMatchObject({
      status: 'ok',
      lines: [
        { productId: 'water', picked: 10 },
        { productId: 'bread', picked: 5 },
      ],
      complete: true,
    });
  });

  it('lets a picker correct themselves downwards', () => {
    const result = resolvePick(
      [line({ quantity: 10, pickedQuantity: 10 })],
      [{ productId: 'water', quantity: 7 }],
    );
    expect(result).toMatchObject({ lines: [{ picked: 7, shortfall: 3 }] });
  });

  it('refuses more than was ordered', () => {
    const result = resolvePick([line({ quantity: 10 })], [{ productId: 'water', quantity: 11 }]);
    expect(result).toEqual({ status: 'moreThanOrdered', productId: 'water', ordered: 10 });
  });

  it('refuses a product the order does not contain', () => {
    const result = resolvePick([line()], [{ productId: 'bread', quantity: 1 }]);
    expect(result).toEqual({ status: 'notOrdered', productId: 'bread' });
  });

  it('refuses more than is physically on the shelf', () => {
    const result = resolvePick([line({ quantity: 10, onHand: 4 })], [{ productId: 'water', quantity: 6 }]);
    expect(result).toEqual({ status: 'notOnShelf', productId: 'water', onHand: 4 });
  });

  it('checks against what is there, not against what is unreserved', () => {
    // The units this order is about to take are the ones it reserved when it
    // was placed, so its own hold must not read as somebody else's claim.
    const result = resolvePick([line({ quantity: 10, onHand: 10 })], [{ productId: 'water', quantity: 10 }]);
    expect(result).toMatchObject({ status: 'ok', complete: true });
  });

  it('adds two lines of the same product rather than checking them apart', () => {
    const result = resolvePick([line({ quantity: 10 })], [
      { productId: 'water', quantity: 6 },
      { productId: 'water', quantity: 6 },
    ]);
    expect(result).toEqual({ status: 'moreThanOrdered', productId: 'water', ordered: 10 });
  });

  it('refuses a negative quantity', () => {
    expect(resolvePick([line()], [{ productId: 'water', quantity: -1 }])).toEqual({
      status: 'badQuantity',
      reason: 'negative',
    });
  });

  it('tells a missing quantity apart from a negative one', () => {
    // A client sending the wrong field name, or an empty box read as undefined,
    // used to be told its number was negative. Nobody reading that inspects
    // their field names — they inspect their numbers, and the numbers are fine.
    const missing = { productId: 'water' } as unknown as { productId: string; quantity: number };
    expect(resolvePick([line()], [missing])).toEqual({ status: 'badQuantity', reason: 'missing' });
    expect(resolvePick([line()], [{ productId: 'water', quantity: Number.NaN }])).toEqual({
      status: 'badQuantity',
      reason: 'missing',
    });
  });

  it('refuses an empty submission', () => {
    expect(resolvePick([line()], [])).toEqual({ status: 'empty' });
  });

  it('marks an untouched line as untouched, so a zero is never stored for it', () => {
    // "Looked and found none" and "nobody has been there yet" are different
    // claims, and a picker resuming tomorrow needs to know which is which.
    const result = resolvePick(
      [line({ productId: 'water', quantity: 10 }), line({ productId: 'bread', quantity: 5 })],
      [{ productId: 'water', quantity: 10 }],
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.lines.find((l) => l.productId === 'water')).toMatchObject({ touched: true });
    expect(result.lines.find((l) => l.productId === 'bread')).toMatchObject({ touched: false, picked: 0 });
  });

  it('counts an untouched line as short, so the order is not called complete', () => {
    const result = resolvePick(
      [line({ productId: 'water', quantity: 10 }), line({ productId: 'bread', quantity: 5 })],
      [{ productId: 'water', quantity: 10 }],
    );
    expect(result).toMatchObject({ complete: false, shortfall: 5 });
  });

  it('keeps a line touched once it has been picked before', () => {
    const result = resolvePick(
      [line({ productId: 'water', quantity: 10, pickedQuantity: 3 }), line({ productId: 'bread', quantity: 5 })],
      [{ productId: 'bread', quantity: 5 }],
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.lines.find((l) => l.productId === 'water')).toMatchObject({ touched: true, picked: 3 });
  });

  it('adds up the shortfall across several lines', () => {
    const result = resolvePick(
      [line({ productId: 'water', quantity: 10 }), line({ productId: 'bread', quantity: 5 })],
      [{ productId: 'water', quantity: 8 }, { productId: 'bread', quantity: 3 }],
    );
    expect(result).toMatchObject({ shortfall: 4, complete: false });
  });
});

describe('shipping what was picked', () => {
  const picked = (over: Partial<ResolvedPick>): ResolvedPick => ({
    productId: 'water',
    ordered: 10,
    picked: 10,
    shortfall: 0,
    touched: true,
    ...over,
  });

  it('ships the picked units', () => {
    const result = resolveShipment([picked({ picked: 9, shortfall: 1 })]);
    expect(result).toMatchObject({ status: 'ok', shipped: 9 });
  });

  it('releases the hold on what was not found', () => {
    // Doing only the shipping leaves the shelf quietly smaller than it is:
    // goods held for an order that has already shipped and will never claim
    // them, invisible until a count disagrees with what the register sells.
    const result = resolveShipment([picked({ picked: 9, shortfall: 1 })]);
    expect(result).toMatchObject({ released: 1 });
  });

  it('leaves nothing held when the pick was complete', () => {
    expect(resolveShipment([picked({ picked: 10, shortfall: 0 })])).toMatchObject({ released: 0 });
  });

  it('drops lines where nothing was found, rather than shipping a zero', () => {
    const result = resolveShipment([
      picked({ productId: 'water', picked: 9, shortfall: 1 }),
      picked({ productId: 'bread', ordered: 5, picked: 0, shortfall: 5 }),
    ]);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.lines.map((l) => l.productId)).toEqual(['water']);
    expect(result.released).toBe(6);
  });

  it('refuses to ship an order where nothing at all was found', () => {
    // An empty shipment is not a shipment; it is a cancellation somebody has
    // to decide on.
    const result = resolveShipment([picked({ picked: 0, shortfall: 10 })]);
    expect(result).toEqual({ status: 'nothingPicked' });
  });
});

describe('where an order stands', () => {
  it('is waiting before anybody has walked the shelves', () => {
    expect(orderStage('pending', [{ quantity: 10, pickedQuantity: null }])).toBe('pending');
  });

  it('is being picked once one line has a figure', () => {
    expect(orderStage('pending', [
      { quantity: 10, pickedQuantity: 4 },
      { quantity: 5, pickedQuantity: null },
    ])).toBe('picking');
  });

  it('is still being picked when a line came up short', () => {
    // Short is not finished: somebody has to decide whether to ship it or
    // chase the rest.
    expect(orderStage('pending', [{ quantity: 10, pickedQuantity: 9 }])).toBe('picking');
  });

  it('is picked when every line is covered', () => {
    expect(orderStage('pending', [
      { quantity: 10, pickedQuantity: 10 },
      { quantity: 5, pickedQuantity: 5 },
    ])).toBe('picked');
  });

  it('counts a zero pick as started, not as untouched', () => {
    // "I looked and it is not there" is work done, and an order that falls
    // back to "waiting" loses it.
    expect(orderStage('pending', [{ quantity: 10, pickedQuantity: 0 }])).toBe('picking');
  });

  it('reads the document status for the ends of the story', () => {
    expect(orderStage('confirmed', [{ quantity: 10, pickedQuantity: 9 }])).toBe('shipped');
    expect(orderStage('cancelled', [{ quantity: 10, pickedQuantity: null }])).toBe('cancelled');
  });

  it('names every stage for somebody reading a list', () => {
    expect(orderStageLabel('picking')).toBe('Собирается');
    expect(orderStageLabel('shipped')).toBe('Отгружен');
  });
});

describe('what the picker is told', () => {
  it('says how many the order actually holds', () => {
    expect(pickErrorMessage({ status: 'moreThanOrdered', productId: 'water', ordered: 10 })).toContain('10');
  });

  it('says how many are on the shelf', () => {
    expect(pickErrorMessage({ status: 'notOnShelf', productId: 'water', onHand: 4 })).toContain('4');
  });
});
