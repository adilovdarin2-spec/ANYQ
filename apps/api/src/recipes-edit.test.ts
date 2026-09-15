import { describe, expect, it } from 'vitest';
import { recipeRefusal } from './recipes-edit';

const KNOWN = new Set(['dish', 'flour', 'water', 'salt']);

describe('спецификация производства', () => {
  it('нормальная проходит', () => {
    expect(recipeRefusal('dish', 10, [{ ingredientId: 'flour', quantity: 2 }], KNOWN)).toBeNull();
  });

  it('дробное количество — это норма', () => {
    // Фасовка: четверть килограмма ореха на пачку. Целые числа здесь были бы
    // тем же самым, чем они были для партий, — молчаливым округлением.
    expect(recipeRefusal('dish', 1, [{ ingredientId: 'flour', quantity: 0.25 }], KNOWN)).toBeNull();
  });

  it('без составляющих — не спецификация', () => {
    expect(recipeRefusal('dish', 10, [], KNOWN)).toContain('хотя бы одну');
  });

  it('нулевой выход — это деление на ноль при расчёте', () => {
    expect(recipeRefusal('dish', 0, [{ ingredientId: 'flour', quantity: 1 }], KNOWN)).toContain('больше нуля');
    expect(recipeRefusal('dish', -3, [{ ingredientId: 'flour', quantity: 1 }], KNOWN)).toContain('больше нуля');
  });

  it('товар из самого себя — опечатка, а не рецепт', () => {
    // Расчёт не зациклится: он разворачивает рецепт на один шаг. Но
    // производство спишет то же, что произвело, и остаток не сдвинется при
    // израсходованном сырье.
    expect(recipeRefusal('dish', 10, [{ ingredientId: 'dish', quantity: 1 }], KNOWN)).toContain('самого себя');
  });

  it('один ингредиент дважды — промах пальцем', () => {
    const refusal = recipeRefusal(
      'dish',
      10,
      [
        { ingredientId: 'flour', quantity: 1 },
        { ingredientId: 'flour', quantity: 2 },
      ],
      KNOWN,
    );
    expect(refusal).toContain('дважды');
  });

  it('чужой товар не становится составляющей', () => {
    // Набор известных товаров собирается по компании. Без этой проверки в
    // спецификацию можно вписать товар соседнего магазина по одному id.
    expect(recipeRefusal('dish', 10, [{ ingredientId: 'чужой', quantity: 1 }], KNOWN)).toContain('не найдена');
    expect(recipeRefusal('чужой', 10, [{ ingredientId: 'flour', quantity: 1 }], KNOWN)).toContain('не найден');
  });

  it('и количество ноль или минус — тоже отказ', () => {
    expect(recipeRefusal('dish', 10, [{ ingredientId: 'flour', quantity: 0 }], KNOWN)).toContain('больше нуля');
    expect(recipeRefusal('dish', 10, [{ ingredientId: 'flour', quantity: -1 }], KNOWN)).toContain('больше нуля');
    expect(recipeRefusal('dish', 10, [{ ingredientId: 'flour', quantity: Number.NaN }], KNOWN)).toContain('больше нуля');
  });
});
