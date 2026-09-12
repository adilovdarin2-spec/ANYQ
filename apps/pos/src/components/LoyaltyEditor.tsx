import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { LoyaltySelection } from '../types';
import { ApiError } from '../api';
import type { CustomerLookupResult } from '../api';
import { formatMoney } from '../utils';

interface Props {
  netAfterDiscount: number;
  selection: LoyaltySelection | null;
  onChange: (selection: LoyaltySelection | null) => void;
  onLookup: (phone: string) => Promise<CustomerLookupResult>;
}

export function LoyaltyEditor({ netAfterDiscount, selection, onChange, onLookup }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(selection?.phone ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ name: string; loyaltyPoints: number; isNew?: boolean } | null>(
    selection ? { name: selection.name, loyaltyPoints: selection.pointsAvailable } : null,
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
      setFound({ name: result.name ?? trimmed, loyaltyPoints: result.loyaltyPoints, isNew: !result.found });
    } catch (err) {
      // Сервер отвечает по делу: «недоступно на вашем тарифе», «нет сети».
      // Общее «не удалось найти клиента» на все случаи отправляло кассира
      // искать несуществующего человека вместо того, чтобы позвать владельца.
      setError(err instanceof ApiError ? err.message : t('loyalty.notFound'));
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (!found) return;
    const points = Number(redeemInput);
    const pointsToRedeem = Number.isFinite(points) && points > 0 ? Math.min(points, found.loyaltyPoints, netAfterDiscount) : 0;
    onChange({ phone: phone.trim(), name: found.name, pointsAvailable: found.loyaltyPoints, pointsToRedeem });
    setEditing(false);
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
        {!found ? (
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
  );
}
