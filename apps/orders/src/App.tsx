import { useEffect, useState } from 'react';
import type { CartLine, Catalog, CatalogProduct } from './types';
import { fetchCatalog, placeOrder, ApiError } from './api';
import { Header } from './components/Header';
import { CatalogView } from './components/CatalogView';
import { CartBar } from './components/CartBar';
import { CheckoutSheet } from './components/CheckoutSheet';
import { SuccessScreen } from './components/SuccessScreen';
import { StateScreen } from './components/StateScreen';

type View = 'catalog' | 'checkout' | 'success';

function getCompanyId(): string | null {
  const segment = window.location.pathname.replace(/^\/+/, '').split('/')[0];
  return segment ? decodeURIComponent(segment) : null;
}

export default function App() {
  const [companyId] = useState<string | null>(getCompanyId);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [view, setView] = useState<View>('catalog');
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('Все');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    fetchCatalog(companyId)
      .then((data) => setCatalog(data))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Не удалось загрузить каталог'))
      .finally(() => setLoading(false));
  }, [companyId]);

  function addToCart(product: CatalogProduct) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) return prev;
      return [...prev, { productId: product.id, name: product.name, price: product.price, unit: product.unit, qty: 1, maxStock: product.stock }];
    });
  }

  function changeQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, qty: Math.min(l.qty + delta, l.maxStock) } : l))
        .filter((l) => l.qty > 0),
    );
  }

  async function handleSubmitOrder(customerName: string, customerPhone: string) {
    if (!companyId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await placeOrder(companyId, {
        customerName,
        customerPhone,
        items: cart.map((l) => ({ productId: l.productId, quantity: l.qty })),
      });
      setCart([]);
      setView('success');
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Не удалось отправить заказ');
    } finally {
      setSubmitting(false);
    }
  }

  if (!companyId) {
    return (
      <div className="app-shell">
        <StateScreen
          title="Ссылка на заказ"
          message="Чтобы сделать заказ, перейдите по ссылке, которую вам прислал ваш поставщик — она ведёт на страницу конкретного склада."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app-shell">
        <StateScreen title="Загрузка каталога…" message="Секунду, подгружаем товары и остатки." />
      </div>
    );
  }

  if (loadError || !catalog) {
    return (
      <div className="app-shell">
        <StateScreen title="Каталог недоступен" message={loadError ?? 'Склад не найден'} />
      </div>
    );
  }

  const categories = ['Все', ...Array.from(new Set(catalog.products.map((p) => p.category || 'Без категории')))];
  const cartQtyByProduct = Object.fromEntries(cart.map((l) => [l.productId, l.qty]));
  const cartTotal = cart.reduce((sum, l) => sum + l.price * l.qty, 0);
  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0);

  return (
    <div className="app-shell">
      <Header companyName={catalog.company.name} />
      <CatalogView
        products={catalog.products}
        categories={categories}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        query={query}
        onQueryChange={setQuery}
        cartQtyByProduct={cartQtyByProduct}
        onAdd={addToCart}
        onChangeQty={changeQty}
      />
      {cartCount > 0 && view === 'catalog' && <CartBar count={cartCount} total={cartTotal} onOpen={() => setView('checkout')} />}

      {view === 'checkout' && (
        <CheckoutSheet
          cart={cart}
          total={cartTotal}
          submitting={submitting}
          error={submitError}
          onBack={() => setView('catalog')}
          onSubmit={handleSubmitOrder}
        />
      )}

      {view === 'success' && <SuccessScreen companyName={catalog.company.name} onNewOrder={() => setView('catalog')} />}
    </div>
  );
}
