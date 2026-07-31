import { useEffect, useMemo, useState } from 'react';
import type { Batch, CartLine, Count, Discount, KdsTicket, LoyaltySelection, Order, PaymentMethod, Product, ProductModifierOption, ProductionRecipe, ProductionRun, ProductVariantOption, Receipt, Report, RestaurantTable, Sale, Shift, StockMovementRecord, TableOrder, Transfer } from './types';
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
  fetchTransfers,
  createTransfer,
  fetchReceipts,
  createReceipt,
  fetchCounts,
  createCount,
  fetchCustomerPoints,
  fetchProductionRecipes,
  fetchProductionRuns,
  createProduction,
  fetchTables,
  createTable,
  fetchTableOrder,
  sendToKitchen,
  payTable,
  fetchKdsTickets,
  updateKitchenItemStatus,
  fetchStockMovements,
  fetchManagedProducts,
  createManagedProduct,
  updateManagedProduct,
  ORDERS_BASE,
  ApiError,
} from './api';
import type { ManagedProduct, ManagedProductPayload } from './api';
import { pushSupported, getExistingSubscription, enablePush, disablePush } from './push';
import type { PosSession, CustomerLookupResult } from './api';
import { InstallPrompt } from './components/InstallPrompt';
import { PinLogin } from './components/PinLogin';
import { ShiftBar } from './components/ShiftBar';
import { TabBar } from './components/TabBar';
import type { MainTab } from './components/TabBar';
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
import { VariantPicker } from './components/VariantPicker';
import { TransfersScreen } from './components/TransfersScreen';
import { IncomingScreen } from './components/IncomingScreen';
import { CycleCountScreen } from './components/CycleCountScreen';
import { ProductionScreen } from './components/ProductionScreen';
import { WeightEntryModal } from './components/WeightEntryModal';
import { FloorPlanScreen } from './components/FloorPlanScreen';
import { TableOrderScreen } from './components/TableOrderScreen';
import { KdsScreen } from './components/KdsScreen';
import { StockHistoryScreen } from './components/StockHistoryScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { OperationsScreen } from './components/OperationsScreen';
import type { OperationItem } from './components/OperationsScreen';
import { ProductsManageScreen } from './components/ProductsManageScreen';
import { ProductEditScreen } from './components/ProductEditScreen';

type View =
  | 'sale'
  | 'cart'
  | 'payment'
  | 'receipt'
  | 'close-shift'
  | 'products'
  | 'product-edit'
  | 'operations'
  | 'profile'
  | 'orders'
  | 'reports'
  | 'batches'
  | 'transfers'
  | 'incoming'
  | 'counts'
  | 'production'
  | 'floorplan'
  | 'table-order'
  | 'kds'
  | 'stock-history';

const OPERATIONS_VIEWS = new Set<View>([
  'orders', 'batches', 'transfers', 'incoming', 'counts', 'production', 'floorplan', 'table-order', 'kds', 'stock-history',
]);

