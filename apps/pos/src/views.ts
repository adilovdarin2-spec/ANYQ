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
  | 'staff'
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
  'orders', 'batches', 'transfers', 'incoming', 'counts', 'returns', 'replenishment', 'fiscal', 'purchase-orders', 'write-offs', 'bins', 'bin-count', 'reconciliation', 'import', 'migrate', 'cabinet', 'staff', 'price-list', 'delivery', 'settlements', 'production', 'kds', 'stock-history',
]);

/**
 * Зал — свой раздел, а не подраздел «Операций».
 *
 * Он там и лежал, между пересчётом ящиков и выгрузкой в 1С, — то есть работа
 * официанта была спрятана в ящик с редким. Открыв стол, он к тому же терял
 * нижнюю панель: заказ открылся как случайный экран, а не как место, где
 * официант проводит смену.
 */
const FLOOR_VIEWS = new Set<View>(['floorplan', 'table-order']);

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
  if (FLOOR_VIEWS.has(view)) return 'floor';
  if (PRODUCT_VIEWS.has(view)) return 'products';
  if (view === 'operations' || OPERATIONS_VIEWS.has(view)) return 'operations';
  if (PROFILE_VIEWS.has(view)) return 'profile';
  return 'sale';
}

/**
 * С какого экрана начинается смена.
 *
 * Все шесть видов бизнеса открывались одинаково — сеткой товаров. Для кафе это
 * неверно не по вкусу, а по делу: у официанта заказ живёт за столом, чек
 * появляется в конце, и первым экраном ему нужен зал. Касса остаётся рядом —
 * навынос пробивают ею.
 */
export function homeViewFor(modules: string[]): View {
  return modules.includes('restaurant') ? 'floorplan' : 'sale';
}
