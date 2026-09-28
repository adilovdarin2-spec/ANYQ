import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import type { SettlementAccount, SettlementStatement } from '../types';
import { formatMoney, formatPhone, formatDate } from '../utils';
import { parseTyped } from '../typed-number';

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
  /**
   * Выписка по одному контрагенту, когда её попросили.
   *
   * Отдельным запросом, а не в общем списке: список открывают каждый день,
   * чтобы понять, кому звонить, а документы разворачивают на сверке — и
   * тянуть сто накладных по каждому из сорока должников ради этого нельзя.
   */
  statement: SettlementStatement | null;
  statementFor: string | null;
  statementLoading: boolean;
  onShowStatement: (counterpartyId: string) => void;
  onHideStatement: () => void;
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
  statement,
  statementFor,
  statementLoading,
  onShowStatement,
  onHideStatement,
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
    const value = parseTyped(amount);
    if (!(value > 0)) return;
    const done = await onPay(account.counterpartyId, value);
    if (done) {
      setPayingId(null);
      setAmount('');
    }
  }

  async function saveCredit(account: SettlementAccount) {
    const done = await onSetCredit(account.counterpartyId, creditAllowed, parseTyped(creditLimit) || 0);
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
                {/* Из чего сложилось число в шапке.

                    Сальдо стояло одно: «Должен 8 500». По такому числу нельзя
                    ни спорить, ни соглашаться — а спорят по нему постоянно, это
                    опт. Начислено минус оплачено даёт его в точности
                    (`computeBalance`: `charged - settled - unapplied`, а
                    `paid` — это `settled + unapplied`), поэтому владелец теперь
                    может сложить его сам и сверить со своей тетрадью.

                    Тот же довод, по которому рядом стоит «не разнесено», и тот
                    же, по которому на закрытии смены показывают слагаемые, а не
                    только ожидаемую сумму: итог без слагаемых читается как
                    произвол. */}
                {account.charged > 0 && (
                  <div className="order-item-row">
                    <span>{t('settle.chargedPaid')}</span>
                    <span>
                      {formatMoney(account.charged)} − {formatMoney(account.paid)}
                    </span>
                  </div>
                )}
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
                {/* Деньги, принятые вперёд. Без этой строки итог в шапке не
                    сходился с разбивкой под ним: сальдо предоплату вычитает, а
                    сроки перечисляют неоплаченные документы, на которых её
                    нет. Расхождение владелец читает как ошибку в числах — на
                    том самом экране, по которому решает, кому звонить. */}
                {(account.unapplied ?? 0) > 0 && (
                  <div className="order-item-row">
                    <span>{t('settle.unapplied')}</span>
                    <span>−{formatMoney(account.unapplied ?? 0)}</span>
                  </div>
                )}
              </div>

              {/* По каким документам сложился долг.

                  Сальдо и сроки отвечают «сколько» и «давно ли», а на сверке
                  спрашивают «по каким накладным» — и ответа не было: сервер
                  считал выписку с самого начала и не отдавал её никому,
                  маршрут стоял без единого вызова.

                  Разворачивается по требованию, а не грузится со списком: в
                  список заходят каждый день, чтобы понять, кому звонить, а
                  документы смотрят на сверке. */}
              {statementFor !== account.counterpartyId ? (
                <button className="btn btn-ghost btn-block" onClick={() => onShowStatement(account.counterpartyId)}>
                  {t('settle.showDocuments')}
                </button>
              ) : (
                <>
                  {statementLoading && <div className="empty-state">{t('common.loading')}</div>}
                  {!statementLoading && statement && (
                    <div className="order-items">
                      {/* Заголовок, потому что выше в такой же рамке стоят итоги:
                          без него накладные читаются как их продолжение, а на
                          экране, к которому подходят стоя, разбираться некогда. */}
                      <div className="section-title">{t('settle.documentsTitle')}</div>
                      {statement.charges.length === 0 && statement.payments.length === 0 && (
                        <div className="empty-state">{t('settle.noDocuments')}</div>
                      )}
                      {statement.charges.map((charge) => (
                        <div key={charge.documentId} className="order-item-row">
                          <span>
                            {formatDate(charge.at)} · {t('settle.document')}
                          </span>
                          {/* Начислено и сколько из этого уже закрыто: без
                              второго числа строка не говорит, спорят про неё
                              или она уже оплачена. */}
                          <span>
                            {formatMoney(charge.amount)}
                            {charge.settled > 0 ? ` (${t('settle.ofItPaid', { amount: formatMoney(charge.settled) })})` : ''}
                          </span>
                        </div>
                      ))}
                      {statement.payments.map((payment) => (
                        <div key={payment.id} className="order-item-row">
                          <span>
                            {formatDate(payment.createdAt)} · {t('settle.payment')}
                            {payment.note ? ` · ${payment.note}` : ''}
                          </span>
                          <span>−{formatMoney(payment.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="btn btn-ghost btn-block" onClick={onHideStatement}>
                    {t('settle.hideDocuments')}
                  </button>
                </>
              )}

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
                      type="text"
                      inputMode="numeric"
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
                      type="text"
                      inputMode="numeric"
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
