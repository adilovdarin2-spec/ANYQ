import { useCallback, useEffect, useRef, useState } from 'react';
import { getSales, saveSales } from '../storage';
import { useOnlineStatus } from './useOnlineStatus';
import { submitSale, ApiError } from '../api';

/**
 * Как часто пробовать снова, когда в очереди что-то осталось.
 *
 * Двадцать секунд: достаточно редко, чтобы не шуметь запросами с полусотни
 * касс, и достаточно часто, чтобы продажа не пролежала весь вечер.
 */
const RETRY_MS = 20_000;

export function useSalesSync(token: string | null, ensureShiftSynced: () => Promise<void>) {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(() => getSales().filter((s) => !s.synced && !s.syncError).length);
  const [stuckCount, setStuckCount] = useState(() => getSales().filter((s) => s.syncError).length);
  const syncingRef = useRef(false);

  const refreshPendingCount = useCallback(() => {
    const sales = getSales();
    setPendingCount(sales.filter((s) => !s.synced && !s.syncError).length);
    setStuckCount(sales.filter((s) => s.syncError).length);
  }, []);

  const sync = useCallback(async () => {
    if (!token || syncingRef.current) return;
    syncingRef.current = true;
    try {
      // The shift first, always. A sale names its shift by the id the register
      // generated, and the server can only resolve that once the shift itself
      // has arrived — send them the other way round and a whole offline
      // morning's takings land in nobody's reconciliation.
      await ensureShiftSynced();

      const pending = getSales().filter((s) => !s.synced);
      for (const sale of pending) {
        if (getSales().find((s) => s.id === sale.id)?.synced) continue;
        try {
          await submitSale(
            token,
            {
              locationId: sale.locationId,
              shiftClientId: sale.shiftId,
              // Both, on purpose. `payments` is what the sale actually was;
              // `paymentMethod` keeps a server that has not been deployed yet
              // able to take it, which matters because the queue may be
              // draining a morning of sales into either.
              paymentMethod: sale.paymentMethod,
              ...(sale.payments ? { payments: sale.payments } : {}),
              items: sale.items.map((i) => ({ productId: i.productId, quantity: i.qty, price: i.price })),
              ...(sale.discount ? { discountType: sale.discount.type, discountValue: sale.discount.value } : {}),
              ...(sale.customerPhone ? { customerPhone: sale.customerPhone, customerName: sale.customerName, pointsToRedeem: sale.pointsRedeemed } : {}),
            },
            // The local sale id, stable across every retry of this same sale —
            // what lets the server tell a genuine second sale from a repeat of
            // one whose reply never came back.
            sale.id,
          );
          const updated = getSales().map((s) => (s.id === sale.id ? { ...s, synced: true, syncError: undefined } : s));
          saveSales(updated);
        } catch (err) {
          if (err instanceof ApiError && err.status < 500) {
            // The server was reached and explicitly rejected this specific
            // sale (stale price, insufficient stock, etc). Record why and
            // move on — one bad sale must not block every sale queued behind
            // it from ever syncing.
            const updated = getSales().map((s) => (s.id === sale.id ? { ...s, syncError: err.message } : s));
            saveSales(updated);
            continue;
          }
          // Either the server couldn't be reached, or it failed in a way that
          // says nothing about this sale (5xx). Keep the whole queue for the
          // next attempt: marking a sale stuck here would strand a perfectly
          // good one over a momentary server fault, and it is never retried
          // again once it carries a syncError.
          break;
        }
      }
    } finally {
      syncingRef.current = false;
      refreshPendingCount();
    }
  }, [token, ensureShiftSynced, refreshPendingCount]);

  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  /**
   * И ещё раз, сама по себе, пока в очереди что-то есть.
   *
   * До этого очередь разбиралась только когда браузер сообщал, что сеть
   * появилась, — и это покрывает ровно один случай: пропал и вернулся
   * интернет. А самый частый случай другой: интернет есть, а сервер минуту не
   * отвечал — выкатили обновление, перезапустился, моргнул. Браузер об этом
   * событий не шлёт, и продажа лежала в очереди до следующей продажи. Тихим
   * вечером это часы: у владельца в сводке нет выручки, а на чеке написано
   * «не синхронизирован» под продажей, которая прошла.
   *
   * Таймер живёт только пока есть что досылать, поэтому касса, у которой всё
   * отправлено, ничего не делает.
   */
  useEffect(() => {
    if (!online || !token || pendingCount === 0) return;
    const timer = window.setInterval(() => void sync(), RETRY_MS);
    return () => window.clearInterval(timer);
  }, [online, token, pendingCount, sync]);

  return { online, pendingCount, stuckCount, refreshPendingCount, sync };
}
