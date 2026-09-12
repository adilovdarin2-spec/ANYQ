import { describe, it, expect } from 'vitest';
import {
  formatBinCode,
  resolveBinAddress,
  binAddressErrorMessage,
  allocateFromBins,
  allocateRelease,
  validatePutaway,
  putawayErrorMessage,
} from './bins';
import type { BinStock } from './bins';

describe('formatBinCode', () => {
  it('builds the label that is written on the shelf', () => {
    expect(formatBinCode({ zone: 'A', rack: '02', shelf: '03', bin: '04' })).toBe('A-02-03-04');
  });

  it('leaves out levels a warehouse does not use', () => {
    // A shop with a back room and no racking addresses a zone and stops.
    expect(formatBinCode({ zone: 'склад', rack: '', shelf: '', bin: '' })).toBe('СКЛАД');
  });

  it('normalises case, so a label typed in lower case still matches the sign', () => {
    expect(formatBinCode({ zone: 'a', rack: '2', shelf: '', bin: '' })).toBe('A-2');
  });
});

describe('resolveBinAddress', () => {
  it('accepts an address a picker could actually be sent to', () => {
    const result = resolveBinAddress({ zone: 'A', rack: '02', shelf: '03', bin: '04' });
    expect(result).toEqual({
      status: 'ok',
      address: { zone: 'A', rack: '02', shelf: '03', bin: '04' },
      code: 'A-02-03-04',
    });
  });

  it('accepts a zone on its own', () => {
    expect(resolveBinAddress({ zone: 'Склад' }).status).toBe('ok');
  });

  it('requires a zone, which is the one part nothing else implies', () => {
    expect(resolveBinAddress({ rack: '02' })).toEqual({ status: 'missing' });
    expect(resolveBinAddress(undefined)).toEqual({ status: 'missing' });
  });

  it('refuses a deeper level with an empty level above it', () => {
    // "Shelf 3" of no rack is not a place anybody can be sent to.
    expect(resolveBinAddress({ zone: 'A', rack: '', shelf: '03' })).toEqual({ status: 'invalid' });
    expect(resolveBinAddress({ zone: 'A', rack: '02', shelf: '', bin: '04' })).toEqual({ status: 'invalid' });
  });

  it('accepts Cyrillic labels, because that is what is painted on the racks', () => {
    expect(resolveBinAddress({ zone: 'Зал', rack: '1' }).status).toBe('ok');
  });

  it('refuses characters that would not survive being written on a label', () => {
    expect(resolveBinAddress({ zone: 'A/B' })).toEqual({ status: 'invalid' });
    expect(resolveBinAddress({ zone: 'A B' })).toEqual({ status: 'invalid' });
  });

  it('explains which of the two problems it found', () => {
    expect(binAddressErrorMessage('missing')).toBe('Укажите хотя бы зону');
    expect(binAddressErrorMessage('invalid')).toBe('Адрес ячейки заполнен неверно — нельзя пропускать уровни');
  });
});

describe('allocateFromBins', () => {
  const bins: BinStock[] = [
    { stockId: 's1', binCode: 'A-01', available: 10 },
    { stockId: 's2', binCode: 'A-02', available: 3 },
    { stockId: 's3', binCode: 'B-01', available: 6 },
  ];

  it('empties the smallest bin first, so part-full bins do not multiply', () => {
    // A warehouse that always picks from the fullest bin ends up with one item
    // scattered across a dozen of them, and then nobody can find any of it.
    const result = allocateFromBins(8, bins);
    expect(result).toEqual({
      status: 'ok',
      allocations: [
        { stockId: 's2', binCode: 'A-02', quantity: 3 },
        { stockId: 's3', binCode: 'B-01', quantity: 5 },
      ],
    });
  });

  it('takes everything from one bin when one bin covers it', () => {
    expect(allocateFromBins(3, bins)).toEqual({
      status: 'ok',
      allocations: [{ stockId: 's2', binCode: 'A-02', quantity: 3 }],
    });
  });

  it('draws on unplaced stock last — nobody has walked past it', () => {
    const withUnplaced: BinStock[] = [
      { stockId: 's0', binCode: '', available: 100 },
      { stockId: 's1', binCode: 'A-01', available: 4 },
    ];
    const result = allocateFromBins(6, withUnplaced);
    expect(result.status === 'ok' && result.allocations.map((a) => a.binCode)).toEqual(['A-01', '']);
  });

  it('picks the same bins for the same request twice, so a picker is not sent wandering', () => {
    const tied: BinStock[] = [
      { stockId: 's1', binCode: 'B-01', available: 5 },
      { stockId: 's2', binCode: 'A-01', available: 5 },
    ];
    expect(allocateFromBins(5, tied)).toEqual(allocateFromBins(5, tied));
    expect(allocateFromBins(5, tied).status === 'ok' && allocateFromBins(5, tied).status).toBe('ok');
  });

  it('reports what is really there when the bins cannot cover the request', () => {
    expect(allocateFromBins(100, bins)).toEqual({ status: 'insufficient', available: 19 });
  });

  it('ignores empty bins rather than allocating zero out of them', () => {
    const withEmpty: BinStock[] = [...bins, { stockId: 's4', binCode: 'C-01', available: 0 }];
    const result = allocateFromBins(3, withEmpty);
    expect(result.status === 'ok' && result.allocations).toEqual([
      { stockId: 's2', binCode: 'A-02', quantity: 3 },
    ]);
  });

  it('reports nothing available when there are no bins at all', () => {
    expect(allocateFromBins(1, [])).toEqual({ status: 'insufficient', available: 0 });
  });
});

