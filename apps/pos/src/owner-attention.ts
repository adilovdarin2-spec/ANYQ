import type { OwnerDashboard } from './types';

/**
 * Есть ли на сводке владельца хоть что-то, требующее его решения.
 *
 * Вынесено из разметки не ради красоты. Там это было списком из пяти условий,
 * сросшимся с версткой, и шестое — расхождение по кассе — в него просто не
 * дописали. В итоге экран владельца заканчивался словами «Ничего, что требует
 * вашего решения» прямо под строкой «−20 ₸»: недостача в ящике, то есть ровно
 * то, ради чего владелец сюда и заходит.
 *
 * Список смен при этом считался и показывался верно. Неверен был вывод под ним
 * — и такую ошибку не видно, пока не посмотришь на экран с настоящей недостачей.
 *
 * Теперь это функция, у неё есть тест на каждое основание, и следующее забыть
 * будет дороже: тест на «пусто» перечисляет всё, что должно быть пусто.
 */
export function needsOwnerAttention(dashboard: OwnerDashboard): boolean {
  if (dashboard.flags.length > 0) return true;
  if (dashboard.deadStock.length > 0) return true;
  if (dashboard.expiring.length > 0) return true;
  if (dashboard.discrepancies.counts.length > 0) return true;
  if (dashboard.discrepancies.transfers.length > 0) return true;
  // Только закрытые смены: у открытой разница ещё ничего не значит — деньги в
  // ящике, смена не пересчитана, и «расхождение» до пересчёта это просто
  // выручка, которую ещё не сверяли.
  if (dashboard.money.shifts.some((shift) => shift.closedAt && shift.difference)) return true;
  return false;
}
