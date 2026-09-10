import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuditEntry, Batch, CabinetInfo, DeliveryMatch, PriceListMatch, BinContent, BinCountAdjustmentResult, CartLine, Count, CountSheetLine, Discount, FiscalDevice, ImportPreview, KdsTicket, LedgerDocument, LoyaltySelection, Order, OwnerDashboard, Packaging, PaymentLine, PaymentMethod, PendingFiscalReceipt, PriceRoundTrip, Product, ProductModifierOption, ProductVariantOption, ProductionRecipe, ProductionRun, PurchaseOrder, Receipt, ReconciliationReport, ReplenishmentItem, Report, RestaurantTable, ReturnRecord, ReturnableSale, Sale, SettlementAccount, Shift, SourceSystemInfo, StockMovementRecord, StorageBin, Supplier, SupplierReturn, TableOrder, Transfer, WriteOffReason, WriteOffRecord } from './types';
import { addClosedShift, addSale, getCachedCountSheet, getCurrentLocationId, getSales, getSession, getShift, salesForShift, saveCachedCountSheet, saveCurrentLocationId, saveSession, saveShift } from './storage';
import { cartTotals } from './cart';
import { shouldRefreshCatalog } from './catalog-refresh';
import type { RefreshTrigger } from './catalog-refresh';
import { genId, resolveScannedBarcode } from './utils';
import { useSalesSync } from './hooks/useSalesSync';
import { useOutboxSync } from './hooks/useOutboxSync';
import { getOutbox, outcomeOf, queueCommand } from './outbox';
import { useTranslation } from './i18n/useLanguage';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import { useIsDesktop } from './hooks/useIsDesktop';
import { useOfflineReadiness } from './hooks/useOfflineReadiness';
import {
  ApiError,
  ORDERS_BASE,
  actOnPurchaseOrder,
  blockBin,
  cancelTransfer,
  changeQuarantine,
  closeRemoteShift,
  commitImport,
  createBin,
  createCount,
  createManagedProduct,
  createPackaging,
  createProduction,
  createPurchaseOrder,
  createReceipt,
  createRemoteShift,
  createReturn,
  createSupplierReturn,
  createTable,
  createTransfer,
  deleteBin,
  deletePackaging,
  downloadExport,
  fetchAuditLog,
  fetchDevices,
  renameDevice,
  restoreDevice,
  revokeDevice,
  fetchBatches,
  fetchBins,
  fetchCatalog,
  fetchCountSheet,
  fetchCounts,
  fetchCustomerPoints,
  fetchDocuments,
  fetchKdsTickets,
  fetchManagedProducts,
  fetchOrders,
  fetchOwnerDashboard,
  fetchPackagings,
  fetchPendingFiscal,
  fetchProductionRecipes,
  fetchProductionRuns,
  fetchPurchaseOrders,
  fetchReceipts,
  fetchReconciliation,
  fetchReplenishment,
  fetchReports,
  fetchReturnableSales,
  fetchReturns,
  fetchCabinet,
  fetchSettlements,
  fetchSourceSystems,
  fetchStockMovements,
  fetchSupplierReturns,
  fetchSuppliers,
  fetchTableOrder,
  fetchTables,
  fetchTransfers,
  fetchWriteOffs,
  fulfillOrder,
  payTable,
  pickOrder,
  previewImport,
  receiveBatch,
  receiveTransfer,
  recordSettlement,
  registerFiscalManually,
  rejectOrder,
  matchDeliveryNote,
  matchPriceList,
  repairReconciliation,
  resetCabinet as resetCabinetLink,
  saveStockPolicy,
  sendToKitchen,
  setCounterpartyCredit,
  setStopListed,
  shipOrder,
  unblockBin,
  updateKitchenItemStatus,
  updateManagedProduct,
} from './api';
import type { DocumentFilter, ImportSource } from './api';
import type { ManagedProduct, ManagedProductPayload, PackagingPayload } from './api';
import { pushSupported, getExistingSubscription, enablePush, disablePush } from './push';
import type { PosSession, CustomerLookupResult, PosDevice } from './api';
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
import { ReturnsScreen } from './components/ReturnsScreen';
import { ReplenishmentScreen } from './components/ReplenishmentScreen';
import { OwnerDashboardScreen } from './components/OwnerDashboardScreen';
import { AuditScreen } from './components/AuditScreen';
import { DevicesScreen } from './components/DevicesScreen';
import { ExportScreen } from './components/ExportScreen';
import { SupplierReturnsScreen } from './components/SupplierReturnsScreen';
import { PickOrderScreen } from './components/PickOrderScreen';
import { DocumentsScreen } from './components/DocumentsScreen';
import { FiscalScreen } from './components/FiscalScreen';
import { PurchaseOrdersScreen } from './components/PurchaseOrdersScreen';
import { WriteOffScreen } from './components/WriteOffScreen';
import { BinsScreen } from './components/BinsScreen';
import { BinCountScreen } from './components/BinCountScreen';
import { OutboxBanner } from './components/OutboxBanner';
import { TariffNotice } from './components/TariffNotice';
import { ReconciliationScreen } from './components/ReconciliationScreen';
import { ImportScreen } from './components/ImportScreen';
import { MigrationScreen } from './components/MigrationScreen';
import { CabinetLinkScreen } from './components/CabinetLinkScreen';
import { PriceListScreen } from './components/PriceListScreen';
import { DeliveryNoteScreen } from './components/DeliveryNoteScreen';
import { SettlementsScreen } from './components/SettlementsScreen';
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
  | 'returns'
  | 'replenishment'
  | 'dashboard'
  | 'audit'
  | 'devices'
  | 'export'
  | 'supplier-returns'
  | 'pick-order'
  | 'documents'
  | 'fiscal'
  | 'purchase-orders'
  | 'write-offs'
  | 'bins'
  | 'bin-count'
  | 'reconciliation'
  | 'import'
  | 'migrate'
  | 'cabinet'
  | 'price-list'
  | 'delivery'
  | 'settlements'
  | 'production'
  | 'floorplan'
  | 'table-order'
  | 'kds'
  | 'stock-history';

/**
 * Как часто касса перечитывает остатки, пока на неё смотрят.
 *
 * Минута — компромисс, а не круглое число: продукт обязан работать без сети, и
 * постоянный опрос противоречит этому обещанию, а плитка, отставшая на минуту,
 * ошибается только там, где две кассы продают один и тот же последний товар в
 * одну и ту же минуту. Такую продажу всё равно отклонит сервер.
 */
const CATALOG_REFRESH_MS = 60_000;

const OPERATIONS_VIEWS = new Set<View>([
  'orders', 'batches', 'transfers', 'incoming', 'counts', 'returns', 'replenishment', 'fiscal', 'purchase-orders', 'write-offs', 'bins', 'bin-count', 'reconciliation', 'import', 'migrate', 'cabinet', 'price-list', 'delivery', 'settlements', 'production', 'floorplan', 'table-order', 'kds', 'stock-history',
]);

