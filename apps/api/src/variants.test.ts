import { describe, it, expect } from 'vitest';
import { groupProductVariants } from './variants';

describe('groupProductVariants', () => {
  it('returns a plain product unchanged when it has no variants', () => {
    const result = groupProductVariants([{ id: 'p1', parentProductId: null, variantLabel: null, stock: 10 }]);
    expect(result).toEqual([{ product: { id: 'p1', parentProductId: null, variantLabel: null, stock: 10 }, variants: [] }]);
  });

  it('groups children under their parent and drops them from the top-level list', () => {
    const products = [
      { id: 'shirt', parentProductId: null, variantLabel: null, stock: 0 },
      { id: 'shirt-s', parentProductId: 'shirt', variantLabel: 'S', stock: 5 },
      { id: 'shirt-m', parentProductId: 'shirt', variantLabel: 'M', stock: 3 },
    ];
    const result = groupProductVariants(products);
    expect(result).toHaveLength(1);
    expect(result[0].product.id).toBe('shirt');
    expect(result[0].variants).toEqual([
      { id: 'shirt-s', label: 'S', stock: 5 },
      { id: 'shirt-m', label: 'M', stock: 3 },
    ]);
  });

  it('sets the parent tile stock to the max across its variants', () => {
    const products = [
      { id: 'shirt', parentProductId: null, variantLabel: null, stock: 0 },
      { id: 'shirt-s', parentProductId: 'shirt', variantLabel: 'S', stock: 5 },
      { id: 'shirt-m', parentProductId: 'shirt', variantLabel: 'M', stock: 12 },
    ];
    expect(groupProductVariants(products)[0].product.stock).toBe(12);
  });

  it('drops orphaned children whose parent is not in the list', () => {
    const products = [{ id: 'orphan-variant', parentProductId: 'missing-parent', variantLabel: 'L', stock: 4 }];
    expect(groupProductVariants(products)).toEqual([]);
  });

  it('keeps unrelated top-level products separate', () => {
    const products = [
      { id: 'shirt', parentProductId: null, variantLabel: null, stock: 0 },
      { id: 'shirt-s', parentProductId: 'shirt', variantLabel: 'S', stock: 5 },
      { id: 'bread', parentProductId: null, variantLabel: null, stock: 20 },
    ];
    const result = groupProductVariants(products);
    expect(result.map((g) => g.product.id)).toEqual(['shirt', 'bread']);
    expect(result[1].variants).toEqual([]);
  });
});
