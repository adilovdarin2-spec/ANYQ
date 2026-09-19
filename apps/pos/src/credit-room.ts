/**
 * Сколько этому клиенту ещё можно отпустить в долг — до того, как собрали корзину.
 *
 * У опта половина оборота идёт под запись, и отказ «долг превысит лимит»
 * приходит в конце: товар набран на четыреста тысяч, кладовщик уже отложил
 * ящики, а платить нечем и разбирать обратно. Сервер это число знает и отдаёт
 * кассе в ту же секунду, когда назвали покупателя, — и касса его выбрасывала.
 *
 * Правило здесь повторяет серверное слово в слово, и это проверяется охраной
 * рядом. Расхождение стоило бы дороже отсутствия: экран говорит «можно ещё
 * восемьдесят», кассир обещает клиенту, а продажа отказана.
 */

export interface CreditAccount {
  /** Разрешён ли этому клиенту долг вообще. Разрешает владелец, не кассир. */
  creditAllowed: boolean;
  /** Ноль — «потолок не задан», а не «долга нет». */
  creditLimit: number;
  /** Сколько уже должен на эту секунду. */
  owed: number;
}

export type CreditRoom =
  /** Долг этому клиенту не разрешён — платить надо сейчас. Старый долг при
      этом никуда не девается, и назвать его всё равно надо. */
  | { state: 'notAllowed'; owed: number }
  /** Разрешён, потолка нет. Показывать всё равно есть что: сам долг. */
  | { state: 'unlimited'; owed: number }
  /** Разрешён, и корзина в него укладывается. */
  | { state: 'room'; owed: number; left: number }
  /** Корзина уже не укладывается. Узнать об этом надо здесь, а не на оплате. */
  | { state: 'over'; owed: number; limit: number; excess: number };

/**
 * @param cartTotal сумма к оплате, уже за вычетом скидки и списанных баллов —
 * ровно то число, которое сервер сравнивает с лимитом.
 */
export function creditRoom(account: CreditAccount, cartTotal: number): CreditRoom {
  const owed = Math.max(account.owed, 0);
  if (!account.creditAllowed) return { state: 'notAllowed', owed };
  if (account.creditLimit <= 0) return { state: 'unlimited', owed };

  const after = owed + Math.max(cartTotal, 0);
  if (after > account.creditLimit) {
    return { state: 'over', owed, limit: account.creditLimit, excess: after - account.creditLimit };
  }
  return { state: 'room', owed, left: account.creditLimit - after };
}
