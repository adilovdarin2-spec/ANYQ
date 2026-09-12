import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { SettlementAccount } from '../types';
import { formatMoney, formatPhone } from '../utils';

interface Props {
  type: 'customer' | 'supplier';
  accounts: SettlementAccount[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onChangeType: (type: 'customer' | 'supplier') => void;
  onPay: (counterpartyId: string, amount: number) => Promise<boolean>;
  onSetCredit: (counterpartyId: string, creditAllowed: boolean, creditLimit: number) => Promise<boolean>;
}

export function SettlementsScreen({
  type,
  accounts,
  loading,
  error,
  submitting,
  onBack,
  onRefresh,
  onChangeType,
  onPay,
  onSetCredit,
}: Props) {
  const { t } = useTranslation();
  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [creditId, setCreditId] = useState<string | null>(null);
  const [creditLimit, setCreditLimit] = useState('');
  const [creditAllowed, setCreditAllowed] = useState(false);

  const total = accounts.reduce((sum, account) => sum + Math.max(account.balance, 0), 0);
  const overdue = accounts.reduce((sum, account) => sum + account.aging.days31to60 + account.aging.over60, 0);

  async function pay(account: SettlementAccount) {
    const value = Number(amount);
    if (!(value > 0)) return;
    const done = await onPay(account.counterpartyId, value);
    if (done) {
      setPayingId(null);
      setAmount('');
    }
  }

  async function saveCredit(account: SettlementAccount) {
    const done = await onSetCredit(account.counterpartyId, creditAllowed, Number(creditLimit) || 0);
    if (done) setCreditId(null);
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('settle.title')}</span>
        <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
      </div>

      <div className="screen-body">
        <div className="category-bar">
          <button
            type="button"
            className={type === 'customer' ? 'category-chip on' : 'category-chip'}
            onClick={() => onChangeType('customer')}
          >
            {t('settle.owedToUs')}
          </button>
          <button
            type="button"
            className={type === 'supplier' ? 'category-chip on' : 'category-chip'}
            onClick={() => onChangeType('supplier')}
          >
            {t('settle.weOwe')}
          </button>
        </div>

        {error && <div className="login-error">{error}</div>}
        {loading && accounts.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
        {!loading && accounts.length === 0 && !error && (
          <div className="empty-state">
            {type === 'customer' ? t('settle.allSettledCustomers') : t('settle.allSettledSuppliers')}
          </div>
        )}

        {accounts.length > 0 && (
          <div className="report-cards">
            <div className="report-card">
              <span className="value">{formatMoney(total)}</span>
              <span className="label">{type === 'customer' ? t('owner.owedToUs') : t('owner.weOwe')}</span>
            </div>
            {/* Age, not just amount: the same sum owed since yesterday and
                owed since spring are different situations. */}
            {overdue > 0 && (
              <div className="report-card">
                <span className="value">{formatMoney(overdue)}</span>
                <span className="label">{t('settle.olderThanMonth')}</span>
              </div>
            )}
          </div>
        )}

        {accounts.map((account) => {
          const paying = payingId === account.counterpartyId;
          const editingCredit = creditId === account.counterpartyId;

          return (
            <div key={account.counterpartyId} className="order-card">
              <div className="order-card-head">
                <div>
                  <div className="order-customer">{account.name}</div>
                  <div className="order-meta">
                    {account.phone ? `${formatPhone(account.phone)} · ` : ''}
                    {t('settle.openDocuments', { count: account.openCount })}
                  </div>
                </div>
                <span className={account.aging.over60 > 0 ? 'pill warn' : 'pill'}>{formatMoney(account.balance)}</span>
              </div>

              <div className="order-items">
                {account.aging.current > 0 && (
                  <div className="order-item-row">
                    <span>{t('settle.upToWeek')}</span>
                    <span>{formatMoney(account.aging.current)}</span>
                  </div>
                )}
                {account.aging.days8to30 > 0 && (
                  <div className="order-item-row">
                    <span>{t('settle.days8to30')}</span>
                    <span>{formatMoney(account.aging.days8to30)}</span>
                  </div>
                )}
                {account.aging.days31to60 > 0 && (
                  <div className="order-item-row">
                    <span>{t('settle.days31to60')}</span>
                    <span>{formatMoney(account.aging.days31to60)}</span>
                  </div>
                )}
                {account.aging.over60 > 0 && (
                  <div className="order-item-row">
                    <span>{t('settle.over60')}</span>
                    <span>{formatMoney(account.aging.over60)}</span>
                  </div>
                )}
              </div>

              {!paying && (
                <button className="btn btn-primary btn-block" onClick={() => { setPayingId(account.counterpartyId); setAmount(String(Math.max(account.balance, 0))); }}>
                  {type === 'customer' ? t('settle.takePayment') : t('settle.payySupplier')}
                </button>
              )}

              {paying && (
                <>
                  {/* Oldest first, always — so the aging figures above keep
                      meaning something. */}
                  <p className="field-hint">{t('settle.oldestFirst')}</p>
                  <div className="transfer-add-row">
                    <input
                      type="number"
                      min="0"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      aria-label={t('settle.amount')}
                    />
                    <button type="button" className="btn btn-secondary" disabled={submitting} onClick={() => pay(account)}>
                      {submitting ? t('settle.posting') : t('settle.post')}
                    </button>
                  </div>
                  <button className="btn btn-ghost btn-block" onClick={() => setPayingId(null)}>{t('common.cancel')}</button>
                </>
              )}

              {type === 'customer' && !editingCredit && (
                <button
                  className="btn btn-ghost btn-block"
                  onClick={() => {
                    setCreditId(account.counterpartyId);
                    setCreditAllowed(account.creditAllowed);
                    setCreditLimit(String(account.creditLimit));
                  }}
                >
                  {account.creditAllowed
                        ? account.creditLimit > 0
                          ? t('settle.creditUpTo', { amount: formatMoney(account.creditLimit) })
                          : t('settle.creditAllowed')
                        : t('settle.creditDenied')}
                </button>
              )}

              {type === 'customer' && editingCredit && (
                <>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={creditAllowed} onChange={(e) => setCreditAllowed(e.target.checked)} />
                    {t('settle.allowCredit')}
                  </label>
                    <p className="field-hint">{t('settle.limitWhy')}</p>
                  <div className="transfer-add-row">
                    <input
                      type="number"
                      min="0"
                      placeholder={t('settle.creditLimit')}
                      value={creditLimit}
                      onChange={(e) => setCreditLimit(e.target.value)}
                      aria-label={t('settle.creditLimit')}
                    />
                    <button type="button" className="btn btn-secondary" disabled={submitting} onClick={() => saveCredit(account)}>
                      {t('common.save')}
                    </button>
                  </div>
                  <button className="btn btn-ghost btn-block" onClick={() => setCreditId(null)}>{t('common.cancel')}</button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