describe('validatePutaway', () => {
  it('allows moving goods to another bin in the same building', () => {
    expect(validatePutaway({ quantity: 5, fromBinCode: '', toBinCode: 'A-01', availableInSource: 10 })).toEqual({
      status: 'ok',
    });
  });

  it('refuses moving more than the source bin actually has free', () => {
    expect(validatePutaway({ quantity: 12, fromBinCode: '', toBinCode: 'A-01', availableInSource: 10 })).toEqual({
      status: 'insufficient',
      available: 10,
    });
  });

  it('refuses a move that goes nowhere', () => {
    expect(validatePutaway({ quantity: 1, fromBinCode: 'A-01', toBinCode: 'A-01', availableInSource: 10 })).toEqual({
      status: 'same',
    });
  });

  it('refuses a quantity that is not a positive number', () => {
    expect(validatePutaway({ quantity: 0, fromBinCode: '', toBinCode: 'A-01', availableInSource: 10 })).toEqual({
      status: 'invalid',
    });
    expect(validatePutaway({ quantity: NaN, fromBinCode: '', toBinCode: 'A-01', availableInSource: 10 })).toEqual({
      status: 'invalid',
    });
  });

  it('says how much could have been moved', () => {
    expect(putawayErrorMessage({ status: 'insufficient', available: 10 })).toBe(
      'В исходной ячейке свободно 10 — переместить больше нельзя',
    );
  });
});

describe('allocateRelease', () => {
  it('снимает бронь оттуда, где она стоит', () => {
    const rows = [
      { stockId: 'a', reserved: 0 },
      { stockId: 'b', reserved: 4 },
    ];
    expect(allocateRelease(4, rows)).toEqual([{ stockId: 'b', quantity: 4 }]);
  });

  it('разносит снятие по нескольким ячейкам', () => {
    const rows = [
      { stockId: 'a', reserved: 3 },
      { stockId: 'b', reserved: 5 },
    ];
    // Сначала та, где брони больше.
    expect(allocateRelease(7, rows)).toEqual([
      { stockId: 'b', quantity: 5 },
      { stockId: 'a', quantity: 2 },
    ]);
  });

  it('не снимает с ячейки больше, чем в ней забронировано', () => {
    const rows = [{ stockId: 'a', reserved: 2 }];
    expect(allocateRelease(10, rows)).toEqual([{ stockId: 'a', quantity: 2 }]);
  });

  it('без брони ничего не снимает и не падает', () => {
    // Повторное снятие — обычное дело: заказ можно отменить после выдачи
    // только один раз, но код, который это делает, вызывается и там, и там.
    expect(allocateRelease(5, [{ stockId: 'a', reserved: 0 }])).toEqual([]);
    expect(allocateRelease(5, [])).toEqual([]);
  });

  it('лишних строк не трогает', () => {
    const rows = [
      { stockId: 'a', reserved: 10 },
      { stockId: 'b', reserved: 10 },
    ];
    expect(allocateRelease(4, rows)).toEqual([{ stockId: 'a', quantity: 4 }]);
  });
});
