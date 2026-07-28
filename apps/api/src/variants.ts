export interface VariantProductInput {
  id: string;
  parentProductId: string | null;
  variantLabel: string | null;
  stock: number;
}

export interface VariantOption {
  id: string;
  label: string;
  stock: number;
}

export interface VariantGroup<T> {
  product: T;
  variants: VariantOption[];
}

// Groups variant child-products (parentProductId set) under their parent, computing
// a parent tile stock as the max across variants so the grid tile isn't disabled
// just because one specific variant sold out. Orphaned children (parent missing or
// filtered out, e.g. unsellable) are dropped rather than surfaced as top-level tiles.
export function groupProductVariants<T extends VariantProductInput>(products: T[]): VariantGroup<T>[] {
  const childrenByParent = new Map<string, T[]>();
  for (const p of products) {
    if (p.parentProductId) {
      const list = childrenByParent.get(p.parentProductId) ?? [];
      list.push(p);
      childrenByParent.set(p.parentProductId, list);
    }
  }

  return products
    .filter((p) => !p.parentProductId)
    .map((p) => {
      const children = childrenByParent.get(p.id) ?? [];
      const product = children.length > 0 ? { ...p, stock: Math.max(...children.map((c) => c.stock)) } : p;
      return {
        product,
        variants: children.map((c) => ({ id: c.id, label: c.variantLabel ?? c.id, stock: c.stock })),
      };
    });
}
