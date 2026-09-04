import { useCallback, useEffect, useRef, useState } from 'react';
import { getSales, saveSales } from '../storage';
import { useOnlineStatus } from './useOnlineStatus';
import { submitSale, ApiError } from '../api';

export function useSalesSync(token: string | null) {
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
      const pending = getSales().filter((s) => !s.synced);
      for (const sale of pending) {
        if (getSales().find((s) => s.id === sale.id)?.synced) continue;
        try {
          await submitSale(
            token,
            {
              locationId: sale.locationId,
              paymentMethod: sale.paymentMethod,
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
  }, [token, refreshPendingCount]);

  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  return { online, pendingCount, stuckCount, refreshPendingCount, sync };
}
