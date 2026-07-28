import { useEffect, useState } from 'react';
import type { Company, ModuleKey, SupportLevel, Tariff } from '../types';
import { MODULE_LABELS, SUPPORT_LABELS, ROLE_LABELS } from '../types';
import { StatusChip } from './StatusChip';
import { formatDate, formatDateTime, formatMoney, getTariffState, extendValidUntil, DURATION_LABELS } from '../utils';
import type { DurationPreset } from '../utils';
import type { ShiftSummary, TariffPayload } from '../api';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  kaspi: 'Kaspi QR',
  card: 'Карта',
};

interface Props {
  company: Company;
  onClose: () => void;
  onUpdateTariff: (companyId: string, payload: TariffPayload) => Promise<void>;
  onLoadShifts: (companyId: string) => Promise<ShiftSummary[]>;
}

const ALL_MODULES: ModuleKey[] = ['shop', 'warehouse', 'pharmacy', 'supply', 'terminal', 'restaurant'];
const ALL_DURATIONS: DurationPreset[] = ['1m', '3m', '6m', '1y'];

function parseLimit(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toPayload(t: Tariff): TariffPayload {
  return {
    modules: t.modules,
    locationLimit: t.locationLimit,
    userLimit: t.userLimit,
    skuLimit: t.skuLimit,
    supportLevel: t.supportLevel,
    validUntil: t.validUntil,
    blocked: t.blocked,
    notes: t.notes,
  };
}

export function CompanyDetailDrawer({ company, onClose, onUpdateTariff, onLoadShifts }: Props) {
  const [tariff, setTariff] = useState<Tariff>(company.tariff);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<ShiftSummary[] | null>(null);
  const [shiftsError, setShiftsError] = useState<string | null>(null);
  const state = getTariffState(tariff);

  useEffect(() => {
    onLoadShifts(company.id)
      .then(setShifts)
      .catch((err) => setShiftsError(err instanceof Error ? err.message : 'Не удалось загрузить смены'));
  }, [company.id, onLoadShifts]);

  async function persist(updated: Tariff) {
    setError(null);
    setBusy(true);
    try {
      await onUpdateTariff(company.id, toPayload(updated));
      setTariff(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  function toggleModule(m: ModuleKey) {
    setTariff((prev) => ({
      ...prev,
      modules: prev.modules.includes(m) ? prev.modules.filter((x) => x !== m) : [...prev.modules, m],
    }));
  }

  function saveTariff() {
    persist(tariff);
  }

  function extend(preset: DurationPreset) {
    persist({ ...tariff, validUntil: extendValidUntil(tariff.validUntil, preset) });
  }

  function toggleBlocked() {
    persist({ ...tariff, blocked: !tariff.blocked });
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="content-title" style={{ fontSize: '1.15rem' }}>{company.name}</div>
            <div className="content-sub">{company.phone} · создана {formatDate(company.createdAt)}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="drawer-body">
          {error && <div className="login-error">{error}</div>}

          <div className="info-grid">
            <div className="info-item"><span className="label">Статус</span><span className="value"><StatusChip state={state} /></span></div>
            <div className="info-item"><span className="label">Действует до</span><span className="value">{formatDate(tariff.validUntil)}</span></div>
          </div>

          <div className="section-title">Продлить</div>
          <div className="quick-actions">
            {ALL_DURATIONS.map((d) => (
              <button key={d} className="btn btn-secondary" disabled={busy} onClick={() => extend(d)}>{DURATION_LABELS[d]}</button>
            ))}
          </div>

          <div className="quick-actions">
            {tariff.blocked
              ? <button className="btn btn-primary" disabled={busy} onClick={toggleBlocked}>Разблокировать</button>
              : <button className="btn btn-danger" disabled={busy} onClick={toggleBlocked}>Заблокировать</button>}
          </div>

          <div className="section-title">Точки ({company.locations.length})</div>
          {company.locations.map((l) => (
            <div key={l.id} className="mini-card">
              <span>{l.name}</span>
              <span className="module-badge">{MODULE_LABELS[l.type]}</span>
            </div>
          ))}

          <div className="section-title">Пользователи ({company.users.length})</div>
          {company.users.map((u) => (
            <div key={u.id} className="mini-card">
              <span>{u.name}</span>
              <span style={{ color: 'var(--ink-muted)', fontSize: '0.82rem' }}>{ROLE_LABELS[u.role]}</span>
            </div>
          ))}

          <div className="section-title">Смены</div>
          {shiftsError && <div className="login-error">{shiftsError}</div>}
          {!shiftsError && shifts === null && <div style={{ color: 'var(--ink-muted)', fontSize: '0.87rem' }}>Загрузка…</div>}
          {shifts !== null && shifts.length === 0 && (
            <div style={{ color: 'var(--ink-muted)', fontSize: '0.87rem' }}>Смен пока не было</div>
          )}
          {shifts?.map((s) => {
            const expectedCash = s.openingCash + (s.totalsByMethod.cash ?? 0);
            const diff = s.closingCashCounted !== null ? s.closingCashCounted - expectedCash : null;
            return (
              <div key={s.id} className="mini-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600 }}>{s.cashierName}</span>
                  <span className={`chip ${s.closedAt ? 'chip-suspended' : 'chip-active'}`}>{s.closedAt ? 'Закрыта' : 'Открыта'}</span>
                </div>
                <div style={{ color: 'var(--ink-muted)', fontSize: '0.82rem' }}>
                  {formatDateTime(s.openedAt)} {s.closedAt ? `— ${formatDateTime(s.closedAt)}` : '— сейчас'}
                </div>
                <div style={{ color: 'var(--ink-muted)', fontSize: '0.82rem' }}>
                  {s.salesCount} продаж · {formatMoney(s.totalSales)}
                  {Object.keys(s.totalsByMethod).length > 0 &&
                    ' · ' +
                      Object.entries(s.totalsByMethod)
                        .map(([method, sum]) => `${PAYMENT_METHOD_LABELS[method] ?? method}: ${formatMoney(sum)}`)
                        .join(', ')}
                </div>
                {diff !== null && (
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: diff === 0 ? 'var(--status-active)' : 'var(--status-overdue)' }}>
                    {diff === 0 ? 'Касса сошлась' : diff < 0 ? `Недостача ${formatMoney(Math.abs(diff))}` : `Излишек ${formatMoney(diff)}`}
                  </div>
                )}
              </div>
            );
          })}

          <div className="section-title">Тариф</div>
          <div className="field">
            <label>Модули</label>
            <div className="module-toggles">
              {ALL_MODULES.map((m) => (
                <button type="button" key={m} className={tariff.modules.includes(m) ? 'module-toggle on' : 'module-toggle'} onClick={() => toggleModule(m)}>
                  {MODULE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="d-locLimit">Лимит точек</label>
              <input id="d-locLimit" type="number" min="0" value={tariff.locationLimit ?? ''} onChange={(e) => setTariff({ ...tariff, locationLimit: parseLimit(e.target.value) })} placeholder="Без ограничений" />
            </div>
            <div className="field">
              <label htmlFor="d-userLimit">Лимит пользователей</label>
              <input id="d-userLimit" type="number" min="0" value={tariff.userLimit ?? ''} onChange={(e) => setTariff({ ...tariff, userLimit: parseLimit(e.target.value) })} placeholder="Без ограничений" />
            </div>
            <div className="field">
              <label htmlFor="d-skuLimit">Лимит SKU</label>
              <input id="d-skuLimit" type="number" min="0" value={tariff.skuLimit ?? ''} onChange={(e) => setTariff({ ...tariff, skuLimit: parseLimit(e.target.value) })} placeholder="Без ограничений" />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="d-support">Уровень поддержки</label>
              <select id="d-support" value={tariff.supportLevel} onChange={(e) => setTariff({ ...tariff, supportLevel: e.target.value as SupportLevel })}>
                {(Object.keys(SUPPORT_LABELS) as SupportLevel[]).map((k) => <option key={k} value={k}>{SUPPORT_LABELS[k]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="d-validUntil">Действует до (точная дата)</label>
              <input id="d-validUntil" type="date" value={tariff.validUntil} onChange={(e) => setTariff({ ...tariff, validUntil: e.target.value })} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="d-notes">Индивидуальные условия</label>
            <textarea id="d-notes" rows={3} value={tariff.notes} onChange={(e) => setTariff({ ...tariff, notes: e.target.value })} />
          </div>
        </div>

        <div className="drawer-footer">
          <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
          <button className="btn btn-primary" disabled={busy} onClick={saveTariff}>{busy ? 'Сохраняем…' : 'Сохранить тариф'}</button>
        </div>
      </div>
    </div>
  );
}
