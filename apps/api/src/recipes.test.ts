import { describe, it, expect } from 'vitest';
import { computeIngredientConsumption, computeDishCost } from './recipes';

describe('computeIngredientConsumption', () => {
  it('scales ingredient quantities by how many portions were sold', () => {
    const recipes = new Map([['pizza', [{ ingredientId: 'dough', quantity: 200 }, { ingredientId: 'cheese', quantity: 80 }]]]);
    const result = computeIngredientConsumption([{ productId: 'pizza', quantity: 3 }], recipes);
    expect(result).toEqual(
      expect.arrayContaining([
        { ingredientId: 'dough', quantity: 600 },
        { ingredientId: 'cheese', quantity: 240 },
      ]),
    );
  });

  it('aggregates a shared ingredient across multiple dishes in the same sale', () => {
    const recipes = new Map([
      ['pizza', [{ ingredientId: 'cheese', quantity: 80 }]],
      ['pasta', [{ ingredientId: 'cheese', quantity: 30 }]],
    ]);
    const result = computeIngredientConsumption(
      [
        { productId: 'pizza', quantity: 1 },
        { productId: 'pasta', quantity: 2 },
      ],
      recipes,
    );
    expect(result).toEqual([{ ingredientId: 'cheese', quantity: 140 }]);
  });

  it('ignores products with no recipe (plain, non-dish items)', () => {
    const recipes = new Map([['pizza', [{ ingredientId: 'dough', quantity: 200 }]]]);
    const result = computeIngredientConsumption(
      [
        { productId: 'pizza', quantity: 1 },
        { productId: 'cola', quantity: 2 },
      ],
      recipes,
    );
    expect(result).toEqual([{ ingredientId: 'dough', quantity: 200 }]);
  });

  it('returns an empty list when nothing sold has a recipe', () => {
    expect(computeIngredientConsumption([{ productId: 'cola', quantity: 5 }], new Map())).toEqual([]);
  });
});

describe('computeDishCost', () => {
  it('sums ingredient quantity times purchase price', () => {
    const prices = new Map([['dough', 2], ['cheese', 10]]);
    const cost = computeDishCost(
      [
        { ingredientId: 'dough', quantity: 200 },
        { ingredientId: 'cheese', quantity: 80 },
      ],
      prices,
    );
    expect(cost).toBe(200 * 2 + 80 * 10);
  });

  it('treats an ingredient with no known purchase price as free rather than throwing', () => {
    const cost = computeDishCost([{ ingredientId: 'mystery', quantity: 50 }], new Map());
    expect(cost).toBe(0);
  });

  it('returns 0 for a recipe with no ingredients', () => {
    expect(computeDishCost([], new Map())).toBe(0);
  });
});
