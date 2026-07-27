export interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  unit: string;
  category: string;
  stock: number;
}

export interface Catalog {
  company: { id: string; name: string };
  products: CatalogProduct[];
}

export interface CartLine {
  productId: string;
  name: string;
  price: number;
  unit: string;
  qty: number;
  maxStock: number;
}
