import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { LoyaltySelection } from '../types';
import { ApiError } from '../api';
import type { CustomerLookupResult } from '../api';
import { formatMoney } from '../utils';
import { creditRoom } from '../credit-room';

/**
 * Кому продаём — вопрос не розничный.
 *
 * Эта строка жила под модулем `retail` вместе с баллами, потому что появилась
 * ради них. У склада модуля `retail` нет, значит не было и строки, значит
 * назвать покупателя было негде, — а продажа в долг требует известного
 * клиента. То есть опт, у которого половина оборота под запись, не мог
 * отпустить в долг вообще: сервер это умел, кассе нечем было сказать кому.
 *
 * Поэтому дверь общая, а за ней — только своё: баллы показываются с розницей,
 * долг и потолок — всегда. Ровно так же устроен ответ сервера.
 */

interface Props {
  netAfterDiscount: number;
  selection: LoyaltySelection | null;
  onChange: (selection: LoyaltySelection | null) => void;
  onLookup: (phone: string) => Promise<CustomerLookupResult>;
  /** Баллы — розничная затея. У склада их нет, и поля для них тоже. */
  showPoints: boolean;
}

interface Found {
  name: string;
  loyaltyPoints: number;
  creditAllowed: boolean;
  creditLimit: number;
  owed: number;
  isNew?: boolean;
}

export function CustomerRow({ netAfterDiscount, selection, onChange, onLookup, showPoints }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(selection?.phone ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(
    selection
      ? {
          name: selection.name,
          loyaltyPoints: selection.pointsAvailable,
          creditAllowed: selection.creditAllowed,
          creditLimit: selection.creditLimit,
          owed: selection.owed,
        }
      : null,
  );
  const [redeemInput, setRedeemInput] = useState(selection && selection.pointsToRedeem > 0 ? String(selection.pointsToRedeem) : '');

  async function handleLookup() {
    const trimmed = phone.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const result = await onLookup(trimmed);
      // Незнакомый номер — это не отказ: человек просто покупает впервые, и
      // карточка заведётся этой же продажей. Раньше он выглядел так же, как
      // найденный, только с нулём баллов, и кассир не знал, что произойдёт.
      setFound({
        name: result.name ?? trimmed,
        loyaltyPoints: result.loyaltyPoints,
        creditAllowed: result.creditAllowed,
        creditLimit: result.creditLimit,
        owed: result.owed,
        isNew: !result.found,
      });
      // Складу выбирать нечего: баллов нет, а долг считается сам. Лишний шаг
      // «ОК» на каждой отгрузке — это работа, которая ничего не решает.
      if (!showPoints) {
        applyFound(
          {
            name: result.name ?? trimmed,
            loyaltyPoints: result.loyaltyPoints,
            creditAllowed: result.creditAllowed,
            creditLimit: result.creditLimit,
            owed: result.owed,
          },
          trimmed,
          0,
        );
      }
    } catch (err) {
      // Сервер отвечает по делу: «недоступно на вашем тарифе», «нет сети».
      // Общее «не удалось найти клиента» на все случаи отправляло кассира
      // искать несуществующего человека вместо того, чтобы позвать владельца.
      setError(err instanceof ApiError ? err.message : t('loyalty.notFound'));
    } finally {
      setLoading(false);
    }
  }

  function applyFound(who: Omit<Found, 'isNew'>, atPhone: string, pointsToRedeem: number) {
    onChange({
      phone: atPhone,
      name: who.name,
      pointsAvailable: who.loyaltyPoints,
      pointsToRedeem,
      creditAllowed: who.creditAllowed,
      creditLimit: who.creditLimit,
      owed: who.owed,
    });
    setEditing(false);
  }

  function apply() {
    if (!found) return;
    const points = Number(redeemInput);
    const pointsToRedeem = Number.isFinite(points) && points > 0 ? Math.min(points, found.loyaltyPoints, netAfterDiscount) : 0;
    applyFound(found, phone.trim(), pointsToRedeem);
  }

  function clear() {
    onChange(null);
    setPhone('');
    setFound(null);
    setRedeemInput('');
    setError(null);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="loyalty-editor">
        {!found || !showPoints ? (
          <div className="loyalty-lookup-row">
            <input type="tel" autoFocus placeholder={t('loyalty.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button type="button" className="btn btn-secondary" onClick={handleLookup} disabled={loading || !phone.trim()}>
              {loading ? '…' : t('loyalty.find')}
            </button>
          </div>
        ) : (
          <>
            <div className="loyalty-found">
              {found.isNew ? t('loyalty.newCustomer') : t('loyalty.found', { name: found.name, points: found.loyaltyPoints })}
            </div>
            <div className="loyalty-lookup-row">
              <input
                type="number"
                min="0"
                max={Math.min(found.loyaltyPoints, netAfterDiscount)}
                placeholder={t('loyalty.redeem')}
                value={redeemInput}
                onChange={(e) => setRedeemInput(e.target.value)}
              />
              <button type="button" className="btn btn-secondary" onClick={apply}>OK</button>
            </div>
          </>
        )}
        {error && <div className="login-error">{error}</div>}
      </div>
    );
  }

  return (
    <>
      <div className="summary-row loyalty-row">
        <span>{t('receipt.customer')}</span>
        {selection ? (
          <span>
            {selection.name}
            {selection.pointsToRedeem > 0 ? ` (−${formatMoney(selection.pointsToRedeem)})` : ''}
            <button type="button" className="li-remove" onClick={clear}>{t('loyalty.remove')}</button>
          </span>
        ) : (
          <button type="button" className="li-remove" onClick={() => setEditing(true)}>{t('loyalty.attach')}</button>
        )}
      </div>
      {selection && <CreditLine selection={selection} netAfterDiscount={netAfterDiscount} />}
    </>
  );
}

/**
 * Долг и потолок — пока корзину ещё можно разобрать.
 *
 * Отказ на оплате приходит, когда товар уже собран и отложен: у опта это
 * четыреста тысяч в ящиках и полчаса работы обратно. Здесь то же число видно
 * с первой позиции и меняется вместе с корзиной.
 */
function CreditLine({ selection, netAfterDiscount }: { selection: LoyaltySelection; netAfterDiscount: number }) {
  const { t } = useTranslation();
  const room = creditRoom(selection, Math.max(netAfterDiscount - selection.pointsToRedeem, 0));

  // Розничному покупателю без долга говорить нечего: строка «долг 0 ₸» у
  // каждого чека — это шум, за которым перестают замечать настоящий долг.
  if (room.state === 'notAllowed' && room.owed === 0) return null;

  if (room.state === 'over') {
    return (
      <div className="summary-row credit-line credit-over">
        <span>{t('credit.owed', { amount: formatMoney(room.owed) })}</span>
        <span>{t('credit.over', { amount: formatMoney(room.excess), limit: formatMoney(room.limit) })}</span>
      </div>
    );
  }

  return (
    <div className="summary-row credit-line">
      <span>{t('credit.owed', { amount: formatMoney(room.owed) })}</span>
      <span>
        {room.state === 'room'
          ? t('credit.left', { amount: formatMoney(room.left) })
          : room.state === 'unlimited'
            ? t('credit.noLimit')
            : t('credit.cashOnly')}
      </span>
    </div>
  );
}
