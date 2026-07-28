import { useState } from 'react';
import type { LoyaltySelection } from '../types';
import type { CustomerLookupResult } from '../api';
import { formatMoney } from '../utils';

interface Props {
  netAfterDiscount: number;
  selection: LoyaltySelection | null;
  onChange: (selection: LoyaltySelection | null) => void;
  onLookup: (phone: string) => Promise<CustomerLookupResult>;
}

export function LoyaltyEditor({ netAfterDiscount, selection, onChange, onLookup }: Props) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(selection?.phone ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ name: string; loyaltyPoints: number } | null>(
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
      setFound({ name: result.name ?? trimmed, loyaltyPoints: result.loyaltyPoints });
    } catch {
      setError('Не удалось найти клиента');
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
            <input type="tel" autoFocus placeholder="Телефон клиента" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button type="button" className="btn btn-secondary" onClick={handleLookup} disabled={loading || !phone.trim()}>
              {loading ? '…' : 'Найти'}
            </button>
          </div>
        ) : (
          <>
            <div className="loyalty-found">{found.name} · баллы: {found.loyaltyPoints}</div>
            <div className="loyalty-lookup-row">
              <input
                type="number"
                min="0"
                max={Math.min(found.loyaltyPoints, netAfterDiscount)}
                placeholder="Списать баллов"
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
      <span>Клиент</span>
      {selection ? (
        <span>
          {selection.name}
          {selection.pointsToRedeem > 0 ? ` (−${formatMoney(selection.pointsToRedeem)})` : ''}
          <button type="button" className="li-remove" onClick={clear}>убрать</button>
        </span>
      ) : (
        <button type="button" className="li-remove" onClick={() => setEditing(true)}>добавить</button>
      )}
    </div>
  );
}