export default function App() {
  const [session, setSession] = useState<PosSession | null>(() => getSession());
  const [shift, setShift] = useState<Shift | null>(() => getShift());
  const [cart, setCart] = useState<CartLine[]>([]);
  const [view, setView] = useState<View>('sale');
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
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
  const [variantProduct, setVariantProduct] = useState<Product | null>(null);
  const [weightProduct, setWeightProduct] = useState<Product | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [transfersError, setTransfersError] = useState<string | null>(null);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [receiptSubmitting, setReceiptSubmitting] = useState(false);
  const [counts, setCounts] = useState<Count[]>([]);
  const [countsLoading, setCountsLoading] = useState(false);
  const [countsError, setCountsError] = useState<string | null>(null);
  const [countSubmitting, setCountSubmitting] = useState(false);
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltySelection | null>(null);
  const [productionRuns, setProductionRuns] = useState<ProductionRun[]>([]);
  const [productionRecipes, setProductionRecipes] = useState<ProductionRecipe[]>([]);
  const [productionLoading, setProductionLoading] = useState(false);
  const [productionError, setProductionError] = useState<string | null>(null);
  const [productionSubmitting, setProductionSubmitting] = useState(false);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [tableSubmitting, setTableSubmitting] = useState(false);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [tableOrder, setTableOrder] = useState<TableOrder>({ id: null, items: [], total: 0 });
  const [tableOrderLoading, setTableOrderLoading] = useState(false);
  const [kdsTickets, setKdsTickets] = useState<KdsTicket[]>([]);
  const [kdsLoading, setKdsLoading] = useState(false);
  const [kdsError, setKdsError] = useState<string | null>(null);
  const [stockMovements, setStockMovements] = useState<StockMovementRecord[]>([]);
  const [stockMovementsLoading, setStockMovementsLoading] = useState(false);
  const [stockMovementsError, setStockMovementsError] = useState<string | null>(null);
  const [managedProducts, setManagedProducts] = useState<ManagedProduct[]>([]);
  const [managedProductsLoading, setManagedProductsLoading] = useState(false);
  const [managedProductsError, setManagedProductsError] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<ManagedProduct | null>(null);
  const [productSaveSubmitting, setProductSaveSubmitting] = useState(false);
  const [productSaveError, setProductSaveError] = useState<string | null>(null);

  const install = useInstallPrompt();
  const { online, pendingCount, refreshPendingCount, sync } = useSalesSync(session?.token ?? null);
  const hasSupply = session?.modules?.includes('supply') ?? false;
  const hasTerminal = session?.modules?.includes('terminal') ?? false;
  const hasPharmacy = session?.modules?.includes('pharmacy') ?? false;
  const hasRestaurant = session?.modules?.includes('restaurant') ?? false;
  const hasWarehouse = session?.modules?.includes('warehouse') ?? false;
  const hasRetail = session?.modules?.includes('retail') ?? false;
  const isDesktop = useIsDesktop();
  const canManageProducts = session?.user.role === 'owner' || session?.user.role === 'manager';
  const storefrontUrl = hasSupply && session?.company.slug ? `${ORDERS_BASE}/${session.company.slug}` : null;
  const categories = useMemo(
    () => Array.from(new Set((session?.products ?? []).map((p) => p.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru')),
    [session?.products],
  );
  // Self-heals if the selected category doesn't exist in the current catalog
  // (e.g. a different cashier's session has a different product mix) instead
  // of silently filtering the grid down to nothing.
  const effectiveCategoryFilter = categoryFilter && categories.includes(categoryFilter) ? categoryFilter : null;

  const pendingOrdersCount = orders.filter((o) => o.status === 'pending').length;
  const expiringBatchesCount = batches.filter((b) => b.status !== 'ok').length;

  const operationsItems: OperationItem[] = [];
  if (hasSupply) {
    operationsItems.push({ key: 'orders', icon: '📦', label: 'Заказы с сайта', badge: pendingOrdersCount, onClick: () => { setView('orders'); void loadOrders(); } });
  }
  if (hasPharmacy) {
    operationsItems.push({ key: 'batches', icon: '💊', label: 'Партии', badge: expiringBatchesCount, onClick: handleShowBatches });
  }
  if (hasWarehouse) {
    operationsItems.push(
      { key: 'transfers', icon: '🔄', label: 'Перемещения', onClick: handleShowTransfers },
      { key: 'incoming', icon: '📥', label: 'Приёмка', onClick: handleShowIncoming },
      { key: 'counts', icon: '📋', label: 'Инвентаризация', onClick: handleShowCounts },
      { key: 'production', icon: '🏭', label: 'Производство', onClick: handleShowProduction },
    );
  }
  if (hasRestaurant) {
    operationsItems.push(
      { key: 'floorplan', icon: '🍽️', label: 'Столики', onClick: handleShowFloorPlan },
      { key: 'kds', icon: '🔥', label: 'Кухня', onClick: handleShowKds },
    );
  }
  if (hasTerminal) {
    operationsItems.push({ key: 'stock-history', icon: '📜', label: 'История склада', onClick: handleShowStockHistory });
  }
  const operationsBadge = pendingOrdersCount + expiringBatchesCount;

  const activeTab: MainTab =
    view === 'products' || view === 'product-edit' ? 'products' :
    OPERATIONS_VIEWS.has(view) ? 'operations' :
    view === 'profile' || view === 'reports' ? 'profile' :
    'sale';

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
    if (!session || !hasSupply || !pushSupported()) return;
    getExistingSubscription().then((sub) => setPushEnabled(!!sub));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, hasSupply]);

  async function handleTogglePush() {
    if (!session) return;
    setPushBusy(true);
    try {
      if (pushEnabled) {
        await disablePush(session.token);
        setPushEnabled(false);
      } else {
        const ok = await enablePush(session.token);
        setPushEnabled(ok);
      }
    } catch {
      // permission denied or subscribe failed — leave state as-is, user can retry
    } finally {
      setPushBusy(false);
    }
  }

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

  async function loadTransfers() {
    if (!session) return;
    setTransfersLoading(true);
    setTransfersError(null);
    try {
      const data = await fetchTransfers(session.token);
      setTransfers(data);
    } catch (err) {
      setTransfersError(err instanceof ApiError ? err.message : 'Не удалось загрузить перемещения');
    } finally {
      setTransfersLoading(false);
    }
  }

  function handleShowTransfers() {
    setView('transfers');
    void loadTransfers();
  }

  async function handleCreateTransfer(payload: { toLocationId: string; items: { productId: string; quantity: number }[] }) {
    if (!session) return false;
    setTransferSubmitting(true);
    setTransfersError(null);
    try {
      await createTransfer(session.token, payload);
      await loadTransfers();
      return true;
    } catch (err) {
      setTransfersError(err instanceof ApiError ? err.message : 'Не удалось отправить перемещение');
      return false;
    } finally {
      setTransferSubmitting(false);
    }
  }

  async function loadReceipts() {
    if (!session) return;
    setReceiptsLoading(true);
    setReceiptsError(null);
    try {
      const data = await fetchReceipts(session.token);
      setReceipts(data);
    } catch (err) {
      setReceiptsError(err instanceof ApiError ? err.message : 'Не удалось загрузить приёмки');
    } finally {
      setReceiptsLoading(false);
    }
  }

  function handleShowIncoming() {
    setView('incoming');
    void loadReceipts();
  }

  async function handleCreateReceipt(payload: {
    supplierName: string;
    supplierPhone: string;
    items: { productId: string; quantity: number; price: number }[];
  }) {
    if (!session) return false;
    setReceiptSubmitting(true);
    setReceiptsError(null);
    try {
      await createReceipt(session.token, payload);
      await loadReceipts();
      return true;
    } catch (err) {
      setReceiptsError(err instanceof ApiError ? err.message : 'Не удалось оприходовать товар');
      return false;
    } finally {
      setReceiptSubmitting(false);
    }
  }

  async function loadCounts() {
    if (!session) return;
    setCountsLoading(true);
    setCountsError(null);
    try {
      const data = await fetchCounts(session.token);
      setCounts(data);
    } catch (err) {
      setCountsError(err instanceof ApiError ? err.message : 'Не удалось загрузить пересчёты');
    } finally {
      setCountsLoading(false);
    }
  }

  function handleShowCounts() {
    setView('counts');
    void loadCounts();
  }

  async function handleCreateCount(payload: { items: { productId: string; countedQuantity: number }[] }) {
    if (!session) return false;
    setCountSubmitting(true);
    setCountsError(null);
    try {
      await createCount(session.token, payload);
      await loadCounts();
      return true;
    } catch (err) {
      setCountsError(err instanceof ApiError ? err.message : 'Не удалось сохранить пересчёт');
      return false;
    } finally {
      setCountSubmitting(false);
    }
  }

  async function loadProduction() {
    if (!session) return;
    setProductionLoading(true);
    setProductionError(null);
    try {
      const [runs, recipes] = await Promise.all([fetchProductionRuns(session.token), fetchProductionRecipes(session.token)]);
      setProductionRuns(runs);
      setProductionRecipes(recipes);
    } catch (err) {
      setProductionError(err instanceof ApiError ? err.message : 'Не удалось загрузить производство');
    } finally {
      setProductionLoading(false);
    }
  }

  function handleShowProduction() {
    setView('production');
    void loadProduction();
  }

  async function handleCreateProduction(payload: { productId: string; quantity: number }) {
    if (!session) return false;
    setProductionSubmitting(true);
    setProductionError(null);
    try {
      await createProduction(session.token, payload);
      await loadProduction();
      return true;
    } catch (err) {
      setProductionError(err instanceof ApiError ? err.message : 'Не удалось запустить производство');
      return false;
    } finally {
      setProductionSubmitting(false);
    }
  }

  async function loadStockMovements() {
    if (!session) return;
    setStockMovementsLoading(true);
    setStockMovementsError(null);
    try {
      const data = await fetchStockMovements(session.token);
      setStockMovements(data);
    } catch (err) {
      setStockMovementsError(err instanceof ApiError ? err.message : 'Не удалось загрузить историю склада');
    } finally {
      setStockMovementsLoading(false);
    }
  }

  function handleShowStockHistory() {
    setView('stock-history');
    void loadStockMovements();
  }

  async function loadManagedProducts() {
    if (!session) return;
    setManagedProductsLoading(true);
    setManagedProductsError(null);
    try {
      const data = await fetchManagedProducts(session.token);
      setManagedProducts(data);
    } catch (err) {
      setManagedProductsError(err instanceof ApiError ? err.message : 'Не удалось загрузить товары');
    } finally {
      setManagedProductsLoading(false);
    }
  }

  function handleShowProducts() {
    setView('products');
    void loadManagedProducts();
  }

  function handleAddProduct() {
    setEditingProduct(null);
    setProductSaveError(null);
    setView('product-edit');
  }

  function handleEditProduct(product: ManagedProduct) {
    setEditingProduct(product);
    setProductSaveError(null);
    setView('product-edit');
  }

  async function handleSaveProduct(payload: ManagedProductPayload) {
    if (!session) return;
    setProductSaveSubmitting(true);
    setProductSaveError(null);
    try {
      const saved = editingProduct
        ? await updateManagedProduct(session.token, editingProduct.id, payload)
        : await createManagedProduct(session.token, payload);
      await loadManagedProducts();

      // Best-effort sync into the live sale grid so an edit to a product
      // already visible in Касса shows up without re-logging in. A brand
      // new product (no stock yet) or one being un-hidden only appears
      // after the next PIN login, when the server rebuilds the full
      // catalog with stock.
      if (session.products.some((p) => p.id === saved.id)) {
        const updatedSession: PosSession = {
          ...session,
          products: saved.sellable
            ? session.products.map((p) =>
                p.id === saved.id ? { ...p, name: saved.name, category: saved.category, price: saved.salePrice, barcode: saved.barcode } : p,
              )
            : session.products.filter((p) => p.id !== saved.id),
        };
        saveSession(updatedSession);
        setSession(updatedSession);
      }

      setView('products');
    } catch (err) {
      setProductSaveError(err instanceof ApiError ? err.message : 'Не удалось сохранить товар');
    } finally {
      setProductSaveSubmitting(false);
    }
  }

  async function loadTables() {
    if (!session) return;
    setTablesLoading(true);
    setTablesError(null);
    try {
      const data = await fetchTables(session.token);
      setTables(data);
    } catch (err) {
      setTablesError(err instanceof ApiError ? err.message : 'Не удалось загрузить столики');
    } finally {
      setTablesLoading(false);
    }
  }

  function handleShowFloorPlan() {
    setView('floorplan');
    void loadTables();
  }

  useEffect(() => {
    if (view !== 'floorplan' || !session) return;
    const interval = setInterval(loadTables, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, session?.token]);

  async function handleCreateTable(name: string, seats: number) {
    if (!session) return;
    setTableSubmitting(true);
    setTablesError(null);
    try {
      await createTable(session.token, { name, seats });
      await loadTables();
    } catch (err) {
      setTablesError(err instanceof ApiError ? err.message : 'Не удалось добавить стол');
    } finally {
      setTableSubmitting(false);
    }
  }

  async function loadTableOrder(tableId: string) {
    if (!session) return;
    setTableOrderLoading(true);
    try {
      const data = await fetchTableOrder(session.token, tableId);
      setTableOrder(data);
    } catch {
      // offline or server unavailable — keep whatever order data we already have
    } finally {
      setTableOrderLoading(false);
    }
  }

  function handleSelectTable(table: RestaurantTable) {
    setSelectedTable(table);
    setTableOrder({ id: null, items: [], total: 0 });
    setView('table-order');
    void loadTableOrder(table.id);
  }

  async function handleSendToKitchen(items: { productId: string; quantity: number; price: number }[]) {
    if (!session || !selectedTable) return;
    setTableSubmitting(true);
    setTablesError(null);
    try {
      const order = await sendToKitchen(session.token, selectedTable.id, { items });
      setTableOrder(order);
    } catch (err) {
      setTablesError(err instanceof ApiError ? err.message : 'Не удалось отправить заказ на кухню');
    } finally {
      setTableSubmitting(false);
    }
  }

  async function handlePayTable(method: PaymentMethod) {
    if (!session || !selectedTable) return;
    setTableSubmitting(true);
    try {
      await payTable(session.token, selectedTable.id, method);
      setSelectedTable(null);
      setTableOrder({ id: null, items: [], total: 0 });
      setView('floorplan');
      void loadTables();
    } catch (err) {
      setTablesError(err instanceof ApiError ? err.message : 'Не удалось провести оплату');
    } finally {
      setTableSubmitting(false);
    }
  }

  async function loadKds() {
    if (!session) return;
    setKdsLoading(true);
    setKdsError(null);
    try {
      const data = await fetchKdsTickets(session.token);
      setKdsTickets(data);
    } catch (err) {
      setKdsError(err instanceof ApiError ? err.message : 'Не удалось загрузить кухонный экран');
    } finally {
      setKdsLoading(false);
    }
  }

  function handleShowKds() {
    setView('kds');
    void loadKds();
  }

  useEffect(() => {
    if (view !== 'kds' || !session) return;
    const interval = setInterval(loadKds, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, session?.token]);

  async function handleToggleKitchenItem(itemId: string, ready: boolean) {
    if (!session) return;
    try {
      await updateKitchenItemStatus(session.token, itemId, ready ? 'ready' : 'pending');
      await loadKds();
    } catch {
      // transient failure — next poll resyncs
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

  function addToCart(product: Product, modifier?: ProductModifierOption, explicitQty?: number) {
    const lineId = modifier ? `${product.id}:${modifier.id}` : product.id;
    const displayName = modifier ? `${product.name} (${modifier.name})` : product.name;
    const price = product.price + (modifier?.priceDelta ?? 0);
    setCart((prev) => {
      // Weight-based lines are set (re-entering a weight corrects the amount),
      // not incremented like piece-based lines.
      if (explicitQty !== undefined) {
        if (explicitQty <= 0 || explicitQty > product.stock) return prev;
        const existing = prev.find((l) => l.id === lineId);
        if (existing) {
          return prev.map((l) => (l.id === lineId ? { ...l, qty: explicitQty } : l));
        }
        return [...prev, { id: lineId, productId: product.id, name: displayName, price, qty: explicitQty, saleUnit: product.saleUnit }];
      }
      const existing = prev.find((l) => l.id === lineId);
      const currentQty = existing?.qty ?? 0;
      if (currentQty + 1 > product.stock) return prev;
      if (existing) {
        return prev.map((l) => (l.id === lineId ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { id: lineId, productId: product.id, name: displayName, price, qty: 1, saleUnit: product.saleUnit }];
    });
  }

  function handleProductClick(product: Product) {
    if (product.saleUnit === 'weight') {
      setWeightProduct(product);
    } else if (product.variants.length > 0) {
      setVariantProduct(product);
    } else if (product.modifiers.length > 0) {
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

  function handleConfirmWeight(kg: number) {
    if (weightProduct) {
      addToCart(weightProduct, undefined, kg);
    }
    setWeightProduct(null);
  }

  function handlePickVariant(variant: ProductVariantOption) {
    if (variantProduct) {
      addToCart({
        id: variant.id,
        name: `${variantProduct.name} — ${variant.label}`,
        price: variantProduct.price,
        barcode: '',
        saleUnit: 'piece',
        category: variantProduct.category,
        stock: variant.stock,
        stopListed: false,
        modifiers: [],
        variants: [],
      });
    }
    setVariantProduct(null);
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

  function handleEditWeightLine(line: CartLine) {
    const product = session?.products.find((p) => p.id === line.productId);
    if (product) setWeightProduct(product);
  }

  function handleSearchEnter() {
    if (!session) return;
    const match = session.products.find((p) => p.barcode === query.trim());
    if (match) {
      addToCart(match);
      setQuery('');
    }
  }

  const cartSubtotal = cart.reduce((sum, l) => sum + Math.round(l.price * l.qty), 0);
  const cartDiscountAmount = discount
    ? discount.type === 'percent'
      ? Math.round((cartSubtotal * Math.min(Math.max(discount.value, 0), 100)) / 100)
      : Math.min(Math.max(discount.value, 0), cartSubtotal)
    : 0;
  const cartNetAfterDiscount = cartSubtotal - cartDiscountAmount;
  const cartPointsRedeemed = loyalty
    ? Math.min(Math.max(loyalty.pointsToRedeem, 0), loyalty.pointsAvailable, cartNetAfterDiscount)
    : 0;
  const cartTotal = cartNetAfterDiscount - cartPointsRedeemed;
  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0);
  const cartQtyByProduct = cart.reduce<Record<string, number>>((acc, l) => {
    acc[l.productId] = (acc[l.productId] ?? 0) + l.qty;
    return acc;
  }, {});

  useEffect(() => {
    if (cart.length === 0 && discount) setDiscount(null);
    if (cart.length === 0 && loyalty) setLoyalty(null);
  }, [cart.length, discount, loyalty]);

  function lookupCustomer(phone: string): Promise<CustomerLookupResult> {
    if (!session) return Promise.reject(new Error('no session'));
    return fetchCustomerPoints(session.token, phone);
  }

  function completeSale(method: PaymentMethod) {
    if (!shift || !session) return;
    const sale: Sale = {
      id: genId('sale'),
      shiftId: shift.id,
      locationId: session.locations[0]?.id ?? '',
      items: cart,
      total: cartTotal,
      discount,
      discountAmount: cartDiscountAmount,
      customerPhone: loyalty?.phone,
      customerName: loyalty?.name,
      pointsRedeemed: cartPointsRedeemed || undefined,
      pointsEarned: loyalty ? Math.floor((cartTotal * 5) / 100) : undefined,
      paymentMethod: method,
      createdAt: new Date().toISOString(),
      synced: false,
    };
    addSale(sale);
    refreshPendingCount();
    void sync();
    setLastSale(sale);
    setCart([]);
    setDiscount(null);
    setLoyalty(null);
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

  // A typed search always searches the full catalog, ignoring the category
  // filter — otherwise a cashier could type the exact product name, see
  // "Ничего не найдено", and not realize a forgotten category chip is why.
  const filteredProducts =
    query.trim() !== ''
      ? session.products.filter(
          (p) => p.name.toLowerCase().includes(query.trim().toLowerCase()) || p.barcode.includes(query.trim()),
        )
      : effectiveCategoryFilter
        ? session.products.filter((p) => p.category === effectiveCategoryFilter)
        : session.products;

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
      <ShiftBar shift={shift} cashierName={session.user.name} online={online} pendingCount={pendingCount} />

      {view === 'sale' && isDesktop && (
        <div className="pos-main">
          <div>
            <SearchBar
              query={query}
              onQueryChange={setQuery}
              onEnter={handleSearchEnter}
              categories={categories}
              activeCategory={effectiveCategoryFilter}
              onCategoryChange={setCategoryFilter}
            />
            <ProductGrid
              products={filteredProducts}
              cartQtyByProduct={cartQtyByProduct}
              onPick={handleProductClick}
              canManageStopList={hasRestaurant}
              onToggleStopList={handleToggleStopList}
            />
          </div>
          <CartPanel
            cart={cart}
            subtotal={cartSubtotal}
            netAfterDiscount={cartNetAfterDiscount}
            total={cartTotal}
            discount={discount}
            discountAmount={cartDiscountAmount}
            loyalty={loyalty}
            hasRetail={hasRetail}
            onChangeDiscount={setDiscount}
            onChangeLoyalty={setLoyalty}
            onLookupCustomer={lookupCustomer}
            onChangeQty={changeQty}
            onEditWeight={handleEditWeightLine}
            onRemove={removeLine}
            onCheckout={() => setView('payment')}
          />
        </div>
      )}

      {view === 'sale' && !isDesktop && (
        <>
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            onEnter={handleSearchEnter}
            categories={categories}
            activeCategory={effectiveCategoryFilter}
            onCategoryChange={setCategoryFilter}
          />
          <ProductGrid
            products={filteredProducts}
            cartQtyByProduct={cartQtyByProduct}
            onPick={handleProductClick}
            canManageStopList={hasRestaurant}
            onToggleStopList={handleToggleStopList}
          />
          {cartCount > 0 && <CartBar count={cartCount} total={cartTotal} onOpen={() => setView('cart')} />}
        </>
      )}

      {view === 'cart' && (
        <CartSheet
          cart={cart}
          subtotal={cartSubtotal}
          netAfterDiscount={cartNetAfterDiscount}
          total={cartTotal}
          discount={discount}
          discountAmount={cartDiscountAmount}
          loyalty={loyalty}
          hasRetail={hasRetail}
          onChangeDiscount={setDiscount}
          onChangeLoyalty={setLoyalty}
          onLookupCustomer={lookupCustomer}
          onChangeQty={changeQty}
          onEditWeight={handleEditWeightLine}
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
          onBack={() => setView('operations')}
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
          onBack={() => setView('profile')}
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
          onBack={() => setView('operations')}
          onRefresh={loadBatches}
          onReceive={handleReceiveBatch}
        />
      )}

      {view === 'transfers' && (
        <TransfersScreen
          transfers={transfers}
          products={session.products}
          otherLocations={session.locations.filter((l) => l.id !== session.locations[0]?.id)}
          loading={transfersLoading}
          error={transfersError}
          submitting={transferSubmitting}
          onBack={() => setView('operations')}
          onRefresh={loadTransfers}
          onSubmit={handleCreateTransfer}
        />
      )}

      {view === 'incoming' && (
        <IncomingScreen
          receipts={receipts}
          products={session.products}
          loading={receiptsLoading}
          error={receiptsError}
          submitting={receiptSubmitting}
          onBack={() => setView('operations')}
          onRefresh={loadReceipts}
          onSubmit={handleCreateReceipt}
        />
      )}

      {view === 'counts' && (
        <CycleCountScreen
          counts={counts}
          products={session.products}
          loading={countsLoading}
          error={countsError}
          submitting={countSubmitting}
          onBack={() => setView('operations')}
          onRefresh={loadCounts}
          onSubmit={handleCreateCount}
        />
      )}

      {view === 'production' && (
        <ProductionScreen
          runs={productionRuns}
          recipes={productionRecipes}
          loading={productionLoading}
          error={productionError}
          submitting={productionSubmitting}
          onBack={() => setView('operations')}
          onRefresh={loadProduction}
          onSubmit={handleCreateProduction}
        />
      )}

      {view === 'floorplan' && (
        <FloorPlanScreen
          tables={tables}
          loading={tablesLoading}
          error={tablesError}
          submitting={tableSubmitting}
          onBack={() => setView('operations')}
          onRefresh={loadTables}
          onSelectTable={handleSelectTable}
          onCreateTable={handleCreateTable}
        />
      )}

      {view === 'table-order' && selectedTable && (
        <TableOrderScreen
          table={selectedTable}
          order={tableOrder}
          products={session.products}
          loading={tableOrderLoading}
          error={tablesError}
          submitting={tableSubmitting}
          onBack={() => {
            setView('floorplan');
            void loadTables();
          }}
          onSendToKitchen={handleSendToKitchen}
          onPay={handlePayTable}
        />
      )}

      {view === 'kds' && (
        <KdsScreen
          tickets={kdsTickets}
          loading={kdsLoading}
          error={kdsError}
          onBack={() => setView('operations')}
          onRefresh={loadKds}
          onToggleItem={handleToggleKitchenItem}
        />
      )}

      {view === 'stock-history' && (
        <StockHistoryScreen
          movements={stockMovements}
          loading={stockMovementsLoading}
          error={stockMovementsError}
          onBack={() => setView('operations')}
          onRefresh={loadStockMovements}
        />
      )}

      {view === 'products' && (
        <ProductsManageScreen
          products={managedProducts}
          loading={managedProductsLoading}
          error={managedProductsError}
          onRefresh={loadManagedProducts}
          onAdd={handleAddProduct}
          onEdit={handleEditProduct}
        />
      )}

      {view === 'product-edit' && (
        <ProductEditScreen
          product={editingProduct}
          submitting={productSaveSubmitting}
          error={productSaveError}
          onBack={() => setView('products')}
          onSave={handleSaveProduct}
        />
      )}

      {view === 'operations' && <OperationsScreen items={operationsItems} />}

      {view === 'profile' && (
        <ProfileScreen
          cashierName={session.user.name}
          role={session.user.role}
          shift={shift}
          online={online}
          pendingCount={pendingCount}
          storefrontUrl={storefrontUrl}
          pushSupported={hasSupply && pushSupported()}
          pushEnabled={pushEnabled}
          pushBusy={pushBusy}
          onTogglePush={handleTogglePush}
          onShowReports={hasTerminal ? handleShowReports : undefined}
          onShowInstall={install.reopen}
          onCloseShift={() => setView('close-shift')}
          onLogout={handleLogout}
        />
      )}

      {(view === 'sale' || view === 'products' || view === 'operations' || view === 'profile') && (
        <TabBar
          active={activeTab}
          onChange={(tab) => {
            if (tab === 'products') handleShowProducts();
            else if (tab === 'profile') setView('profile');
            else setView(tab);
          }}
          showProducts={canManageProducts}
          showOperations={operationsItems.length > 0}
          operationsBadge={operationsBadge}
        />
      )}

      {modifierProduct && (
        <ModifierPicker product={modifierProduct} onPick={handlePickModifier} onCancel={() => setModifierProduct(null)} />
      )}

      {variantProduct && (
        <VariantPicker product={variantProduct} onPick={handlePickVariant} onCancel={() => setVariantProduct(null)} />
      )}

      {weightProduct && (
        <WeightEntryModal product={weightProduct} onConfirm={handleConfirmWeight} onCancel={() => setWeightProduct(null)} />
      )}

      <InstallPrompt {...install} />
    </div>
  );
}
