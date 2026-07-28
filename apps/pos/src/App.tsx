import { useEffect, useState } from 'react';
import type { Batch, CartLine, Order, PaymentMethod, Product, ProductModifierOption, Report, Sale, Shift } from './types';
import { getShift, saveShift, addSale, salesForShift, addClosedShift, getSession, saveSession } from './storage';
import { genId } from './utils';
import { useSalesSync } from './hooks/useSalesSync';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import { useIsDesktop } from './hooks/useIsDesktop';
import {
  createRemoteShift,
  closeRemoteShift,
  fetchOrders,
  fulfillOrder,
  rejectOrder,
  fetchReports,
  fetchBatches,
  receiveBatch,
  setStopListed,
  ApiError,
} from './api';
import type { PosSession } from './api';
import { InstallPrompt } from './components/InstallPrompt';
import { PinLogin } from './components/PinLogin';
import { ShiftBar } from './components/ShiftBar';
import { OpenShiftScreen } from './components/OpenShiftScreen';
import { CloseShiftScreen } from './components/CloseShiftScreen';
import { SearchBar } from './components/SearchBar';
import { ProductGrid } from './components/ProductGrid';
import { CartBar } from './components/CartBar';
import { CartSheet } from './components/CartSheet';
import { CartPanel } from './components/CartPanel';
import { PaymentModal } from './components/PaymentModal';
import { ReceiptScreen } from './components/ReceiptScreen';
import { OrdersScreen } from './components/OrdersScreen';
import { ReportsScreen } from './components/ReportsScreen';
import { BatchesScreen } from './components/BatchesScreen';
import { ModifierPicker } from './components/ModifierPicker';

type View = 'sale' | 'cart' | 'payment' | 'receipt' | 'close-shift' | 'orders' | 'reports' | 'batches';

