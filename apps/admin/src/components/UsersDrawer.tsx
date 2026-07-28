import { useState } from 'react';
import type { CompanyUser, UserRole } from '../types';
import { ROLE_LABELS } from '../types';
import type { UserPayload } from '../api';

interface Props {
  companyId: string;
  companyName: string;
  users: CompanyUser[];
  onClose: () => void;
  onCreate: (companyId: string, payload: UserPayload) => Promise<CompanyUser>;
  onUpdate: (companyId: string, userId: string, payload: UserPayload) => Promise<CompanyUser>;
}

const ALL_ROLES = Object.keys(ROLE_LABELS) as UserRole[];
const emptyForm: UserPayload = { name: '', role: 'cashier', phone: '', posPin: '' };

function formValid(f: UserPayload): boolean {
  return f.name.trim() !== '' && (f.posPin.trim() === '' || /^\d{4,6}$/.test(f.posPin.trim()));
}

export function UsersDrawer({ companyId, companyName, users, onClose, onCreate, onUpdate }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<UserPayload>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<UserPayload>(emptyForm);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!formValid(form)) return;
    setError(null);
    setBusy(true);
    try {
      await onCreate(companyId, { ...form, name: form.name.trim(), phone: form.phone.trim(), posPin: form.posPin.trim() });
      setForm(emptyForm);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить сотрудника');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(u: CompanyUser) {
    setError(null);
    setEditingId(u.id);
    setEditForm({ name: u.name, role: u.role, phone: u.phone, posPin: u.posPin });
  }

  async function handleSaveEdit() {
    if (!editingId || !formValid(editForm)) return;
    setError(null);
    setBusy(true);
    try {
      await onUpdate(companyId, editingId, { ...editForm, name: editForm.name.trim(), phone: editForm.phone.trim(), posPin: editForm.posPin.trim() });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить сотрудника');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="content-title" style={{ fontSize: '1.15rem' }}>Сотрудники — {companyName}</div>
            <div className="content-sub">{users.length} сотрудников</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="drawer-body">
          {error && <div className="login-error">{error}</div>}

          {!creating && (
            <button className="btn btn-secondary" onClick={() => setCreating(true)}>+ Добавить сотрудника</button>
          )}

          {creating && (
            <>
              <div className="section-title">Новый сотрудник</div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="u-name">Имя</label>
                  <input id="u-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Имя Фамилия" />
                </div>
                <div className="field">
                  <label htmlFor="u-role">Роль</label>
                  <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="u-phone">Телефон</label>
                  <input id="u-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Необязательно" />
                </div>
                <div className="field">
                  <label htmlFor="u-pin">PIN для кассы</label>
                  <input id="u-pin" type="text" inputMode="numeric" value={form.posPin} onChange={(e) => setForm({ ...form, posPin: e.target.value })} placeholder="4–6 цифр, необязательно" />
                </div>
              </div>
              <div className="quick-actions">
                <button className="btn btn-secondary" onClick={() => { setCreating(false); setForm(emptyForm); }}>Отмена</button>
                <button className="btn btn-primary" disabled={!formValid(form) || busy} onClick={handleCreate}>
                  {busy ? 'Сохраняем…' : 'Добавить'}
                </button>
              </div>
            </>
          )}

          <div className="section-title">Сотрудники ({users.length})</div>
          {users.length === 0 && <div style={{ color: 'var(--ink-muted)', fontSize: '0.87rem' }}>Сотрудников пока нет</div>}

          {users.map((u) =>
            editingId === u.id ? (
              <div key={u.id} className="mini-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor={`e-uname-${u.id}`}>Имя</label>
                    <input id={`e-uname-${u.id}`} type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`e-urole-${u.id}`}>Роль</label>
                    <select id={`e-urole-${u.id}`} value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                      {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor={`e-uphone-${u.id}`}>Телефон</label>
                    <input id={`e-uphone-${u.id}`} type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`e-upin-${u.id}`}>PIN для кассы</label>
                    <input id={`e-upin-${u.id}`} type="text" inputMode="numeric" value={editForm.posPin} onChange={(e) => setEditForm({ ...editForm, posPin: e.target.value })} placeholder="Пусто — без доступа к кассе" />
                  </div>
                </div>
                <div className="quick-actions">
                  <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Отмена</button>
                  <button className="btn btn-primary" disabled={!formValid(editForm) || busy} onClick={handleSaveEdit}>
                    {busy ? 'Сохраняем…' : 'Сохранить'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                key={u.id}
                type="button"
                className="mini-card"
                onClick={() => startEdit(u)}
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: 'var(--surface)', color: 'inherit' }}
              >
                <span>
                  {u.name}
                  <span style={{ color: 'var(--ink-muted)', fontSize: '0.82rem' }}> · {ROLE_LABELS[u.role]}</span>
                </span>
                <span style={{ color: 'var(--ink-muted)', fontSize: '0.82rem' }}>{u.posPin ? `PIN ${u.posPin}` : 'без PIN'}</span>
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
