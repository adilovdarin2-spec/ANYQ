import { useCallback, useEffect, useRef, useState } from 'react';
import { getSales, saveSales } from '../storage';
import { useOnlineStatus } from './useOnlineStatus';
import { submitSale } from '../api';

export function useSalesSync(token: string | null) {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(() => getSales().filter((s) => !s.synced).length);
  const syncingRef = useRef(false);

  const refreshPendingCount = useCallback(() => {
    setPendingCount(getSales().filter((s) => !s.synced).length);
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
          const updated = getSales().map((s) => (s.id === sale.id ? { ...s, synced: true } : s));
          saveSales(updated);
        } catch {
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

  return { online, pendingCount, refreshPendingCount, sync };
}
