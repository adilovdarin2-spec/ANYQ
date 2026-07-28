export interface RecipeIngredientInput {
  ingredientId: string;
  quantity: number;
}

export interface SaleLineInput {
  productId: string;
  quantity: number;
}

export interface IngredientConsumption {
  ingredientId: string;
  quantity: number;
}

export function computeIngredientConsumption(
  saleLines: SaleLineInput[],
  recipesByProductId: Map<string, RecipeIngredientInput[]>,
): IngredientConsumption[] {
  const totals = new Map<string, number>();

  for (const line of saleLines) {
    const ingredients = recipesByProductId.get(line.productId);
    if (!ingredients) continue;
    for (const ing of ingredients) {
      const needed = ing.quantity * line.quantity;
      totals.set(ing.ingredientId, (totals.get(ing.ingredientId) ?? 0) + needed);
    }
  }

  return [...totals.entries()].map(([ingredientId, quantity]) => ({ ingredientId, quantity }));
}

export function computeDishCost(
  ingredients: RecipeIngredientInput[],
  purchasePriceByIngredientId: Map<string, number>,
): number {
  return ingredients.reduce((sum, ing) => sum + ing.quantity * (purchasePriceByIngredientId.get(ing.ingredientId) ?? 0), 0);
}
