import { useCallback, useEffect, useRef, useState } from 'react';
import { getSales, saveSales } from '../storage';
import type { Sale } from '../types';
import { clearRefusal, splitQueue } from '../sales-queue';
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
  const [pendingCount, setPendingCount] = useState(() => splitQueue(getSales()).pending.length);
  /**
   * Продажи, которые сервер отказался принять, — целиком, а не числом.
   *
   * Числа хватало, чтобы написать «1 требует внимания», и не хватало ни на
   * что дальше: ни кассир, ни владелец не могли узнать, какая это продажа и
   * почему её не приняли. Причину сервер присылает, касса её сохраняет —
   * и до сих пор не показывала никому.
   */
  const [stuckSales, setStuckSales] = useState<Sale[]>(() => splitQueue(getSales()).stuck);
  const syncingRef = useRef(false);

  const refreshPendingCount = useCallback(() => {
    const queue = splitQueue(getSales());
    setPendingCount(queue.pending.length);
    setStuckSales(queue.stuck);
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

      // Только то, что ждёт связи. Отказанную продажу сервер посмотрел и не
      // принял: причина у неё снаружи кассы — не хватило остатка, изменились
      // цены, — и сама собой она не исчезнет. Слать её на каждом проходе
      // значит на каждой продаже долбиться в тот же отказ, а с десятком таких
      // чеков в памяти — десятком лишних запросов. Её отправят по кнопке,
      // когда причину починят; экран профиля показывает и продажу, и причину.
      const { pending } = splitQueue(getSales());
      for (const sale of pending) {
        if (getSales().find((s) => s.id === sale.id)?.synced) continue;
        try {
          await submitSale(
            token,
            {
              locationId: sale.locationId,
              shiftClientId: sale.shiftId,
              // Когда чек был пробит, а не когда очередь до сервера дошла.
              //
              // Касса обязана торговать неделю без сети — и без этого поля вся
              // эта неделя ложилась одним днём: сервер ставил своё «сейчас» в
              // момент синхронизации. Выручка по дням считается по дате
              // документа, поэтому дни отсутствия связи оказывались пустыми, а
              // день возвращения — с недельной выручкой.
              //
              // Сервер этому времени не верит на слово: он принимает его,
              // только если оно не в будущем и не раньше открытия смены.
              soldAt: sale.createdAt,
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
          // next attempt: marking a sale stuck here would put a perfectly good
          // sale in front of the cashier as a refusal over a momentary server
          // fault.
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

  /**
   * Отправить отказанную продажу ещё раз — по нажатию, а не по таймеру.
   *
   * Причина отказа чаще всего снаружи кассы: не хватило остатка, пока чек
   * пробивали, не было такого товара, закрыли смену на сервере. Это чинят
   * руками — и после починки человеку нужна кнопка «теперь», а не ожидание
   * следующей продажи: таймер досылки заводится только пока есть обычная
   * очередь, а на одних отказанных продажах касса ничего не делает.
   *
   * Ключ идемпотентности у продажи тот же, что и в первый раз, поэтому
   * повтор ничем не грозит: сервер либо примет её, либо откажет так же.
   */
  const retryStuck = useCallback(
    (id: string) => {
      saveSales(clearRefusal(getSales(), id));
      refreshPendingCount();
      void sync();
    },
    [refreshPendingCount, sync],
  );

  return { online, pendingCount, stuckSales, stuckCount: stuckSales.length, retryStuck, refreshPendingCount, sync };
}