export default function App() {
  const [session, setSession] = useState<PosSession | null>(() => getSession());
  const [rememberedLocationId, setRememberedLocationId] = useState<string | null>(() => getCurrentLocationId());
  const [locationSwitchError, setLocationSwitchError] = useState<string | null>(null);
  const [locationSwitching, setLocationSwitching] = useState(false);
  const [shift, setShift] = useState<Shift | null>(() => getShift());
  const [cart, setCart] = useState<CartLine[]>([]);
  // Читается из обработчиков, которые живут дольше рендера (таймер обновления
  // каталога), поэтому ref, а не значение из замыкания.
  const cartRef = useRef<CartLine[]>([]);
  cartRef.current = cart;
  // Falls back to the location the catalog was loaded for at login, so a
  // single-location company never has to choose and a cashier signing in on a
  // colleague's device doesn't inherit a location that isn't theirs.
  const currentLocationId =
    rememberedLocationId && session?.locations.some((l) => l.id === rememberedLocationId)
      ? rememberedLocationId
      // A session saved by an earlier build carries no catalogLocationId, so
      // fall back to the location that build implicitly used — a register
      // already signed in keeps working across the deploy instead of finding
      // every warehouse screen refusing to load until someone signs in again.
      : session?.catalogLocationId ?? session?.locations[0]?.id ?? null;
  const currentLocation = session?.locations.find((l) => l.id === currentLocationId) ?? null;
  const [view, setView] = useState<View>('sale');
  /**
   * Чек показывает продажу такой, какая она сейчас, а не снимок момента оплаты.
   *
   * Раньше здесь лежала копия объекта, созданная в момент продажи с
   * `synced: false`. Синхронизация происходит через долю секунды и помечает
   * продажу в хранилище — но копию не трогает, и чек навсегда оставался с
   * подписью «не синхронизирован» под продажей, которая давно на сервере.
   *
   * Кассир, прочитавший это, пробьёт второй раз. Весь продукт построен вокруг
   * того, чтобы не продать дважды, а тут интерфейс сам к этому приглашает.
   */
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [busyOrder, setBusyOrder] = useState<{ id: string; action: 'fulfill' | 'reject' } | null>(null);
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
  const [editingPackagings, setEditingPackagings] = useState<Packaging[]>([]);
  const [packagingBusy, setPackagingBusy] = useState(false);
  const [packagingError, setPackagingError] = useState<string | null>(null);
  const [settlementType, setSettlementType] = useState<'customer' | 'supplier'>('customer');
  const [settlementAccounts, setSettlementAccounts] = useState<SettlementAccount[]>([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);
  const [settlementsError, setSettlementsError] = useState<string | null>(null);
  const [settlementsSubmitting, setSettlementsSubmitting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [sourceSystems, setSourceSystems] = useState<SourceSystemInfo[]>([]);
  const [cabinet, setCabinet] = useState<CabinetInfo | null>(null);
  const [priceList, setPriceList] = useState<PriceListMatch | null>(null);
  const [priceListLoading, setPriceListLoading] = useState(false);
  const [priceListError, setPriceListError] = useState<string | null>(null);
  const [priceListSubmitting, setPriceListSubmitting] = useState(false);
  const [priceListOrderId, setPriceListOrderId] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryMatch | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [deliverySubmitting, setDeliverySubmitting] = useState(false);
  const [deliveryReceiptId, setDeliveryReceiptId] = useState<string | null>(null);
  const [cabinetLoading, setCabinetLoading] = useState(false);
  const [cabinetError, setCabinetError] = useState<string | null>(null);
  const [cabinetResetting, setCabinetResetting] = useState(false);
  const [sourceSystemsLoading, setSourceSystemsLoading] = useState(false);
  // Выбранная программа, из которой переезжают. null и view === 'migrate' —
  // владелец ещё выбирает; null и view === 'import' — обычный импорт прайса.
  const [importSystem, setImportSystem] = useState<SourceSystemInfo | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [importResult, setImportResult] = useState<
    { created: number; updated: number; stocked: number; skipped: number } | null
  >(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationReport | null>(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [reconciliationRepairing, setReconciliationRepairing] = useState(false);
  const [countSheet, setCountSheet] = useState<{ bin: string; lines: CountSheetLine[] } | null>(null);
  const [countSheetLoading, setCountSheetLoading] = useState(false);
  const [binCountError, setBinCountError] = useState<string | null>(null);
  const [binCountSubmitting, setBinCountSubmitting] = useState(false);
  const [binCountResult, setBinCountResult] = useState<
    { binLocation: string; name: string; systemQuantity: number; countedQuantity: number; delta: number }[] | null
  >(null);
  // The shelf whose count is written down but not yet accepted by the server.
  // Distinct from a result of zero discrepancies, which means the shelf agreed.
  const [binCountQueued, setBinCountQueued] = useState<string | null>(null);
  // Set when the sheet on screen came from the device rather than the server.
  const [countSheetCachedAt, setCountSheetCachedAt] = useState<string | null>(null);
  const [bins, setBins] = useState<StorageBin[]>([]);
  const [unplaced, setUnplaced] = useState<BinContent[]>([]);
  const [binsLoading, setBinsLoading] = useState(false);
  const [binsError, setBinsError] = useState<string | null>(null);
  const [binsSubmitting, setBinsSubmitting] = useState(false);
  const [writeOffs, setWriteOffs] = useState<WriteOffRecord[]>([]);
  const [writeOffLoading, setWriteOffLoading] = useState(false);
  const [writeOffError, setWriteOffError] = useState<string | null>(null);
  const [writeOffSubmitting, setWriteOffSubmitting] = useState(false);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [fiscalDevice, setFiscalDevice] = useState<FiscalDevice | null>(null);
  const [pendingFiscal, setPendingFiscal] = useState<PendingFiscalReceipt[]>([]);
  const [fiscalLoading, setFiscalLoading] = useState(false);
  const [fiscalError, setFiscalError] = useState<string | null>(null);
  const [fiscalBusyDocumentId, setFiscalBusyDocumentId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<OwnerDashboard | null>(null);
  const [dashboardDays, setDashboardDays] = useState(7);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditRoundTrips, setAuditRoundTrips] = useState<PriceRoundTrip[]>([]);
  const [auditDays, setAuditDays] = useState(30);
  const [supplierReturns, setSupplierReturns] = useState<SupplierReturn[]>([]);
  const [supplierReturnsLoading, setSupplierReturnsLoading] = useState(false);
  const [supplierReturnsError, setSupplierReturnsError] = useState<string | null>(null);
  const [supplierReturnSubmitting, setSupplierReturnSubmitting] = useState(false);
  const [pickingOrderId, setPickingOrderId] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickSubmitting, setPickSubmitting] = useState(false);
  const [documents, setDocuments] = useState<LedgerDocument[]>([]);
  const [documentsTitle, setDocumentsTitle] = useState('');
  const [documentsSubtitle, setDocumentsSubtitle] = useState('');
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [deviceCount, setDeviceCount] = useState(0);
  const [devicesTruncated, setDevicesTruncated] = useState(false);
  const [devicesSubmitting, setDevicesSubmitting] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [replenishment, setReplenishment] = useState<ReplenishmentItem[]>([]);
  const [replenishmentWindow, setReplenishmentWindow] = useState(28);
  const [replenishmentTruncated, setReplenishmentTruncated] = useState(false);
  const [replenishmentLoading, setReplenishmentLoading] = useState(false);
  const [replenishmentError, setReplenishmentError] = useState<string | null>(null);
  const [policySavingProductId, setPolicySavingProductId] = useState<string | null>(null);
  const [returnableSales, setReturnableSales] = useState<ReturnableSale[]>([]);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [returnsError, setReturnsError] = useState<string | null>(null);
  const [returnSubmitting, setReturnSubmitting] = useState(false);
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
  // Held in a ref and handed over as a stable callback: the hook keeps this in
  // its dependencies, and a fresh function each render would rebuild the sync
  // loop on every render and fire it again with it.
  const ensureShiftRef = useRef<() => Promise<void>>(async () => {});
  ensureShiftRef.current = () => ensureShiftSynced();
  const ensureShiftSyncedStable = useCallback(() => ensureShiftRef.current(), []);

  /**
   * Остатки, которые не врут через час работы.
   *
   * Сессия с товарами лежит в localStorage и переживает перезагрузку — так
   * задумано: касса обязана открыться без сети. Но пока каталог никто не
   * перечитывал, плитки показывают цифры того момента, когда эта касса
   * последний раз входила. Вторая касса продала хлеб — здесь по-прежнему «ост.
   * 39», и кассир обещает покупателю то, чего нет. Сервер такую продажу
   * отклонит, но узнает об этом покупатель у прилавка, и виноватой будет
   * выглядеть касса.
   *
   * Поэтому каталог перечитывается, когда касса возвращается к работе: при
   * запуске, когда экран снова стал видимым, когда вернулась сеть — и не чаще
   * раза в минуту, пока смотрят на витрину. Не поток обновлений: продукт живёт
   * без сети неделю, и превращать его в устройство, которое всё время ходит в
   * интернет, ради секундной свежести неправильно.
   *
   * Не трогает каталог, пока в корзине что-то есть: менять плитки под пальцем
   * посреди чека — это ровно та секунда, когда кассиру нужно, чтобы экран стоял
   * на месте. Итог чека от этого не зависит: цена запоминается в строке
   * корзины.
   */
  const refreshCatalogRef = useRef<() => void>(() => {});
  useEffect(() => {
    refreshCatalogRef.current = () => void refreshCatalogAfterStockChange();
  });
  useEffect(() => {
    if (!session?.token || !currentLocationId) return;
    let lastAt = 0;
    const refresh = (trigger: RefreshTrigger) => {
      const allowed = shouldRefreshCatalog(trigger, {
        online: navigator.onLine,
        visible: document.visibilityState === 'visible',
        cartLines: cartRef.current.length,
        sinceLastMs: Date.now() - lastAt,
      });
      if (!allowed) return;
      lastAt = Date.now();
      refreshCatalogRef.current();
    };

    refresh('open');
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh('visible');
    };
    const onOnline = () => refresh('online');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => refresh('tick'), CATALOG_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [session?.token, currentLocationId]);

  // The warehouse's own queue. Separate from the till's because the two obey
  // opposite rules on refusal: a rejected sale is skipped so it cannot strand
  // the day's takings, a rejected warehouse command stops the queue because
  // everything behind it was given against the world it was meant to make.
  const { t } = useTranslation();
  const outbox = useOutboxSync(session?.token ?? null);

  // Whether the till can be opened without a network at all, as opposed to
  // whether it has one right now. See offline.ts.
  const offlineReadiness = useOfflineReadiness();
  const { online, pendingCount, stuckCount, refreshPendingCount, sync } = useSalesSync(
    session?.token ?? null,
    ensureShiftSyncedStable,
  );

  // Перечитывается, когда меняется счётчик неотправленных — а он обновляется
  // после каждой попытки синхронизации. То есть подпись на чеке перестаёт
  // говорить «не синхронизирован» ровно тогда, когда продажа доходит.
  const lastSale = useMemo(
    () => (lastSaleId ? getSales().find((s) => s.id === lastSaleId) ?? null : null),
    [lastSaleId, pendingCount],
  );
  const hasSupply = session?.modules?.includes('supply') ?? false;
  const hasTerminal = session?.modules?.includes('terminal') ?? false;
  const hasPharmacy = session?.modules?.includes('pharmacy') ?? false;
  const hasRestaurant = session?.modules?.includes('restaurant') ?? false;
  const hasWarehouse = session?.modules?.includes('warehouse') ?? false;
  const hasRetail = session?.modules?.includes('retail') ?? false;
  const isDesktop = useIsDesktop();
  const canManageProducts = session?.user.role === 'owner' || session?.user.role === 'manager';
  // Only when this deployment was told where the storefront lives. Without it
  // there is no address to give, and inventing one sends partners elsewhere.
  const storefrontUrl =
    hasSupply && session?.company.slug && ORDERS_BASE ? `${ORDERS_BASE}/${session.company.slug}` : null;
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

  // Resolved from the list rather than held as its own copy: the list is
  // reloaded after every pick, and a second copy would go stale the moment it
  // was.
  const pickingOrder = orders.find((o) => o.id === pickingOrderId) ?? null;

  const operationsItems: OperationItem[] = [];
  if (hasSupply) {
    operationsItems.push({ key: 'orders', group: 'suppliers', icon: 'orders', label: t('ops.orders'), badge: pendingOrdersCount, onClick: () => { setView('orders'); void loadOrders(); } });
  }
  if (hasPharmacy) {
    operationsItems.push({ key: 'batches', group: 'stock', icon: 'batches', label: t('ops.batches'), badge: expiringBatchesCount, onClick: handleShowBatches });
  }
  if (hasWarehouse) {
    operationsItems.push(
      { key: 'transfers', group: 'stock', icon: 'transfer', label: t('ops.transfers'), onClick: handleShowTransfers },
      { key: 'incoming', group: 'stock', icon: 'inbox', label: t('ops.incoming'), onClick: handleShowIncoming },
      { key: 'counts', group: 'stock', icon: 'clipboard', label: t('ops.counts'), onClick: handleShowCounts },
      { key: 'returns', group: 'money', icon: 'return', label: t('ops.returns'), onClick: handleShowReturns },
      { key: 'replenishment', group: 'suppliers', icon: 'replenish', label: t('ops.replenishment'), onClick: handleShowReplenishment },
      { key: 'purchase-orders', group: 'suppliers', icon: 'doc', label: t('ops.purchaseOrders'), onClick: handleShowPurchaseOrders },
      { key: 'bins', group: 'stock', icon: 'bins', label: t('ops.bins'), onClick: handleShowBins },
      { key: 'bin-count', group: 'stock', icon: 'binCount', label: t('ops.binCount'), onClick: handleShowBinCount },
      { key: 'reconciliation', group: 'money', icon: 'scales', label: t('ops.reconciliation'), onClick: handleShowReconciliation },
      { key: 'import', group: 'setup', icon: 'import', label: t('ops.import'), onClick: handleShowImport },
      { key: 'migrate', group: 'setup', icon: 'migrate', label: t('ops.migrate'), onClick: handleShowMigrate },
      { key: 'delivery', group: 'suppliers', icon: 'delivery', label: t('ops.delivery'), onClick: handleShowDelivery },
      { key: 'price-list', group: 'suppliers', icon: 'priceList', label: t('ops.priceList'), onClick: handleShowPriceList },
      { key: 'cabinet', group: 'setup', icon: 'key', label: t('ops.cabinet'), onClick: handleShowCabinet },
      { key: 'settlements', group: 'money', icon: 'wallet', label: t('ops.settlements'), onClick: handleShowSettlements },
      { key: 'write-offs', group: 'stock', icon: 'trash', label: t('ops.writeOffs'), onClick: handleShowWriteOffs },
      { key: 'supplier-returns', group: 'suppliers', icon: 'returnUp', label: t('ops.supplierReturns'), onClick: handleShowSupplierReturns },
      { key: 'fiscal', group: 'money', icon: 'receipt', label: t('ops.fiscal'), onClick: handleShowFiscal },
      { key: 'production', group: 'stock', icon: 'factory', label: t('ops.production'), onClick: handleShowProduction },
    );
  }
  if (hasRestaurant) {
    operationsItems.push(
      { key: 'floorplan', group: 'restaurant', icon: 'table', label: t('floor.title'), onClick: handleShowFloorPlan },
      { key: 'kds', group: 'restaurant', icon: 'flame', label: t('kds.title'), onClick: handleShowKds },
    );
  }
  if (hasTerminal) {
    operationsItems.push({ key: 'stock-history', group: 'money', icon: 'history', label: t('ops.stockHistory'), onClick: handleShowStockHistory });
  }
  const operationsBadge = pendingOrdersCount + expiringBatchesCount;

  // The summary is written for whoever answers for the money, so it is only
  // offered to them — a cashier seeing colleagues' refund rates is a different
  // product with different consequences.
  const isOwnerOrManager = session?.user.role === 'owner' || session?.user.role === 'manager';

  const activeTab: MainTab =
    view === 'products' || view === 'product-edit' ? 'products' :
    OPERATIONS_VIEWS.has(view) ? 'operations' :
    view === 'profile' || view === 'reports' || view === 'dashboard' || view === 'audit' || view === 'export' || view === 'documents' || view === 'devices' ? 'profile' :
    'sale';

  function handleLogin(newSession: PosSession) {
    saveSession(newSession);
    setSession(newSession);
  }

  function handleLogout() {
    saveSession(null);
    setSession(null);
  }

  // A register works at one location at a time: stock, receiving, counts and
  // reports all mean something different in the shop than in the warehouse.
  // A remembered location the company no longer has is dropped rather than
  // sent — it would only earn a 404 from every call.
  async function handleSwitchLocation(nextLocationId: string) {
    if (!session || nextLocationId === currentLocationId) return;
    // A shift belongs to the location it was opened at, and its sales are
    // booked there. Switching underneath an open shift would file the rest of
    // the day's takings against a point nobody was standing in.
    if (shift) {
      setLocationSwitchError(t('fail.closeShiftFirst'));
      return;
    }
    setLocationSwitching(true);
    setLocationSwitchError(null);
    try {
      // The grid only moves once the new location's stock is in hand. Moving
      // first and failing here would leave the cashier reading one point's
      // figures while every sale is booked against another.
      const { products } = await fetchCatalog(session.token, nextLocationId);
      const updated: PosSession = { ...session, products, catalogLocationId: nextLocationId };
      saveSession(updated);
      setSession(updated);
      saveCurrentLocationId(nextLocationId);
      setRememberedLocationId(nextLocationId);
      setCart([]);
    } catch (err) {
      setLocationSwitchError(err instanceof ApiError ? err.message : t('fail.switchLocation'));
    } finally {
      setLocationSwitching(false);
    }
  }

  async function loadOrders() {
    if (!session) return;
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const data = await fetchOrders(session.token);
      setOrders(data);
    } catch (err) {
      setOrdersError(err instanceof ApiError ? err.message : t('fail.loadOrders'));
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
    setBusyOrder({ id, action: 'fulfill' });
    try {
      await fulfillOrder(session.token, id);
      await loadOrders();
    } catch (err) {
      setOrdersError(err instanceof ApiError ? err.message : t('fail.issueOrder'));
    } finally {
      setBusyOrder(null);
    }
  }

  async function handleRejectOrder(id: string) {
    if (!session) return;
    setBusyOrder({ id, action: 'reject' });
    try {
      await rejectOrder(session.token, id);
      await loadOrders();
    } catch (err) {
      setOrdersError(err instanceof ApiError ? err.message : t('fail.rejectOrder'));
    } finally {
      setBusyOrder(null);
    }
  }

  async function loadReport(days: number) {
    if (!session || !currentLocationId) return;
    setReportsLoading(true);
    setReportsError(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
      const data = await fetchReports(session.token, from.toISOString(), to.toISOString(), currentLocationId);
      setReport(data);
    } catch (err) {
      setReportsError(err instanceof ApiError ? err.message : t('fail.loadReport'));
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
    if (!session || !currentLocationId) return;
    setBatchesLoading(true);
    setBatchesError(null);
    try {
      const data = await fetchBatches(session.token, currentLocationId);
      setBatches(data);
    } catch (err) {
      setBatchesError(err instanceof ApiError ? err.message : t('fail.loadBatches'));
    } finally {
      setBatchesLoading(false);
    }
  }

  function handleShowBatches() {
    setView('batches');
    void loadBatches();
  }

  async function handleReceiveBatch(payload: { productId: string; batchNumber: string; expiryDate: string; quantity: number }) {
    if (!session || !currentLocationId) return false;
    setBatchSubmitting(true);
    setBatchesError(null);
    try {
      await receiveBatch(session.token, { ...payload, locationId: currentLocationId });
      await loadBatches();
      return true;
    } catch (err) {
      setBatchesError(err instanceof ApiError ? err.message : t('fail.receiveBatch'));
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
      setTransfersError(err instanceof ApiError ? err.message : t('fail.loadTransfers'));
    } finally {
      setTransfersLoading(false);
    }
  }

  function handleShowTransfers() {
    setView('transfers');
    void loadTransfers();
  }

  // Receiving is the far end signing for what actually turned up. A count
  // that comes up short still goes through — the goods are gone either way,
  // and the difference is what the owner needs to see.
  async function handleReceiveTransfer(transferId: string, items: { productId: string; receivedQuantity: number }[]) {
    if (!session || !currentLocationId) return false;
    setTransfersError(null);
    try {
      await receiveTransfer(session.token, transferId, { locationId: currentLocationId, items });
      await loadTransfers();
      return true;
    } catch (err) {
      setTransfersError(err instanceof ApiError ? err.message : t('fail.receiveTransfer'));
      return false;
    }
  }

  async function handleCancelTransfer(transferId: string) {
    if (!session) return false;
    setTransfersError(null);
    try {
      await cancelTransfer(session.token, transferId);
      await loadTransfers();
      return true;
    } catch (err) {
      setTransfersError(err instanceof ApiError ? err.message : t('fail.cancelTransfer'));
      return false;
    }
  }

  async function handleCreateTransfer(payload: { toLocationId: string; items: { productId: string; quantity: number }[] }) {
    if (!session || !currentLocationId) return false;
    setTransferSubmitting(true);
    setTransfersError(null);
    try {
      await createTransfer(session.token, { ...payload, fromLocationId: currentLocationId });
      await loadTransfers();
      return true;
    } catch (err) {
      setTransfersError(err instanceof ApiError ? err.message : t('fail.sendTransfer'));
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
      setReceiptsError(err instanceof ApiError ? err.message : t('fail.loadReceipts'));
    } finally {
      setReceiptsLoading(false);
    }
  }

  // Only orders a delivery can actually answer. A draft nobody has approved is
  // not something a supplier could have shipped against.
  const openPurchaseOrders = purchaseOrders.filter(
    (order) => order.status === 'sent' || order.status === 'partially_received',
  );

  function handleShowIncoming() {
    setView('incoming');
    void loadReceipts();
  }

  async function handleCreateReceipt(payload: {
    purchaseOrderId: string | null;
    supplierName: string;
    supplierPhone: string;
    items: { productId: string; quantity: number; price: number; packagingId: string | null }[];
  }) {
    if (!session || !currentLocationId) return false;
    setReceiptSubmitting(true);
    setReceiptsError(null);
    try {
      // Written down first, sent second. A dock with a thick wall between it
      // and the router is offline several times an hour without anyone
      // deciding it was, so there is no "are we online" branch here — the
      // command is recorded either way and leaves when it can.
      const command = queueCommand('receipt', { ...payload, locationId: currentLocationId });
      await outbox.drain();
      const outcome = outcomeOf(getOutbox(), command.id);
      // A refusal has to be said here, on the screen holding the form that can
      // fix it. Only what is genuinely still waiting is left to the queue.
      if (outcome.status === 'refused') {
        setReceiptsError(outcome.error);
        return false;
      }
      if (outcome.status === 'queued') return true;

      await loadReceipts();
      // A delivery against an order changes that order's status, so the list
      // the receipt screen offers has to stop offering what is now complete.
      if (payload.purchaseOrderId) await loadPurchaseOrders();
      return true;
    } catch (err) {
      setReceiptsError(err instanceof ApiError ? err.message : t('fail.receiveGoods'));
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
      setCountsError(err instanceof ApiError ? err.message : t('fail.loadCounts'));
    } finally {
      setCountsLoading(false);
    }
  }

  function handleShowCounts() {
    setView('counts');
    void loadCounts();
  }

  async function loadPackagings(productId: string) {
    if (!session) return;
    setPackagingError(null);
    try {
      setEditingPackagings(await fetchPackagings(session.token, productId));
    } catch (err) {
      setPackagingError(err instanceof ApiError ? err.message : t('fail.loadPackagings'));
    }
  }

  async function handleAddPackaging(payload: PackagingPayload) {
    if (!session || !editingProduct) return false;
    setPackagingBusy(true);
    setPackagingError(null);
    try {
      const created = await createPackaging(session.token, editingProduct.id, payload);
      setEditingPackagings((prev) => [...prev, created]);
      // The register reads case barcodes out of its cached catalog, so a new
      // packaging has to reach that cache or the scan won't resolve until the
      // next login.
      applyPackagingsToSession(editingProduct.id, [...editingPackagings, created]);
      return true;
    } catch (err) {
      setPackagingError(err instanceof ApiError ? err.message : t('fail.addPackaging'));
      return false;
    } finally {
      setPackagingBusy(false);
    }
  }

  async function handleDeletePackaging(packagingId: string) {
    if (!session || !editingProduct) return;
    setPackagingBusy(true);
    setPackagingError(null);
    try {
      await deletePackaging(session.token, editingProduct.id, packagingId);
      const remaining = editingPackagings.filter((pack) => pack.id !== packagingId);
      setEditingPackagings(remaining);
      applyPackagingsToSession(editingProduct.id, remaining);
    } catch (err) {
      setPackagingError(err instanceof ApiError ? err.message : t('fail.deletePackaging'));
    } finally {
      setPackagingBusy(false);
    }
  }

  function applyPackagingsToSession(productId: string, packagings: Packaging[]) {
    setSession((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, products: prev.products.map((p) => (p.id === productId ? { ...p, packagings } : p)) };
      saveSession(updated);
      return updated;
    });
  }

  function handleShowImport() {
    setView('import');
    setImportSystem(null);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
  }

  // «Перенести товары»: сначала владелец называет свою программу, и только
  // потом видит файловое поле. Порядок принципиальный — сопоставление колонок
  // руками это то место, на котором импорт бросают.
  async function handleShowMigrate() {
    setView('migrate');
    setImportSystem(null);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    if (!session || sourceSystems.length > 0) return;
    setSourceSystemsLoading(true);
    try {
      const result = await fetchSourceSystems(session.token);
      setSourceSystems(result.systems);
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : t('fail.loadSystems'));
    } finally {
      setSourceSystemsLoading(false);
    }
  }

  // Прайс поставщика: разбор файла, потом черновик заказа — и только после
  // того, как человек выбрал строки.
  async function handleShowPriceList() {
    setView('price-list');
    setPriceList(null);
    setPriceListError(null);
    setPriceListOrderId(null);
    if (!session || suppliers.length > 0) return;
    // Список поставщиков нужен только чтобы подписать заказ. Не загрузился —
    // заказ всё равно создастся, просто без поставщика.
    try {
      setSuppliers(await fetchSuppliers(session.token));
    } catch {
      /* см. выше */
    }
  }

  function resetPriceList() {
    setPriceList(null);
    setPriceListError(null);
    setPriceListOrderId(null);
  }

  async function handleMatchPriceList(source: ImportSource) {
    if (!session || !currentLocationId) return;
    setPriceListLoading(true);
    setPriceListError(null);
    try {
      setPriceList(await matchPriceList(session.token, currentLocationId, source));
    } catch (err) {
      setPriceListError(err instanceof ApiError ? err.message : t('fail.matchPriceList'));
    } finally {
      setPriceListLoading(false);
    }
  }

  async function handleCreateOrderFromPriceList(
    supplierId: string | null,
    items: { productId: string; quantity: number; price: number }[],
  ) {
    if (!session || !currentLocationId) return;
    setPriceListSubmitting(true);
    setPriceListError(null);
    try {
      const order = await createPurchaseOrder(session.token, {
        locationId: currentLocationId,
        supplierId,
        note: t('priceList.note'),
        items: items.map((item) => ({ ...item, packagingId: null })),
      });
      setPriceListOrderId(order.id);
    } catch (err) {
      setPriceListError(err instanceof ApiError ? err.message : t('fail.createOrder'));
    } finally {
      setPriceListSubmitting(false);
    }
  }

  // Накладная файлом: разбор, сверка, и только потом приёмка — тремя разными
  // действиями, потому что это три разных утверждения.
  function handleShowDelivery() {
    setView('delivery');
    setDelivery(null);
    setDeliveryError(null);
    setDeliveryReceiptId(null);
  }

  function resetDelivery() {
    setDelivery(null);
    setDeliveryError(null);
    setDeliveryReceiptId(null);
  }

  async function handleMatchDelivery(source: ImportSource) {
    if (!session || !currentLocationId) return;
    setDeliveryLoading(true);
    setDeliveryError(null);
    try {
      setDelivery(await matchDeliveryNote(session.token, currentLocationId, source));
    } catch (err) {
      setDeliveryError(err instanceof ApiError ? err.message : t('fail.matchDelivery'));
    } finally {
      setDeliveryLoading(false);
    }
  }

  async function handleReceiveDelivery(items: { productId: string; quantity: number; price: number }[]) {
    if (!session || !currentLocationId) return;
    setDeliverySubmitting(true);
    setDeliveryError(null);
    try {
      const receipt = await createReceipt(
        session.token,
        {
          locationId: currentLocationId,
          // Поставщика на этом экране не спрашиваем: накладная уже названа
          // файлом, а лишнее поле между «сверил» и «принял» — это лишний повод
          // отложить приёмку. Кто привёз, дописывается в документе.
          supplierName: '',
          supplierPhone: '',
          items: items.map((item) => ({ ...item, packagingId: null })),
        },
        genId('delivery'),
      );
      setDeliveryReceiptId(receipt.id);
      await refreshCatalogAfterStockChange();
    } catch (err) {
      setDeliveryError(err instanceof ApiError ? err.message : t('fail.receive'));
    } finally {
      setDeliverySubmitting(false);
    }
  }

  async function handleShowCabinet() {
    setView('cabinet');
    setCabinetError(null);
    if (!session) return;
    setCabinetLoading(true);
    try {
      setCabinet(await fetchCabinet(session.token));
    } catch (err) {
      setCabinetError(err instanceof ApiError ? err.message : t('fail.loadCabinet'));
    } finally {
      setCabinetLoading(false);
    }
  }

  async function handleResetCabinet() {
    if (!session) return;
    setCabinetResetting(true);
    setCabinetError(null);
    try {
      setCabinet(await resetCabinetLink(session.token));
    } catch (err) {
      setCabinetError(err instanceof ApiError ? err.message : t('fail.loadCabinet'));
    } finally {
      setCabinetResetting(false);
    }
  }

  function handleChooseSystem(system: SourceSystemInfo) {
    setImportSystem(system);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setView('import');
  }

  function resetImport() {
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
  }

  async function handlePreviewImport(source: ImportSource) {
    if (!session) return;
    setImportLoading(true);
    setImportError(null);
    try {
      setImportPreview(await previewImport(session.token, source, importSystem?.id ?? null));
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : t('fail.checkFile'));
    } finally {
      setImportLoading(false);
    }
  }

  async function handleCommitImport(source: ImportSource) {
    if (!session || !currentLocationId) return;
    setImportSubmitting(true);
    setImportError(null);
    try {
      // A key per attempt: importing a thousand products twice because a reply
      // was lost would double the catalogue.
      const result = await commitImport(
        session.token,
        currentLocationId,
        source,
        genId('import'),
        importSystem?.id ?? null,
      );
      setImportResult(result);
      setImportPreview(null);
      // The register sells from its cached catalogue, so it has to hear about
      // a thousand new products.
      await refreshCatalogAfterStockChange();
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : t('fail.import'));
    } finally {
      setImportSubmitting(false);
    }
  }

  async function loadReconciliation() {
    if (!session || !currentLocationId) return;
    setReconciliationLoading(true);
    setReconciliationError(null);
    try {
      setReconciliation(await fetchReconciliation(session.token, currentLocationId));
    } catch (err) {
      setReconciliationError(err instanceof ApiError ? err.message : t('fail.reconcile'));
    } finally {
      setReconciliationLoading(false);
    }
  }

  function handleShowReconciliation() {
    setView('reconciliation');
    void loadReconciliation();
  }

  async function handleRepairReconciliation() {
    if (!session || !currentLocationId) return;
    setReconciliationRepairing(true);
    setReconciliationError(null);
    try {
      await repairReconciliation(session.token, currentLocationId);
      await loadReconciliation();
      // The corrected figures are what the register sells against.
      await refreshCatalogAfterStockChange();
    } catch (err) {
      setReconciliationError(err instanceof ApiError ? err.message : t('fail.repairStock'));
    } finally {
      setReconciliationRepairing(false);
    }
  }

  function handleShowBinCount() {
    setView('bin-count');
    setCountSheet(null);
    setBinCountError(null);
    void loadBins();
  }

  async function handleOpenCountBin(bin: string) {
    // The back arrow inside the sheet asks for this sentinel rather than a
    // real bin: it means "put the sheet away", not "open another shelf".
    if (bin === '__none__') {
      setCountSheet(null);
      return;
    }
    if (!session || !currentLocationId) return;
    setCountSheetLoading(true);
    setBinCountError(null);
    try {
      const sheet = await fetchCountSheet(session.token, currentLocationId, bin);
      saveCachedCountSheet(currentLocationId, sheet);
      setCountSheet(sheet);
      setCountSheetCachedAt(null);
    } catch (err) {
      // A stock room is exactly where the signal isn't, so falling back to the
      // sheet this device last saw is the difference between counting the
      // shelf and standing in front of it unable to. The figures may be old;
      // the count is still a statement about the shelf, and the server works
      // out the discrepancy against its own ledger as it stood when the shelf
      // was walked.
      const cached = getCachedCountSheet(currentLocationId, bin);
      if (cached) {
        setCountSheet({ bin: cached.bin, lines: cached.lines });
        setCountSheetCachedAt(cached.cachedAt);
      } else {
        setBinCountError(err instanceof ApiError ? err.message : t('fail.loadBin'));
      }
    } finally {
      setCountSheetLoading(false);
    }
  }

  async function handleSubmitBinCount(bin: string, lines: { productId: string; countedQuantity: number }[]) {
    if (!session || !currentLocationId) return false;
    setBinCountSubmitting(true);
    setBinCountError(null);
    try {
      const command = queueCommand('binCount', {
        locationId: currentLocationId,
        bins: [bin],
        items: lines.map((line) => ({ ...line, binLocation: bin })),
        // Stamped now, when the shelf was actually walked — not when this
        // reaches the server, which may be hours later. The server rewinds its
        // ledger to this moment so the count applies the difference it
        // asserted instead of an absolute figure that would undo the
        // afternoon's trade.
        countedAt: new Date().toISOString(),
      });
      const results = await outbox.drain();
      const result = results.get(command.id) as { adjustments: BinCountAdjustmentResult[] } | undefined;
      setCountSheet(null);

      if (!result) {
        const outcome = outcomeOf(getOutbox(), command.id);
        if (outcome.status === 'refused') {
          setBinCountError(outcome.error);
          return false;
        }
        // It is queued, not applied. Showing an empty discrepancy table here
        // would read as "the shelf agreed", which is the one thing we do not
        // yet know.
        setBinCountResult(null);
        setBinCountQueued(bin);
        return true;
      }

      setBinCountQueued(null);
      const nameByProductId = new Map(session.products.map((p) => [p.id, p.name]));
      setBinCountResult(
        result.adjustments.map((adjustment: BinCountAdjustmentResult) => ({
          binLocation: adjustment.binLocation,
          name: nameByProductId.get(adjustment.productId) ?? '—',
          systemQuantity: adjustment.systemQuantity,
          countedQuantity: adjustment.countedQuantity,
          delta: adjustment.delta,
        })),
      );
      // A count changes what the register may sell, so its cached grid has to
      // hear about it.
      await refreshCatalogAfterStockChange();
      await loadBins();
      return true;
    } catch (err) {
      setBinCountError(err instanceof ApiError ? err.message : t('fail.saveCount'));
      return false;
    } finally {
      setBinCountSubmitting(false);
    }
  }

  async function loadSettlements(type: 'customer' | 'supplier') {
    if (!session) return;
    setSettlementsLoading(true);
    setSettlementsError(null);
    try {
      const data = await fetchSettlements(session.token, type);
      setSettlementAccounts(data.accounts);
    } catch (err) {
      setSettlementsError(err instanceof ApiError ? err.message : t('fail.loadSettlements'));
    } finally {
      setSettlementsLoading(false);
    }
  }

  function handleShowSettlements() {
    setView('settlements');
    void loadSettlements(settlementType);
  }

  function handleChangeSettlementType(type: 'customer' | 'supplier') {
    setSettlementType(type);
    void loadSettlements(type);
  }

  async function handleRecordSettlement(counterpartyId: string, amount: number) {
    if (!session || !currentLocationId) return false;
    setSettlementsSubmitting(true);
    setSettlementsError(null);
    try {
      await recordSettlement(session.token, {
        locationId: currentLocationId,
        counterpartyId,
        amount,
        paymentMethod: 'cash',
      });
      await loadSettlements(settlementType);
      return true;
    } catch (err) {
      setSettlementsError(err instanceof ApiError ? err.message : t('fail.postPayment'));
      return false;
    } finally {
      setSettlementsSubmitting(false);
    }
  }

  async function handleSetCredit(counterpartyId: string, creditAllowed: boolean, creditLimit: number) {
    if (!session) return false;
    setSettlementsSubmitting(true);
    setSettlementsError(null);
    try {
      await setCounterpartyCredit(session.token, counterpartyId, creditAllowed, creditLimit);
      await loadSettlements(settlementType);
      return true;
    } catch (err) {
      setSettlementsError(err instanceof ApiError ? err.message : t('fail.changeCredit'));
      return false;
    } finally {
      setSettlementsSubmitting(false);
    }
  }

  async function loadBins() {
    if (!session || !currentLocationId) return;
    setBinsLoading(true);
    setBinsError(null);
    try {
      const data = await fetchBins(session.token, currentLocationId);
      setBins(data.bins);
      setUnplaced(data.unplaced);
    } catch (err) {
      setBinsError(err instanceof ApiError ? err.message : t('fail.loadBins'));
    } finally {
      setBinsLoading(false);
    }
  }

  function handleShowBins() {
    setView('bins');
    void loadBins();
  }

  async function handleCreateBin(address: { zone: string; rack: string; shelf: string; bin: string }) {
    if (!session || !currentLocationId) return false;
    setBinsSubmitting(true);
    setBinsError(null);
    try {
      await createBin(session.token, { ...address, locationId: currentLocationId });
      await loadBins();
      return true;
    } catch (err) {
      setBinsError(err instanceof ApiError ? err.message : t('fail.createBin'));
      return false;
    } finally {
      setBinsSubmitting(false);
    }
  }

  async function handleDeleteBin(binId: string) {
    if (!session) return;
    setBinsError(null);
    try {
      await deleteBin(session.token, binId);
      await loadBins();
    } catch (err) {
      setBinsError(err instanceof ApiError ? err.message : t('fail.deleteBin'));
    }
  }

  async function handleBlockBin(binId: string, note: string) {
    if (!session) return false;
    setBinsSubmitting(true);
    setBinsError(null);
    try {
      await blockBin(session.token, binId, { note, reasonCode: 'quality' });
      await loadBins();
      // Blocked goods stop being sellable, so the register's cached grid has to
      // hear about it.
      await refreshCatalogAfterStockChange();
      return true;
    } catch (err) {
      setBinsError(err instanceof ApiError ? err.message : t('fail.blockBin'));
      return false;
    } finally {
      setBinsSubmitting(false);
    }
  }

  async function handleUnblockBin(binId: string) {
    if (!session) return;
    setBinsSubmitting(true);
    setBinsError(null);
    try {
      await unblockBin(session.token, binId);
      await loadBins();
      await refreshCatalogAfterStockChange();
    } catch (err) {
      setBinsError(err instanceof ApiError ? err.message : t('fail.unblockBin'));
    } finally {
      setBinsSubmitting(false);
    }
  }

  async function handlePutaway(payload: { productId: string; quantity: number; fromBin: string; toBin: string }) {
    if (!session || !currentLocationId) return false;
    setBinsSubmitting(true);
    setBinsError(null);
    try {
      const command = queueCommand('putaway', { ...payload, locationId: currentLocationId });
      await outbox.drain();
      const outcome = outcomeOf(getOutbox(), command.id);
      if (outcome.status === 'refused') {
        setBinsError(outcome.error);
        return false;
      }
      if (outcome.status === 'queued') return true;

      await loadBins();
      return true;
    } catch (err) {
      setBinsError(err instanceof ApiError ? err.message : t('fail.putaway'));
      return false;
    } finally {
      setBinsSubmitting(false);
    }
  }

  async function loadWriteOffs() {
    if (!session || !currentLocationId) return;
    setWriteOffLoading(true);
    setWriteOffError(null);
    try {
      setWriteOffs(await fetchWriteOffs(session.token, currentLocationId));
    } catch (err) {
      setWriteOffError(err instanceof ApiError ? err.message : t('fail.loadWriteOffs'));
    } finally {
      setWriteOffLoading(false);
    }
  }

  function handleShowWriteOffs() {
    setView('write-offs');
    void loadWriteOffs();
  }

  // Both of these change what the register may sell, so the catalog it holds
  // has to be refreshed — otherwise a cashier keeps being offered goods that
  // are now in a bin or in quarantine.
  async function refreshCatalogAfterStockChange() {
    if (!session || !currentLocationId) return;
    try {
      const { products } = await fetchCatalog(session.token, currentLocationId);
      const updated = { ...session, products, catalogLocationId: currentLocationId };
      saveSession(updated);
      setSession(updated);
    } catch {
      // Offline: the grid stays as it was until the next successful load.
    }
  }

  async function handleCreateWriteOff(payload: {
    reasonCode: WriteOffReason;
    note: string;
    items: { productId: string; quantity: number }[];
  }) {
    if (!session || !currentLocationId) return false;
    setWriteOffSubmitting(true);
    setWriteOffError(null);
    try {
      const command = queueCommand('writeOff', { ...payload, locationId: currentLocationId });
      await outbox.drain();
      const outcome = outcomeOf(getOutbox(), command.id);
      if (outcome.status === 'refused') {
        setWriteOffError(outcome.error);
        return false;
      }
      if (outcome.status === 'queued') return true;

      await loadWriteOffs();
      await refreshCatalogAfterStockChange();
      return true;
    } catch (err) {
      setWriteOffError(err instanceof ApiError ? err.message : t('fail.writeOff'));
      return false;
    } finally {
      setWriteOffSubmitting(false);
    }
  }

  async function handleQuarantine(
    action: 'block' | 'release',
    payload: { note: string; items: { productId: string; quantity: number }[] },
  ) {
    if (!session || !currentLocationId) return false;
    setWriteOffSubmitting(true);
    setWriteOffError(null);
    try {
      await changeQuarantine(session.token, action, { ...payload, locationId: currentLocationId });
      await loadWriteOffs();
      await refreshCatalogAfterStockChange();
      return true;
    } catch (err) {
      setWriteOffError(err instanceof ApiError ? err.message : t('fail.changeQuarantine'));
      return false;
    } finally {
      setWriteOffSubmitting(false);
    }
  }

  async function loadPurchaseOrders() {
    if (!session || !currentLocationId) return;
    setPurchaseLoading(true);
    setPurchaseError(null);
    try {
      const [orders, suppliersList] = await Promise.all([
        fetchPurchaseOrders(session.token, currentLocationId),
        fetchSuppliers(session.token),
      ]);
      setPurchaseOrders(orders);
      setSuppliers(suppliersList);
    } catch (err) {
      setPurchaseError(err instanceof ApiError ? err.message : t('fail.loadOrders'));
    } finally {
      setPurchaseLoading(false);
    }
  }

  function handleShowPurchaseOrders() {
    setView('purchase-orders');
    void loadPurchaseOrders();
  }

  async function handleCreatePurchaseOrder(payload: {
    supplierId: string | null;
    note: string;
    items: { productId: string; quantity: number; price: number; packagingId: string | null }[];
  }) {
    if (!session || !currentLocationId) return false;
    setPurchaseSubmitting(true);
    setPurchaseError(null);
    try {
      await createPurchaseOrder(session.token, { ...payload, locationId: currentLocationId });
      await loadPurchaseOrders();
      return true;
    } catch (err) {
      setPurchaseError(err instanceof ApiError ? err.message : t('fail.createOrder'));
      return false;
    } finally {
      setPurchaseSubmitting(false);
    }
  }

  async function handleActOnPurchaseOrder(orderId: string, action: 'approve' | 'send' | 'cancel') {
    if (!session) return;
    setBusyOrderId(orderId);
    setPurchaseError(null);
    try {
      await actOnPurchaseOrder(session.token, orderId, action);
      await loadPurchaseOrders();
    } catch (err) {
      setPurchaseError(err instanceof ApiError ? err.message : t('fail.changeOrderStatus'));
    } finally {
      setBusyOrderId(null);
    }
  }

  // The recommendation is only worth making if there is somewhere to press it.
  // Everything the list says to buy becomes one draft order, at each item's own
  // purchase price, for a person to check and approve.
  async function handleOrderEverythingRecommended() {
    if (!session || !currentLocationId || replenishment.length === 0) return;
    const items = replenishment.map((item) => {
      const product = session.products.find((p) => p.id === item.productId);
      return {
        productId: item.productId,
        quantity: item.recommended,
        price: product?.price ?? 0,
        packagingId: null,
      };
    });
    const created = await handleCreatePurchaseOrder({ supplierId: null, note: t('po.fromReplenishment'), items });
    if (created) setView('purchase-orders');
  }

  async function loadFiscal() {
    if (!session || !currentLocationId) return;
    setFiscalLoading(true);
    setFiscalError(null);
    try {
      const data = await fetchPendingFiscal(session.token, currentLocationId);
      setFiscalDevice(data.device);
      setPendingFiscal(data.receipts);
    } catch (err) {
      setFiscalError(err instanceof ApiError ? err.message : t('fail.loadFiscal'));
    } finally {
      setFiscalLoading(false);
    }
  }

  function handleShowFiscal() {
    setView('fiscal');
    void loadFiscal();
  }

  async function handleRegisterFiscal(documentId: string, fiscalNumber: string) {
    if (!session) return false;
    setFiscalBusyDocumentId(documentId);
    setFiscalError(null);
    try {
      await registerFiscalManually(session.token, documentId, fiscalNumber);
      await loadFiscal();
      return true;
    } catch (err) {
      setFiscalError(err instanceof ApiError ? err.message : t('fail.saveReceiptNumber'));
      return false;
    } finally {
      setFiscalBusyDocumentId(null);
    }
  }

  async function loadDashboard(days: number) {
    if (!session || !currentLocationId) return;
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      setDashboard(await fetchOwnerDashboard(session.token, currentLocationId, days));
    } catch (err) {
      setDashboardError(err instanceof ApiError ? err.message : t('fail.loadDashboard'));
    } finally {
      setDashboardLoading(false);
    }
  }

  async function loadAudit(days: number) {
    if (!session) return;
    setAuditLoading(true);
    setAuditError(null);
    try {
      const data = await fetchAuditLog(session.token, days);
      setAuditEntries(data.entries);
      setAuditRoundTrips(data.priceRoundTrips);
    } catch (err) {
      setAuditError(err instanceof ApiError ? err.message : t('fail.loadAudit'));
    } finally {
      setAuditLoading(false);
    }
  }

  async function loadDevices() {
    if (!session) return;
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const listed = await fetchDevices(session.token);
      setDevices(listed.devices);
      setDeviceCount(listed.total);
      setDevicesTruncated(listed.truncated);
    } catch (err) {
      setDevicesError(err instanceof ApiError ? err.message : t('fail.loadDevices'));
    } finally {
      setDevicesLoading(false);
    }
  }

  function handleShowDevices() {
    setView('devices');
    void loadDevices();
  }

  async function handleRenameDevice(id: string, label: string) {
    if (!session) return;
    setDevicesSubmitting(true);
    try {
      await renameDevice(session.token, id, label);
      await loadDevices();
    } catch (err) {
      setDevicesError(err instanceof ApiError ? err.message : t('fail.renameDevice'));
    } finally {
      setDevicesSubmitting(false);
    }
  }

  async function handleRevokeDevice(id: string) {
    if (!session) return;
    setDevicesSubmitting(true);
    try {
      await revokeDevice(session.token, id);
      await loadDevices();
    } catch (err) {
      setDevicesError(err instanceof ApiError ? err.message : t('fail.revokeDevice'));
    } finally {
      setDevicesSubmitting(false);
    }
  }

  async function handleRestoreDevice(id: string) {
    if (!session) return;
    setDevicesSubmitting(true);
    try {
      await restoreDevice(session.token, id);
      await loadDevices();
    } catch (err) {
      setDevicesError(err instanceof ApiError ? err.message : t('fail.restoreDevice'));
    } finally {
      setDevicesSubmitting(false);
    }
  }

  async function openDocuments(title: string, subtitle: string, filter: Omit<DocumentFilter, 'locationId'>) {
    if (!session || !currentLocationId) return;
    setDocumentsTitle(title);
    setDocumentsSubtitle(subtitle);
    setDocuments([]);
    setDocumentsError(null);
    setDocumentsLoading(true);
    setView('documents');
    try {
      const data = await fetchDocuments(session.token, { ...filter, locationId: currentLocationId });
      setDocuments(data.documents);
    } catch (err) {
      setDocumentsError(err instanceof ApiError ? err.message : t('fail.loadDocuments'));
    } finally {
      setDocumentsLoading(false);
    }
  }

  function handleShowShiftDocuments(shiftId: string, cashierName: string) {
    void openDocuments(
      t('documents.shiftTitle', { name: cashierName }),
      t('documents.shiftWhy'),
      // Sales and returns, because both move the drawer and the reconciliation
      // is built from the two together.
      { shiftId, type: 'sale,return' },
    );
  }

  function handleShowUserDocuments(userId: string, name: string) {
    void openDocuments(
      t('documents.userTitle', { name }),
      t('documents.userWhy'),
      { createdBy: userId, type: 'return,write_off', days: dashboardDays },
    );
  }

  function handleShowPickOrder(orderId: string) {
    setPickingOrderId(orderId);
    setPickError(null);
    setView('pick-order');
  }

  async function handleSavePick(items: { productId: string; quantity: number }[]) {
    if (!session || !pickingOrderId) return false;
    setPickSubmitting(true);
    setPickError(null);
    try {
      await pickOrder(session.token, pickingOrderId, items);
      await loadOrders();
      return true;
    } catch (err) {
      setPickError(err instanceof ApiError ? err.message : t('fail.savePick'));
      return false;
    } finally {
      setPickSubmitting(false);
    }
  }

  async function handleShipOrder() {
    if (!session || !pickingOrderId) return false;
    setPickSubmitting(true);
    setPickError(null);
    try {
      await shipOrder(session.token, pickingOrderId);
      await loadOrders();
      // Goods left the shelf, so the register's cached grid has to hear about it.
      await refreshCatalogAfterStockChange();
      setView('orders');
      setPickingOrderId(null);
      return true;
    } catch (err) {
      setPickError(err instanceof ApiError ? err.message : t('fail.shipOrder'));
      return false;
    } finally {
      setPickSubmitting(false);
    }
  }

  async function loadSupplierReturns() {
    if (!session || !currentLocationId) return;
    setSupplierReturnsLoading(true);
    setSupplierReturnsError(null);
    try {
      setSupplierReturns(await fetchSupplierReturns(session.token, currentLocationId));
    } catch (err) {
      setSupplierReturnsError(err instanceof ApiError ? err.message : t('fail.loadReturns'));
    } finally {
      setSupplierReturnsLoading(false);
    }
  }

  function handleShowSupplierReturns() {
    setView('supplier-returns');
    void loadSupplierReturns();
    // The list of deliveries a return can be filed against.
    void loadReceipts();
  }

  async function handleCreateSupplierReturn(payload: {
    receiptId: string;
    reasonCode: string;
    note: string;
    items: { productId: string; quantity: number }[];
  }) {
    if (!session || !currentLocationId) return false;
    setSupplierReturnSubmitting(true);
    setSupplierReturnsError(null);
    try {
      await createSupplierReturn(session.token, { ...payload, locationId: currentLocationId });
      await loadSupplierReturns();
      // Goods left the shelf, so the register's cached grid has to hear about it.
      await refreshCatalogAfterStockChange();
      return true;
    } catch (err) {
      setSupplierReturnsError(err instanceof ApiError ? err.message : t('fail.createReturn'));
      return false;
    } finally {
      setSupplierReturnSubmitting(false);
    }
  }

  async function handleExport(dataset: string) {
    if (!session || !currentLocationId) return;
    await downloadExport(session.token, dataset, currentLocationId);
  }

  function handleShowAudit() {
    setView('audit');
    void loadAudit(auditDays);
  }

  function handleChangeAuditDays(days: number) {
    setAuditDays(days);
    void loadAudit(days);
  }

  function handleShowDashboard() {
    setView('dashboard');
    void loadDashboard(dashboardDays);
  }

  function handleChangeDashboardDays(days: number) {
    setDashboardDays(days);
    void loadDashboard(days);
  }

  async function loadReplenishment() {
    if (!session || !currentLocationId) return;
    setReplenishmentLoading(true);
    setReplenishmentError(null);
    try {
      const data = await fetchReplenishment(session.token, currentLocationId);
      setReplenishment(data.items);
      setReplenishmentWindow(data.windowDays);
      setReplenishmentTruncated(data.truncated);
    } catch (err) {
      setReplenishmentError(err instanceof ApiError ? err.message : t('fail.calculateOrder'));
    } finally {
      setReplenishmentLoading(false);
    }
  }

  function handleShowReplenishment() {
    setView('replenishment');
    void loadReplenishment();
  }

  async function handleSaveStockPolicy(
    productId: string,
    policy: { minQuantity: number; targetQuantity: number; leadTimeDays: number },
  ) {
    if (!session || !currentLocationId) return false;
    setPolicySavingProductId(productId);
    setReplenishmentError(null);
    try {
      await saveStockPolicy(session.token, productId, { ...policy, locationId: currentLocationId });
      // Recalculated rather than patched locally: changing a minimum can take
      // an item off the list entirely, and a stale row would keep telling the
      // owner to order something they have just decided they don't need.
      await loadReplenishment();
      return true;
    } catch (err) {
      setReplenishmentError(err instanceof ApiError ? err.message : t('fail.saveStockPolicy'));
      return false;
    } finally {
      setPolicySavingProductId(null);
    }
  }

  async function loadReturns() {
    if (!session || !currentLocationId) return;
    setReturnsLoading(true);
    setReturnsError(null);
    try {
      // Both halves in one go: the screen shows past returns and needs the
      // receipts behind them the moment the cashier taps "new".
      const [sales, made] = await Promise.all([
        fetchReturnableSales(session.token, currentLocationId),
        fetchReturns(session.token, currentLocationId),
      ]);
      setReturnableSales(sales);
      setReturns(made);
    } catch (err) {
      setReturnsError(err instanceof ApiError ? err.message : t('fail.loadReturns'));
    } finally {
      setReturnsLoading(false);
    }
  }

  function handleShowReturns() {
    setView('returns');
    void loadReturns();
  }

  async function handleCreateReturn(payload: {
    saleId: string;
    reason: string;
    paymentMethod: PaymentMethod;
    items: { documentItemId: string; quantity: number }[];
  }) {
    if (!session) return false;
    setReturnSubmitting(true);
    setReturnsError(null);
    try {
      // A fresh key per attempt at a new refund, stable across the retries
      // inside one attempt — a lost reply must not hand the money back twice.
      await createReturn(session.token, payload, genId('return'));
      await loadReturns();
      return true;
    } catch (err) {
      setReturnsError(err instanceof ApiError ? err.message : t('fail.createReturn'));
      return false;
    } finally {
      setReturnSubmitting(false);
    }
  }

  async function handleCreateCount(payload: { items: { productId: string; countedQuantity: number }[] }) {
    if (!session || !currentLocationId) return false;
    setCountSubmitting(true);
    setCountsError(null);
    try {
      await createCount(session.token, {
        ...payload,
        locationId: currentLocationId,
        // Момент обхода, а не момент отправки. Между ними может пройти час
        // торговли — и без этой отметки счёт отменил бы его.
        countedAt: new Date().toISOString(),
      });
      await loadCounts();
      return true;
    } catch (err) {
      setCountsError(err instanceof ApiError ? err.message : t('fail.saveCount'));
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
      setProductionError(err instanceof ApiError ? err.message : t('fail.loadProduction'));
    } finally {
      setProductionLoading(false);
    }
  }

  function handleShowProduction() {
    setView('production');
    void loadProduction();
  }

  async function handleCreateProduction(payload: { productId: string; quantity: number }) {
    if (!session || !currentLocationId) return false;
    setProductionSubmitting(true);
    setProductionError(null);
    try {
      await createProduction(session.token, { ...payload, locationId: currentLocationId });
      await loadProduction();
      return true;
    } catch (err) {
      setProductionError(err instanceof ApiError ? err.message : t('fail.runProduction'));
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
      setStockMovementsError(err instanceof ApiError ? err.message : t('fail.loadHistory'));
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
      setManagedProductsError(err instanceof ApiError ? err.message : t('fail.loadProducts'));
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
    // A product that doesn't exist yet can't have packagings hanging off it.
    setEditingPackagings([]);
    setPackagingError(null);
    setProductSaveError(null);
    setView('product-edit');
  }

  function handleEditProduct(product: ManagedProduct) {
    setEditingProduct(product);
    setEditingPackagings([]);
    setPackagingError(null);
    setProductSaveError(null);
    setView('product-edit');
    void loadPackagings(product.id);
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
      setProductSaveError(err instanceof ApiError ? err.message : t('fail.saveProduct'));
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
      setTablesError(err instanceof ApiError ? err.message : t('fail.loadTables'));
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
    if (!session || !currentLocationId) return;
    setTableSubmitting(true);
    setTablesError(null);
    try {
      await createTable(session.token, { locationId: currentLocationId, name, seats });
      await loadTables();
    } catch (err) {
      setTablesError(err instanceof ApiError ? err.message : t('fail.addTable'));
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

  // Kitchen status on this order changes server-side whenever kitchen staff
  // update it from KdsScreen — poll while this table is open so "Готовится"
  // flips to "Готово" without the cashier leaving and reselecting the table.
  useEffect(() => {
    if (view !== 'table-order' || !session || !selectedTable) return;
    const interval = setInterval(() => loadTableOrder(selectedTable.id), 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, session?.token, selectedTable?.id]);

  async function handleSendToKitchen(items: { productId: string; quantity: number; price: number }[]) {
    if (!session || !selectedTable) return;
    setTableSubmitting(true);
    setTablesError(null);
    try {
      const order = await sendToKitchen(session.token, selectedTable.id, { items });
      setTableOrder(order);
    } catch (err) {
      setTablesError(err instanceof ApiError ? err.message : t('fail.sendToKitchen'));
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
      setTablesError(err instanceof ApiError ? err.message : t('fail.pay'));
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
      setKdsError(err instanceof ApiError ? err.message : t('fail.loadKds'));
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
    // The register's own id, kept whatever happens next. Replacing it with the
    // server's on success used to mean a shift opened offline had one identity
    // and a shift opened online had another, and sales rung before the swap
    // pointed at an id that no longer existed.
    const s: Shift = {
      id: genId('shift'),
      openedAt: new Date().toISOString(),
      openingCash,
      closedAt: null,
      closingCashCounted: null,
      syncedToServer: false,
    };

    saveShift(s);
    setShift(s);
    setView('sale');

    // Attempted now and retried by the sync loop for as long as it takes. A
    // shift that never reaches the server takes its whole day's sales out of
    // the owner's cash reconciliation with it.
    void syncShift(s);
  }

  // Idempotent on the server by clientCommandId, so calling it again after a
  // failure finds the shift rather than opening a second one.
  async function syncShift(current: Shift): Promise<void> {
    if (!session || !currentLocationId || current.syncedToServer) return;
    try {
      await createRemoteShift(session.token, {
        locationId: currentLocationId,
        openingCash: current.openingCash,
        clientCommandId: current.id,
        openedAt: current.openedAt,
      });
      const synced = { ...current, syncedToServer: true };
      saveShift(synced);
      setShift(synced);
    } catch {
      // Offline or server unavailable. The shift works fully locally and the
      // next sync attempt will carry it.
    }
  }

  async function ensureShiftSynced(): Promise<void> {
    const current = getShift();
    if (current) await syncShift(current);
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

  function addToCart(product: Product, modifier?: ProductModifierOption, explicitQty?: number, addQty = false) {
    const lineId = modifier ? `${product.id}:${modifier.id}` : product.id;
    const displayName = modifier ? `${product.name} (${modifier.name})` : product.name;
    const price = product.price + (modifier?.priceDelta ?? 0);
    setCart((prev) => {
      // Weight-based lines are set (re-entering a weight corrects the amount),
      // not incremented like piece-based lines. A scanned case is the opposite:
      // scanning a second one means two cases, so it adds.
      if (explicitQty !== undefined) {
        if (explicitQty <= 0) return prev;
        const existing = prev.find((l) => l.id === lineId);
        const nextQty = addQty ? (existing?.qty ?? 0) + explicitQty : explicitQty;
        if (nextQty > product.stock) return prev;
        if (existing) {
          return prev.map((l) => (l.id === lineId ? { ...l, qty: nextQty } : l));
        }
        return [...prev, { id: lineId, productId: product.id, name: displayName, price, qty: nextQty, saleUnit: product.saleUnit }];
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
        // A variant is picked from a list, never scanned as a case of its own.
        packagings: [],
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

  /**
   * Количество вводом, а не одиннадцатью нажатиями на «плюс».
   *
   * Двенадцать пачек — обычная покупка в магазине у дома, и до этого кассир
   * набирал её одиннадцатью касаниями подряд, глядя не на покупателя, а на
   * экран. Плюс и минус остаются: для одной-двух штук они быстрее ввода.
   *
   * Ноль убирает строку — так же, как минус до нуля. Отдельная «пустая строка с
   * нулём» не значит ничего: товар либо в чеке, либо нет.
   */
  function setQty(lineId: string, qty: number) {
    const clean = Number.isFinite(qty) ? Math.max(0, Math.floor(qty)) : 0;
    setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, qty: clean } : l)).filter((l) => l.qty > 0));
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
    // A case barcode and a bottle barcode look the same to a scanner, so the
    // lookup answers both which product and how many of it. Scanning a case
    // adds the case, not one bottle out of it.
    const scanned = resolveScannedBarcode(query, session.products);
    if (!scanned) return;
    const match = session.products.find((p) => p.id === scanned.productId);
    if (!match) return;
    addToCart(match, undefined, scanned.unitsPerPack > 1 ? scanned.unitsPerPack : undefined, true);
    setQuery('');
  }

  // One named function rather than the formula inline, because the server has
  // the same arithmetic and `cart.test.ts` sweeps the two against each other.
  // Two copies of a money formula is how a till comes to disagree with its own
  // receipt, and once a split payment is involved a one-tenge disagreement is a
  // refused sale with a queue behind it.
  const {
    subtotal: cartSubtotal,
    discountAmount: cartDiscountAmount,
    netAfterDiscount: cartNetAfterDiscount,
    pointsRedeemed: cartPointsRedeemed,
    total: cartTotal,
  } = cartTotals(cart, discount, loyalty);
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

  function completeSale(payments: PaymentLine[]) {
    if (!shift || !session) return;
    // One method keeps its own name, so every receipt and report written
    // before splits existed still means what it meant. Several become 'mixed',
    // which is honest — naming the largest would file a card payment as cash.
    const method = payments.length === 1 ? payments[0].method : 'mixed';
    const sale: Sale = {
      id: genId('sale'),
      shiftId: shift.id,
      locationId: currentLocationId ?? '',
      items: cart,
      total: cartTotal,
      discount,
      discountAmount: cartDiscountAmount,
      customerPhone: loyalty?.phone,
      customerName: loyalty?.name,
      pointsRedeemed: cartPointsRedeemed || undefined,
      pointsEarned: loyalty ? Math.floor((cartTotal * 5) / 100) : undefined,
      paymentMethod: method,
      payments,
      createdAt: new Date().toISOString(),
      synced: false,
    };
    addSale(sale);
    refreshPendingCount();
    void sync();
    setLastSaleId(sale.id);
    setCart([]);
    setDiscount(null);
    setLoyalty(null);
    setView('receipt');
  }

  if (!session) {
    // Без предложения установить приложение — намеренно.
    //
    // Баннер пристыкован к низу экрана, а на телефоне 360×640 (обычный Android,
    // а не редкость) он накрывает клавишу «0» и кнопку «Войти». То есть первый
    // же человек, открывший кассу на таком телефоне, не может войти, пока не
    // догадается закрыть крестик, — и это происходит ровно в тот момент, когда
    // он видит продукт впервые.
    //
    // Двигать баннер выше значило бы чинить одну высоту экрана и ломать другую.
    // Предлагать установку до входа и так рано: человек ещё не знает, нужна ли
    // ему эта касса. Ниже, после входа, предложение остаётся.
    return <PinLogin onLogin={handleLogin} />;
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
        {/* До открытия смены — то есть в ту самую минуту утром, когда ещё можно
            успеть что-то сделать. */}
        <TariffNotice tariff={session.tariff} />
        <InstallPrompt {...install} />
        <OpenShiftScreen
          locations={session.locations}
          currentLocationId={currentLocationId}
          switchingLocation={locationSwitching}
          locationError={locationSwitchError}
          onSwitchLocation={handleSwitchLocation}
          onOpen={openShift}
        />
      </>
    );
  }

  return (
    <div className={isDesktop ? 'pos-shell desktop' : 'pos-shell'}>
      <ShiftBar
        shift={shift}
        cashierName={session.user.name}
        locationName={session.locations.length > 1 ? currentLocation?.name ?? null : null}
        online={online}
        pendingCount={pendingCount}
        stuckCount={stuckCount}
      />

      {/* Весь день висит только в последние сутки — см. urgentOnly. */}
      <TariffNotice tariff={session.tariff} urgentOnly />

      {/* Наверху и в потоке, а не поверх сетки товаров: на телефоне 360×640
          закреплённый снизу баннер накрывал два товара, и кассир бил пальцем в
          предложение установить приложение вместо продажи. */}
      <InstallPrompt {...install} />

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
            onSetQty={setQty}
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
          onSetQty={setQty}
          onEditWeight={handleEditWeightLine}
          onRemove={removeLine}
          onBack={() => setView('sale')}
          onCheckout={() => setView('payment')}
        />
      )}

      {view === 'payment' && (
        <PaymentModal total={cartTotal} hasCustomer={!!loyalty} onCancel={() => setView('cart')} onConfirm={completeSale} />
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
          busyOrder={busyOrder}
          onBack={() => setView('operations')}
          onRefresh={loadOrders}
          onFulfill={handleFulfillOrder}
          onReject={handleRejectOrder}
          onPick={handleShowPickOrder}
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
          currentLocationId={currentLocationId ?? ''}
          otherLocations={session.locations.filter((l) => l.id !== currentLocationId)}
          onReceive={handleReceiveTransfer}
          onCancel={handleCancelTransfer}
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
          token={session.token}
          canManage={isOwnerOrManager}
          receipts={receipts}
          products={session.products}
          loading={receiptsLoading}
          error={receiptsError}
          submitting={receiptSubmitting}
          openOrders={openPurchaseOrders}
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

      {view === 'settlements' && (
        <SettlementsScreen
          type={settlementType}
          accounts={settlementAccounts}
          loading={settlementsLoading}
          error={settlementsError}
          submitting={settlementsSubmitting}
          onBack={() => setView('operations')}
          onRefresh={() => loadSettlements(settlementType)}
          onChangeType={handleChangeSettlementType}
          onPay={handleRecordSettlement}
          onSetCredit={handleSetCredit}
        />
      )}

      {view === 'delivery' && (
        <DeliveryNoteScreen
          match={delivery}
          loading={deliveryLoading}
          error={deliveryError}
          submitting={deliverySubmitting}
          receivedId={deliveryReceiptId}
          onBack={() => setView('operations')}
          onMatch={handleMatchDelivery}
          onReceive={handleReceiveDelivery}
          onReset={resetDelivery}
        />
      )}

      {view === 'price-list' && (
        <PriceListScreen
          suppliers={suppliers}
          match={priceList}
          loading={priceListLoading}
          error={priceListError}
          submitting={priceListSubmitting}
          createdOrderId={priceListOrderId}
          onBack={() => setView('operations')}
          onMatch={handleMatchPriceList}
          onCreateOrder={handleCreateOrderFromPriceList}
          onReset={resetPriceList}
        />
      )}

      {view === 'cabinet' && (
        <CabinetLinkScreen
          info={cabinet}
          loading={cabinetLoading}
          error={cabinetError}
          resetting={cabinetResetting}
          onBack={() => setView('operations')}
          onReset={handleResetCabinet}
        />
      )}

      {view === 'migrate' && (
        <MigrationScreen
          systems={sourceSystems}
          loading={sourceSystemsLoading}
          error={importError}
          onBack={() => setView('operations')}
          onChoose={handleChooseSystem}
        />
      )}

      {view === 'import' && (
        <ImportScreen
          system={importSystem}
          onChangeSystem={handleShowMigrate}
          preview={importPreview}
          loading={importLoading}
          error={importError}
          submitting={importSubmitting}
          result={importResult}
          onBack={() => setView(importSystem ? 'migrate' : 'operations')}
          onPreview={handlePreviewImport}
          onCommit={handleCommitImport}
          onReset={resetImport}
        />
      )}

      {view === 'reconciliation' && (
        <ReconciliationScreen
          report={reconciliation}
          loading={reconciliationLoading}
          error={reconciliationError}
          repairing={reconciliationRepairing}
          onBack={() => setView('operations')}
          onRefresh={loadReconciliation}
          onRepair={handleRepairReconciliation}
        />
      )}

      {view === 'bin-count' && (
        <BinCountScreen
          bins={bins}
          sheet={countSheet}
          loading={countSheetLoading}
          error={binCountError}
          submitting={binCountSubmitting}
          lastResult={binCountResult}
          queuedBin={binCountQueued}
          sheetCachedAt={countSheetCachedAt}
          onBack={() => setView('operations')}
          onOpenBin={handleOpenCountBin}
          onSubmit={handleSubmitBinCount}
          onClearResult={() => {
            setBinCountResult(null);
            setBinCountQueued(null);
          }}
        />
      )}

      {view === 'bins' && (
        <BinsScreen
          bins={bins}
          unplaced={unplaced}
          loading={binsLoading}
          error={binsError}
          submitting={binsSubmitting}
          canManage={isOwnerOrManager}
          onBack={() => setView('operations')}
          onRefresh={loadBins}
          onCreateBin={handleCreateBin}
          onDeleteBin={handleDeleteBin}
          onPutaway={handlePutaway}
          onBlockBin={handleBlockBin}
          onUnblockBin={handleUnblockBin}
        />
      )}

      {view === 'write-offs' && (
        <WriteOffScreen
          records={writeOffs}
          products={session.products}
          loading={writeOffLoading}
          error={writeOffError}
          submitting={writeOffSubmitting}
          onBack={() => setView('operations')}
          onRefresh={loadWriteOffs}
          onWriteOff={handleCreateWriteOff}
          onQuarantine={handleQuarantine}
        />
      )}

      {view === 'purchase-orders' && (
        <PurchaseOrdersScreen
          orders={purchaseOrders}
          suppliers={suppliers}
          products={session.products}
          loading={purchaseLoading}
          error={purchaseError}
          submitting={purchaseSubmitting}
          busyOrderId={busyOrderId}
          canApprove={isOwnerOrManager}
          onBack={() => setView('operations')}
          onRefresh={loadPurchaseOrders}
          onCreate={handleCreatePurchaseOrder}
          onAct={handleActOnPurchaseOrder}
        />
      )}

      {view === 'fiscal' && (
        <FiscalScreen
          device={fiscalDevice}
          receipts={pendingFiscal}
          loading={fiscalLoading}
          error={fiscalError}
          busyDocumentId={fiscalBusyDocumentId}
          onBack={() => setView('operations')}
          onRefresh={loadFiscal}
          onRegister={handleRegisterFiscal}
        />
      )}

      {view === 'documents' && (
        <DocumentsScreen
          title={documentsTitle}
          subtitle={documentsSubtitle}
          documents={documents}
          loading={documentsLoading}
          error={documentsError}
          onBack={() => setView('dashboard')}
        />
      )}

      {view === 'pick-order' && pickingOrder && (
        <PickOrderScreen
          key={pickingOrder.id}
          order={pickingOrder}
          submitting={pickSubmitting}
          error={pickError}
          onBack={() => setView('orders')}
          onSavePick={handleSavePick}
          onShip={handleShipOrder}
        />
      )}

      {view === 'supplier-returns' && (
        <SupplierReturnsScreen
          returns={supplierReturns}
          receipts={receipts}
          loading={supplierReturnsLoading}
          error={supplierReturnsError}
          submitting={supplierReturnSubmitting}
          onBack={() => setView('operations')}
          onSubmit={handleCreateSupplierReturn}
        />
      )}

      {view === 'export' && (
        <ExportScreen onBack={() => setView('profile')} onExport={handleExport} />
      )}

      {view === 'audit' && (
        <AuditScreen
          entries={auditEntries}
          roundTrips={auditRoundTrips}
          days={auditDays}
          loading={auditLoading}
          error={auditError}
          onBack={() => setView('profile')}
          onChangeDays={handleChangeAuditDays}
        />
      )}

      {view === 'devices' && (
        <DevicesScreen
          devices={devices}
          total={deviceCount}
          truncated={devicesTruncated}
          loading={devicesLoading}
          error={devicesError}
          submitting={devicesSubmitting}
          onBack={() => setView('profile')}
          onRefresh={() => void loadDevices()}
          onRename={(id, label) => void handleRenameDevice(id, label)}
          onRevoke={(id) => void handleRevokeDevice(id)}
          onRestore={(id) => void handleRestoreDevice(id)}
        />
      )}

      {view === 'dashboard' && (
        <OwnerDashboardScreen
          dashboard={dashboard}
          days={dashboardDays}
          loading={dashboardLoading}
          error={dashboardError}
          onBack={() => setView('profile')}
          onChangeDays={handleChangeDashboardDays}
          onRefresh={() => loadDashboard(dashboardDays)}
          onShowReplenishment={handleShowReplenishment}
          onShowShiftDocuments={handleShowShiftDocuments}
          onShowUserDocuments={handleShowUserDocuments}
        />
      )}

      {view === 'replenishment' && (
        <ReplenishmentScreen
          items={replenishment}
          windowDays={replenishmentWindow}
          truncated={replenishmentTruncated}
          loading={replenishmentLoading}
          error={replenishmentError}
          savingProductId={policySavingProductId}
          onBack={() => setView('operations')}
          onRefresh={loadReplenishment}
          onSavePolicy={handleSaveStockPolicy}
          onOrderEverything={handleOrderEverythingRecommended}
          ordering={purchaseSubmitting}
        />
      )}

      {view === 'returns' && (
        <ReturnsScreen
          sales={returnableSales}
          returns={returns}
          loading={returnsLoading}
          error={returnsError}
          submitting={returnSubmitting}
          onBack={() => setView('operations')}
          onRefresh={loadReturns}
          onSubmit={handleCreateReturn}
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
          packagings={editingPackagings}
          packagingBusy={packagingBusy}
          packagingError={packagingError}
          submitting={productSaveSubmitting}
          error={productSaveError}
          onBack={() => setView('products')}
          onSave={handleSaveProduct}
          onAddPackaging={handleAddPackaging}
          onDeletePackaging={handleDeletePackaging}
        />
      )}

      {view === 'operations' && (
        <>
          <OutboxBanner
            pending={outbox.pending}
            blockedCommand={outbox.blockedCommand}
            onRetry={outbox.retry}
            onDiscard={outbox.discard}
          />
          <OperationsScreen items={operationsItems} />
        </>
      )}

      {view === 'profile' && (
        <ProfileScreen
          cashierName={session.user.name}
          role={session.user.role}
          shift={shift}
          online={online}
          offlineReadiness={offlineReadiness}
          pendingCount={pendingCount}
          stuckCount={stuckCount}
          storefrontUrl={storefrontUrl}
          pushSupported={hasSupply && pushSupported()}
          pushEnabled={pushEnabled}
          pushBusy={pushBusy}
          onTogglePush={handleTogglePush}
          onShowDashboard={isOwnerOrManager ? handleShowDashboard : undefined}
          onShowAudit={isOwnerOrManager ? handleShowAudit : undefined}
          onShowDevices={isOwnerOrManager ? handleShowDevices : undefined}
          onShowExport={isOwnerOrManager ? () => setView('export') : undefined}
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

    </div>
  );
}
