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
          await submitSale(token, {
            locationId: sale.locationId,
            paymentMethod: sale.paymentMethod,
            items: sale.items.map((i) => ({ productId: i.productId, quantity: i.qty, price: i.price })),
            ...(sale.discount ? { discountType: sale.discount.type, discountValue: sale.discount.value } : {}),
            ...(sale.customerPhone ? { customerPhone: sale.customerPhone, customerName: sale.customerName, pointsToRedeem: sale.pointsRedeemed } : {}),
          });
          const updated = getSales().map((s) => (s.id === sale.id ? { ...s, synced: true, syncError: undefined } : s));
          saveSales(updated);
        } catch (err) {
          if (err instanceof ApiError) {
            // The server was reached and explicitly rejected this specific
            // sale (stale price, insufficient stock, etc). Record why and
            // move on — one bad sale must not block every sale queued behind
            // it from ever syncing.
            const updated = getSales().map((s) => (s.id === sale.id ? { ...s, syncError: err.message } : s));
            saveSales(updated);
            continue;
          }
          // Couldn't reach the server at all — no point trying the rest now.
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
