import type { MainTab } from './components/TabBar';

/** Экран, на котором касса сейчас стоит. */
export type View =
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

/** Экраны склада и закупок — всё, что открывается из «Операций». */
const OPERATIONS_VIEWS = new Set<View>([
  'orders', 'batches', 'transfers', 'incoming', 'counts', 'returns', 'replenishment', 'fiscal', 'purchase-orders', 'write-offs', 'bins', 'bin-count', 'reconciliation', 'import', 'migrate', 'cabinet', 'price-list', 'delivery', 'settlements', 'production', 'floorplan', 'table-order', 'kds', 'stock-history',
]);

const PROFILE_VIEWS = new Set<View>([
  'profile', 'reports', 'dashboard', 'audit', 'export', 'documents', 'devices',
]);

const PRODUCT_VIEWS = new Set<View>(['products', 'product-edit']);

/**
 * Какой раздел подсвечен внизу экрана.
 *
 * Подсветка отвечает на единственный вопрос — «где я сейчас», — и отвечать
 * неправильно ей хуже, чем не отвечать вовсе. Список подразделов «Операций»
 * когда-то перечислили, а сам экран «Операции» в него не попал: кассир
 * открывал склад и видел внизу зелёную «Кассу». Поэтому здесь разбор по
 * разделам, а не по списку подразделов: незнакомый экран попадает в «Кассу»
 * осознанно, а не потому, что его забыли вписать.
 */
export function mainTabFor(view: View): MainTab {
  if (PRODUCT_VIEWS.has(view)) return 'products';
  if (view === 'operations' || OPERATIONS_VIEWS.has(view)) return 'operations';
  if (PROFILE_VIEWS.has(view)) return 'profile';
  return 'sale';
}
