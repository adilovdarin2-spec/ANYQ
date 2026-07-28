import { describe, it, expect } from 'vitest';
import { computeProduction } from './production';

describe('computeProduction', () => {
  it('computes exactly one batch when the request matches portionYield', () => {
    const result = computeProduction(10, 10, [{ ingredientId: 'sugar-bulk', quantity: 10 }]);
    expect(result).toEqual({ batches: 1, yieldQuantity: 10, ingredients: [{ ingredientId: 'sugar-bulk', quantity: 10 }] });
  });

  it('rounds up to a whole batch when the request is not a multiple of portionYield', () => {
    const result = computeProduction(7, 5, [{ ingredientId: 'sugar-bulk', quantity: 5 }]);
    expect(result).toEqual({ batches: 2, yieldQuantity: 10, ingredients: [{ ingredientId: 'sugar-bulk', quantity: 10 }] });
  });

  it('handles a 1:1 portionYield (typical repackaging case)', () => {
    const result = computeProduction(20, 1, [{ ingredientId: 'sugar-bulk', quantity: 1 }]);
    expect(result).toEqual({ batches: 20, yieldQuantity: 20, ingredients: [{ ingredientId: 'sugar-bulk', quantity: 20 }] });
  });

  it('scales every ingredient in a multi-ingredient recipe by the same batch count', () => {
    const result = computeProduction(6, 3, [
      { ingredientId: 'flour', quantity: 100 },
      { ingredientId: 'water', quantity: 50 },
    ]);
    expect(result.batches).toBe(2);
    expect(result.ingredients).toEqual([
      { ingredientId: 'flour', quantity: 200 },
      { ingredientId: 'water', quantity: 100 },
    ]);
  });

  it('treats a zero or negative request as zero batches rather than throwing', () => {
    expect(computeProduction(0, 5, [{ ingredientId: 'x', quantity: 5 }])).toEqual({
      batches: 0,
      yieldQuantity: 0,
      ingredients: [{ ingredientId: 'x', quantity: 0 }],
    });
    expect(computeProduction(-3, 5, [{ ingredientId: 'x', quantity: 5 }]).batches).toBe(0);
  });
});
