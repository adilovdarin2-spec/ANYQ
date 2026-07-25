import { useState } from 'react';
import type { CartLine, PaymentMethod, Product, Sale, Shift } from './types';
import { getShift, saveShift, addSale, salesForShift, addClosedShift, getSession, saveSession } from './storage';
import { genId } from './utils';
import { useSalesSync } from './hooks/useSalesSync';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import { createRemoteShift, closeRemoteShift } from './api';
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
import { PaymentModal } from './components/PaymentModal';
import { ReceiptScreen } from './components/ReceiptScreen';

type View = 'sale' | 'cart' | 'payment' | 'receipt' | 'close-shift';

export default function App() {
  const [session, setSession] = useState<PosSession | null>(() => getSession());
  const [shift, setShift] = useState<Shift | null>(() => getShift());
  const [cart, setCart] = useState<CartLine[]>([]);
  const [view, setView] = useState<View>('sale');
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [query, setQuery] = useState('');

  const install = useInstallPrompt();
  const { online, pendingCount, refreshPendingCount, sync } = useSalesSync(session?.token ?? null);

  function handleLogin(newSession: PosSession) {
    saveSession(newSession);
    setSession(newSession);
  }

  function handleLogout() {
    saveSession(null);
    setSession(null);
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

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      const currentQty = existing?.qty ?? 0;
      if (currentQty + 1 > product.stock) return prev;
      if (existing) {
        return prev.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { productId: product.id, name: product.name, price: product.price, qty: 1 }];
    });
  }

  function changeQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
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
  const cartQtyByProduct = Object.fromEntries(cart.map((l) => [l.productId, l.qty]));

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
    <div className="pos-shell">
      <ShiftBar
        shift={shift}
        cashierName={session.user.name}
        online={online}
        pendingCount={pendingCount}
        onCloseShift={() => setView('close-shift')}
        onShowInstall={install.reopen}
        onLogout={handleLogout}
      />

      {view === 'sale' && (
        <>
          <SearchBar query={query} onQueryChange={setQuery} onEnter={handleSearchEnter} />
          <ProductGrid products={filteredProducts} cartQtyByProduct={cartQtyByProduct} onPick={addToCart} />
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

      {view === 'receipt' && lastSale && <ReceiptScreen sale={lastSale} onNewSale={() => setView('sale')} />}

      {view === 'close-shift' && (
        <CloseShiftScreen
          shift={shift}
          sales={salesForShift(shift.id)}
          onCancel={() => setView('sale')}
          onConfirm={closeShift}
        />
      )}

      <InstallPrompt {...install} />
    </div>
  );
}
