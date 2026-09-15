import { useState } from 'react';
import { useTranslation } from '../i18n/useLanguage';
import { ALL_ROLES, rolePhrase } from '../roles';
import type { StaffMember, StaffPayload } from '../types';

/**
 * Сотрудники магазина — там, где стоит владелец.
 *
 * До 15.09.2026 их заводили только из панели ANYQ. Владелец, у которого
 * уволился кассир, звонил нам, чтобы сменить PIN, — в субботу вечером, потому
 * что увольняются именно тогда. А мы держали у себя имена и телефоны чужих
 * сотрудников, хотя тарифы делятся на их количество, а не на их имена.
 *
 * PIN отсюда не читается и не показывается. Задать можно, увидеть заведённый —
 * нельзя: этот экран открывают за прилавком, где стоят люди, а прочитанный
 * PIN — это вход в кассу от чужого имени. Забыли — задайте новый, это дешевле,
 * чем хранить его на виду.
 */

const emptyForm: StaffPayload = { name: '', role: 'cashier', phone: '', posPin: '', clearPin: false };

export function StaffScreen({
  staff,
  limit,
  loading,
  error,
  busy,
  onBack,
  onCreate,
  onUpdate,
}: {
  staff: StaffMember[];
  limit: number | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onBack: () => void;
  onCreate: (payload: StaffPayload) => Promise<boolean>;
  onUpdate: (id: string, payload: StaffPayload) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<StaffPayload>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<StaffPayload>(emptyForm);

  const pinValid = (pin: string) => pin === '' || /^\d{4,6}$/.test(pin);
  const formValid = (f: StaffPayload) => f.name.trim() !== '' && pinValid(f.posPin.trim());

  async function submitNew() {
    if (!formValid(form)) return;
    const ok = await onCreate({ ...form, name: form.name.trim(), phone: form.phone.trim(), posPin: form.posPin.trim() });
    if (ok) {
      setForm(emptyForm);
      setCreating(false);
    }
  }

  function startEdit(person: StaffMember) {
    setEditingId(person.id);
    // PIN не подставляется: его нельзя прочитать. Пустое поле значит «оставить
    // прежний» — иначе правка имени молча отобрала бы у кассира кассу.
    setEditForm({ name: person.name, role: person.role, phone: person.phone, posPin: '', clearPin: false });
  }

  async function submitEdit() {
    if (!editingId || !formValid(editForm)) return;
    const ok = await onUpdate(editingId, {
      ...editForm,
      name: editForm.name.trim(),
      phone: editForm.phone.trim(),
      posPin: editForm.posPin.trim(),
    });
    if (ok) setEditingId(null);
  }

  const atLimit = limit !== null && limit > 0 && staff.length >= limit;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('staff.title')}</span>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        {loading && staff.length === 0 && <div className="empty-state">{t('common.loading')}</div>}

        <div className="field-hint">
          {limit === null || limit <= 0
            ? t('staff.countNoLimit', { count: staff.length })
            : t('staff.count', { count: staff.length, limit })}
        </div>

        {!creating && (
          <button className="btn btn-secondary btn-block" disabled={atLimit} onClick={() => setCreating(true)}>
            {atLimit ? t('staff.atLimit') : t('staff.add')}
          </button>
        )}

        {creating && (
          <div className="form-card">
            <div className="field">
              <label htmlFor="s-name">{t('staff.name')}</label>
              <input id="s-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="s-role">{t('staff.role')}</label>
              <select id="s-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ALL_ROLES.map((r) => <option key={r} value={r}>{t(rolePhrase(r)!)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="s-phone">{t('staff.phone')}</label>
              <input id="s-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="s-pin">{t('staff.pin')}</label>
              <input
                id="s-pin"
                type="text"
                inputMode="numeric"
                value={form.posPin}
                onChange={(e) => setForm({ ...form, posPin: e.target.value })}
                placeholder={t('staff.pinPlaceholder')}
              />
            </div>
            <div className="row-actions">
              <button className="btn btn-secondary" onClick={() => { setCreating(false); setForm(emptyForm); }}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" disabled={!formValid(form) || busy} onClick={submitNew}>
                {busy ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        )}

        {staff.map((person) =>
          editingId === person.id ? (
            <div key={person.id} className="form-card">
              <div className="field">
                <label htmlFor={`e-name-${person.id}`}>{t('staff.name')}</label>
                <input id={`e-name-${person.id}`} type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`e-role-${person.id}`}>{t('staff.role')}</label>
                <select id={`e-role-${person.id}`} value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                  {ALL_ROLES.map((r) => <option key={r} value={r}>{t(rolePhrase(r)!)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`e-phone-${person.id}`}>{t('staff.phone')}</label>
                <input id={`e-phone-${person.id}`} type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`e-pin-${person.id}`}>{t('staff.newPin')}</label>
                <input
                  id={`e-pin-${person.id}`}
                  type="text"
                  inputMode="numeric"
                  value={editForm.posPin}
                  disabled={editForm.clearPin}
                  onChange={(e) => setEditForm({ ...editForm, posPin: e.target.value })}
                  placeholder={person.hasPin ? t('staff.pinKeep') : t('staff.pinPlaceholder')}
                />
              </div>
              {person.hasPin && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={editForm.clearPin}
                    onChange={(e) => setEditForm({ ...editForm, clearPin: e.target.checked, posPin: '' })}
                  />
                  <span>{t('staff.revoke')}</span>
                </label>
              )}
              <div className="row-actions">
                <button className="btn btn-secondary" onClick={() => setEditingId(null)}>{t('common.cancel')}</button>
                <button className="btn btn-primary" disabled={!formValid(editForm) || busy} onClick={submitEdit}>
                  {busy ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <button key={person.id} type="button" className="report-row low" onClick={() => startEdit(person)}>
              <span>
                {person.name}
                <br />
                <span className="order-meta">{rolePhrase(person.role) ? t(rolePhrase(person.role)!) : person.role}{person.phone ? ` · ${person.phone}` : ''}</span>
              </span>
              <span className="order-meta">{person.hasPin ? t('staff.hasPin') : t('staff.noPin')}</span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