export default function App() {
  const [session, setSession] = useState<PosSession | null>(() => getSession());
  const [shift, setShift] = useState<Shift | null>(() => getShift());
  const [cart, setCart] = useState<CartLine[]>([]);
  const [view, setView] = useState<View>('sale');
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportRangeDays, setReportRangeDays] = useState(7);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);

  const install = useInstallPrompt();
  const { online, pendingCount, refreshPendingCount, sync } = useSalesSync(session?.token ?? null);
  const hasSupply = session?.modules?.includes('supply') ?? false;
  const hasTerminal = session?.modules?.includes('terminal') ?? false;
  const hasPharmacy = session?.modules?.includes('pharmacy') ?? false;
  const hasRestaurant = session?.modules?.includes('restaurant') ?? false;
  const isDesktop = useIsDesktop();

  function handleLogin(newSession: PosSession) {
    saveSession(newSession);
    setSession(newSession);
  }

  function handleLogout() {
    saveSession(null);
    setSession(null);
  }

  async function loadOrders() {
    if (!session) return;
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const data = await fetchOrders(session.token);
      setOrders(data);
    } catch (err) {
      setOrdersError(err instanceof ApiError ? err.message : 'Не удалось загрузить заказы');
    } finally {
      setOrdersLoading(false);
    }
  }

  useEffect(() => {
    if (!session || !hasSupply) return;
    loadOrders();
    const interval = setInterval(loadOrders, 20000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, hasSupply]);

  useEffect(() => {
    if (!session || !hasPharmacy) return;
    loadBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, hasPharmacy]);

  async function handleFulfillOrder(id: string) {
    if (!session) return;
    setBusyOrderId(id);
    try {
      await fulfillOrder(session.token, id);
      await loadOrders();
    } catch (err) {
      setOrdersError(err instanceof ApiError ? err.message : 'Не удалось выдать заказ');
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleRejectOrder(id: string) {
    if (!session) return;
    setBusyOrderId(id);
    try {
      await rejectOrder(session.token, id);
      await loadOrders();
    } catch (err) {
      setOrdersError(err instanceof ApiError ? err.message : 'Не удалось отклонить заказ');
    } finally {
      setBusyOrderId(null);
    }
  }

  async function loadReport(days: number) {
    if (!session) return;
    setReportsLoading(true);
    setReportsError(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
      const data = await fetchReports(session.token, from.toISOString(), to.toISOString());
      setReport(data);
    } catch (err) {
      setReportsError(err instanceof ApiError ? err.message : 'Не удалось загрузить отчёт');
    } finally {
      setReportsLoading(false);
    }
  }

  function handleShowReports() {
    setView('reports');
    void loadReport(reportRangeDays);
  }

  function handleRangeChange(days: number) {
    setReportRangeDays(days);
    void loadReport(days);
  }

  async function loadBatches() {
    if (!session) return;
    setBatchesLoading(true);
    setBatchesError(null);
    try {
      const data = await fetchBatches(session.token);
      setBatches(data);
    } catch (err) {
      setBatchesError(err instanceof ApiError ? err.message : 'Не удалось загрузить партии');
    } finally {
      setBatchesLoading(false);
    }
  }

  function handleShowBatches() {
    setView('batches');
    void loadBatches();
  }

  async function handleReceiveBatch(payload: { productId: string; batchNumber: string; expiryDate: string; quantity: number }) {
    if (!session) return false;
    setBatchSubmitting(true);
    setBatchesError(null);
    try {
      await receiveBatch(session.token, payload);
      await loadBatches();
      return true;
    } catch (err) {
      setBatchesError(err instanceof ApiError ? err.message : 'Не удалось принять партию');
      return false;
    } finally {
      setBatchSubmitting(false);
    }
  }

  async function handleToggleStopList(product: Product) {
    if (!session) return;
    const nextValue = !product.stopListed;
    try {
      await setStopListed(session.token, product.id, nextValue);
      const updatedSession: PosSession = {
        ...session,
        products: session.products.map((p) => (p.id === product.id ? { ...p, stopListed: nextValue } : p)),
      };
      saveSession(updatedSession);
      setSession(updatedSession);
    } catch {
      // offline or server unavailable — leave the product as-is, try again next time
    }
  }

  async function openShift(openingCash: number) {
    let s: Shift = {
      id: genId('shift'),
      openedAt: new Date().toISOString(),
      openingCash,
      closedAt: null,
      closingCashCounted: null,
      syncedToServer: false,
    };

    const locationId = session?.locations[0]?.id;
    if (session && locationId) {
      try {
        const remote = await createRemoteShift(session.token, { locationId, openingCash });
        s = { ...s, id: remote.id, openedAt: remote.openedAt, syncedToServer: true };
      } catch {
        // offline or server unavailable — shift still works fully locally
      }
    }

    saveShift(s);
    setShift(s);
    setView('sale');
  }

  async function closeShift(closingCashCounted: number) {
    if (!shift) return;
    if (shift.syncedToServer && session) {
      try {
        await closeRemoteShift(session.token, shift.id, closingCashCounted);
      } catch {
        // offline or server unavailable — local close still proceeds below
      }
    }
    addClosedShift({ ...shift, closedAt: new Date().toISOString(), closingCashCounted });
    saveShift(null);
    setShift(null);
    setCart([]);
    setView('sale');
  }

  function addToCart(product: Product, modifier?: ProductModifierOption) {
    const lineId = modifier ? `${product.id}:${modifier.id}` : product.id;
    const displayName = modifier ? `${product.name} (${modifier.name})` : product.name;
    const price = product.price + (modifier?.priceDelta ?? 0);
    setCart((prev) => {
      const existing = prev.find((l) => l.id === lineId);
      const currentQty = existing?.qty ?? 0;
      if (currentQty + 1 > product.stock) return prev;
      if (existing) {
        return prev.map((l) => (l.id === lineId ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { id: lineId, productId: product.id, name: displayName, price, qty: 1 }];
    });
  }

  function handleProductClick(product: Product) {
    if (product.modifiers.length > 0) {
      setModifierProduct(product);
    } else {
      addToCart(product);
    }
  }

  function handlePickModifier(modifier: ProductModifierOption | null) {
    if (modifierProduct) {
      addToCart(modifierProduct, modifier ?? undefined);
    }
    setModifierProduct(null);
  }

  function changeQty(lineId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.id === lineId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function removeLine(lineId: string) {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
  }

  function handleSearchEnter() {
    if (!session) return;
    const match = session.products.find((p) => p.barcode === query.trim());
    if (match) {
      addToCart(match);
      setQuery('');
    }
  }

  const cartTotal = cart.reduce((sum, l) => sum + l.price * l.qty, 0);
  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0);
  const cartQtyByProduct = cart.reduce<Record<string, number>>((acc, l) => {
    acc[l.productId] = (acc[l.productId] ?? 0) + l.qty;
    return acc;
  }, {});

  function completeSale(method: PaymentMethod) {
    if (!shift || !session) return;
    const sale: Sale = {
      id: genId('sale'),
      shiftId: shift.id,
      locationId: session.locations[0]?.id ?? '',
      items: cart,
      total: cartTotal,
      paymentMethod: method,
      createdAt: new Date().toISOString(),
      synced: false,
    };
    addSale(sale);
    refreshPendingCount();
    void sync();
    setLastSale(sale);
    setCart([]);
    setView('receipt');
  }

  if (!session) {
    return (
      <>
        <PinLogin onLogin={handleLogin} />
        <InstallPrompt {...install} />
      </>
    );
  }

  const filteredProducts =
    query.trim() === ''
      ? session.products
      : session.products.filter(
          (p) => p.name.toLowerCase().includes(query.trim().toLowerCase()) || p.barcode.includes(query.trim()),
        );

  if (!shift) {
    return (
      <>
        <OpenShiftScreen onOpen={openShift} />
        <InstallPrompt {...install} />
      </>
    );
  }

  return (
    <div className={isDesktop ? 'pos-shell desktop' : 'pos-shell'}>
      <ShiftBar
        shift={shift}
        cashierName={session.user.name}
        online={online}
        pendingCount={pendingCount}
        onCloseShift={() => setView('close-shift')}
        onShowInstall={install.reopen}
        onLogout={handleLogout}
        onShowOrders={hasSupply ? () => setView('orders') : undefined}
        pendingOrdersCount={orders.filter((o) => o.status === 'pending').length}
        onShowReports={hasTerminal ? handleShowReports : undefined}
        onShowBatches={hasPharmacy ? handleShowBatches : undefined}
        expiringBatchesCount={batches.filter((b) => b.status !== 'ok').length}
      />

      {view === 'sale' && isDesktop && (
        <div className="pos-main">
          <div>
            <SearchBar query={query} onQueryChange={setQuery} onEnter={handleSearchEnter} />
            <ProductGrid
              products={filteredProducts}
              cartQtyByProduct={cartQtyByProduct}
              onPick={handleProductClick}
              canManageStopList={hasRestaurant}
              onToggleStopList={handleToggleStopList}
            />
          </div>
          <CartPanel cart={cart} total={cartTotal} onChangeQty={changeQty} onRemove={removeLine} onCheckout={() => setView('payment')} />
        </div>
      )}

      {view === 'sale' && !isDesktop && (
        <>
          <SearchBar query={query} onQueryChange={setQuery} onEnter={handleSearchEnter} />
          <ProductGrid
            products={filteredProducts}
            cartQtyByProduct={cartQtyByProduct}
            onPick={addToCart}
            canManageStopList={hasRestaurant}
            onToggleStopList={handleToggleStopList}
          />
          {cartCount > 0 && <CartBar count={cartCount} total={cartTotal} onOpen={() => setView('cart')} />}
        </>
      )}

      {view === 'cart' && (
        <CartSheet
          cart={cart}
          total={cartTotal}
          onChangeQty={changeQty}
          onRemove={removeLine}
          onBack={() => setView('sale')}
          onCheckout={() => setView('payment')}
        />
      )}

      {view === 'payment' && (
        <PaymentModal total={cartTotal} onCancel={() => setView('cart')} onConfirm={completeSale} />
      )}

      {view === 'receipt' && lastSale && (
        <ReceiptScreen sale={lastSale} onNewSale={() => setView('sale')} canPrint={hasTerminal} />
      )}

      {view === 'close-shift' && (
        <CloseShiftScreen
          shift={shift}
          sales={salesForShift(shift.id)}
          onCancel={() => setView('sale')}
          onConfirm={closeShift}
        />
      )}

      {view === 'orders' && (
        <OrdersScreen
          orders={orders}
          loading={ordersLoading}
          error={ordersError}
          busyId={busyOrderId}
          onBack={() => setView('sale')}
          onRefresh={loadOrders}
          onFulfill={handleFulfillOrder}
          onReject={handleRejectOrder}
        />
      )}

      {view === 'reports' && (
        <ReportsScreen
          report={report}
          loading={reportsLoading}
          error={reportsError}
          rangeDays={reportRangeDays}
          onRangeChange={handleRangeChange}
          onBack={() => setView('sale')}
          onRefresh={() => loadReport(reportRangeDays)}
        />
      )}

      {view === 'batches' && (
        <BatchesScreen
          batches={batches}
          products={session.products}
          loading={batchesLoading}
          error={batchesError}
          submitting={batchSubmitting}
          onBack={() => setView('sale')}
          onRefresh={loadBatches}
          onReceive={handleReceiveBatch}
        />
      )}

      {modifierProduct && (
        <ModifierPicker product={modifierProduct} onPick={handlePickModifier} onCancel={() => setModifierProduct(null)} />
      )}

      <InstallPrompt {...install} />
    </div>
  );
}
