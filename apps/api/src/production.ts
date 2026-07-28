export interface ProductionIngredientInput {
  ingredientId: string;
  quantity: number;
}

export interface ProductionIngredientConsumption {
  ingredientId: string;
  quantity: number;
}

export interface ProductionResult {
  batches: number;
  yieldQuantity: number;
  ingredients: ProductionIngredientConsumption[];
}

// A recipe defines ingredient quantities for one "batch" that yields
// `portionYield` finished units. Producing a requested quantity that isn't an
// exact multiple of portionYield rounds up to a whole number of batches —
// you can't run half a batch — so the actual yield can exceed what was asked
// for; the caller decides what to do with the surplus (here: just credit it
// to stock like anything else produced).
export function computeProduction(
  desiredQuantity: number,
  portionYield: number,
  ingredients: ProductionIngredientInput[],
): ProductionResult {
  const batches = Math.max(Math.ceil(desiredQuantity / portionYield), 0);
  const yieldQuantity = batches * portionYield;
  return {
    batches,
    yieldQuantity,
    ingredients: ingredients.map((ing) => ({ ingredientId: ing.ingredientId, quantity: ing.quantity * batches })),
  };
}
