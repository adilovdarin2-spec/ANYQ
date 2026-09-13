import { useEffect, useState } from 'react';
import type { CartLine, Catalog, CatalogProduct } from './types';
import { fetchCatalog, placeOrder, ApiError } from './api';
import { Header } from './components/Header';
import { CatalogView } from './components/CatalogView';
import { CartBar } from './components/CartBar';
import { CartSidebar } from './components/CartSidebar';
import { CheckoutSheet } from './components/CheckoutSheet';
import { SuccessScreen } from './components/SuccessScreen';
import { StateScreen } from './components/StateScreen';
import { LandingPage } from './components/LandingPage';
import { InstallPrompt } from './components/InstallPrompt';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import { Cabinet } from './components/Cabinet';

type View = 'catalog' | 'checkout' | 'success';

/**
 * `/k/<секрет>` — кабинет владельца, а не витрина склада.
 *
 * Отдельный префикс, а не отдельное приложение: пятая служба на платформе ради
 * одного экрана не стоит того. Префикс из одной буквы выбран, чтобы ссылку было
 * не тяжело продиктовать по телефону — она и так длинная.
 */
function getCabinetSecret(): string | null {
  const parts = window.location.pathname.replace(/^\/+/, '').split('/');
  return parts[0] === 'k' && parts[1] ? decodeURIComponent(parts[1]) : null;
}

function getCompanyId(): string | null {
  const segment = window.location.pathname.replace(/^\/+/, '').split('/')[0];
  if (!segment || segment === 'k') return null;
  return decodeURIComponent(segment);
}

export default function App() {
  const [cabinetSecret] = useState<string | null>(getCabinetSecret);
  const [companyId] = useState<string | null>(getCompanyId);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [view, setView] = useState<View>('catalog');
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('Все');
  const [submitting, setSubmitting] = useState(false);
  /** Номер отправленного заказа — его показывают на экране «спасибо». */
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Названия строк корзины, которых больше нет в каталоге. */
  const [staleLines, setStaleLines] = useState<string[]>([]);
  const install = useInstallPrompt();

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

  useEffect(() => {
    if (!catalog) return;
    document.title = `${catalog.company.name} — заказ поставщику · ANYQ`;
    document.querySelector('meta[name="description"]')?.setAttribute(
      'content',
      `Закажите товары у ${catalog.company.name} онлайн — остатки в реальном времени, подтверждение в WhatsApp.`,
    );
  }, [catalog]);

  /**
   * Перечитать каталог и сказать, каких строк корзины в нём больше нет.
   *
   * Сама корзина не трогается: заказ чужой, и вычёркивать из него строки за
   * человека — это ровно то, чем занимался сервер, когда молча выбрасывал их
   * из заказа.
   */
  async function refreshCatalogAndMarkStale() {
    if (!companyId) return;
    try {
      const fresh = await fetchCatalog(companyId);
      setCatalog(fresh);

      const offered = new Map(fresh.products.map((p) => [p.id, p]));
      const проблемы: string[] = [];
      for (const line of cart) {
        const product = offered.get(line.productId);
        if (!product) {
          проблемы.push(line.name);
          continue;
        }
        // Остаток мог упасть, пока страница была открыта: заказ на большее
        // сервер всё равно не примет, и лучше это знать здесь.
        if (line.qty > product.stock) {
          проблемы.push(`${line.name} — осталось ${product.stock} ${product.unit}`);
        }
      }
      // Потолок в строке тоже подтягиваем: иначе «+» продолжал бы разрешать
      // количество, которого на складе уже нет.
      setCart((prev) =>
        prev.map((line) => {
          const product = offered.get(line.productId);
          return product ? { ...line, maxStock: product.stock, price: product.price } : line;
        }),
      );
      setStaleLines(проблемы);
    } catch {
      // Каталог не перечитался — сообщение об отказе уже показано, и второе
      // сообщение про неудачную перезагрузку человеку ничем не поможет.
    }
  }

  function addToCart(product: CatalogProduct) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) return prev;
      return [...prev, { productId: product.id, name: product.name, price: product.price, unit: product.unit, qty: 1, maxStock: product.stock }];
    });
  }

  /**
   * Количество, набранное числом, а не плюсиком.
   *
   * Витрина оптовая: заказывают мешками и дюжинами. Двенадцать нажатий на «+»
   * ради двенадцати мешков — это не мелкое неудобство, а причина, по которой
   * закупщик закроет вкладку и позвонит по телефону, как звонил раньше.
   *
   * Ноль убирает строку, остаток ограничивает сверху: витрина обещает то, что
   * лежит на складе, и принять заказ на большее значило бы пообещать за
   * поставщика то, чего у него нет.
   */
  function setQty(productId: string, qty: number) {
    setStaleLines([]);
    setCart((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, qty: Math.min(Math.max(qty, 0), l.maxStock) } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function changeQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, qty: Math.min(l.qty + delta, l.maxStock) } : l))
        .filter((l) => l.qty > 0),
    );
  }

  async function handleSubmitOrder(customerName: string, customerPhone: string, deliveryAddress: string) {
    if (!companyId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const placed = await placeOrder(companyId, {
        customerName,
        customerPhone,
        deliveryAddress,
        items: cart.map((l) => ({ productId: l.productId, quantity: l.qty })),
      });
      setOrderNumber(placed.number ?? null);
      setCart([]);
      setView('success');
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Не удалось отправить заказ');
      // Отказ «часть товаров больше не продаётся» означает, что страница
      // открыта со вчера. Просить обновить её и оставить всё как есть —
      // значит требовать от закупщика самому угадать, какая из десяти строк
      // лишняя. Перечитываем каталог и называем те строки, которых в нём
      // больше нет; убирает их он сам — это его заказ.
      if (err instanceof ApiError && err.status === 409 && companyId) {
        await refreshCatalogAndMarkStale();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (cabinetSecret) {
    return (
      <div className="app-shell">
        <Cabinet secret={cabinetSecret} />
      </div>
    );
  }

  if (!companyId) {
    // No install prompt here — "put this shop on your home screen" makes no
    // sense before a visitor has even picked a supplier to order from.
    return (
      <div className="app-shell">
        <LandingPage />
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

      {/* Под шапкой и в потоке — не поверх каталога.
          Раньше баннер был закреплён снизу и закрывал две строки товаров; чтобы
          это не било по первому впечатлению, его показывали только с непустой
          корзиной. Закрывать он больше ничего не может, а условие осталось, и
          причина у него теперь другая и честная: тот, кто уже набирает заказ,
          ярлыку на экране рад, а зашедшему впервые предлагать установку рано. */}
      {cart.length > 0 && <InstallPrompt {...install} />}

      <div className="storefront-layout">
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
          onSetQty={setQty}
        />
        <CartSidebar cart={cart} total={cartTotal} onChangeQty={changeQty} onSetQty={setQty} onCheckout={() => setView('checkout')} />
      </div>
      {cartCount > 0 && view === 'catalog' && <CartBar count={cartCount} total={cartTotal} onOpen={() => setView('checkout')} />}

      {view === 'checkout' && (
        <CheckoutSheet
          cart={cart}
          total={cartTotal}
          submitting={submitting}
          error={submitError}
          staleLines={staleLines}
          onBack={() => setView('catalog')}
          onSubmit={handleSubmitOrder}
        />
      )}

      {view === 'success' && (
        <SuccessScreen
          companyName={catalog.company.name}
          orderNumber={orderNumber}
          onNewOrder={() => setView('catalog')}
        />
      )}

    </div>
  );
}
