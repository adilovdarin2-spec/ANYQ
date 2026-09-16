import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  createCabinetStaff,
  disableCabinetSecondFactor,
  enableCabinetSecondFactor,
  fetchCabinetSecurity,
  fetchCabinetStaff,
  startCabinetSecondFactor,
  updateCabinetStaff,
} from '../api';
import type { CabinetSecurity, CabinetStaffMember } from '../api';

/**
 * Сотрудники из кабинета — и замок, без которого их здесь нет.
 *
 * Кабинет владельца был дверью только на чтение, и одного пароля ему хватало:
 * украденная ссылка стоила подглядывания. PIN это меняет — поменял кассиру,
 * вошёл этим PIN-ом, торгуешь от чужого имени, и обнаружится это на сверке
 * смены, если обнаружится вообще.
 *
 * Поэтому экран устроен как одна дорога, а не как две настройки рядом: пока
 * второй фактор выключен, здесь нет списка сотрудников — есть объяснение,
 * почему его нет, и кнопка включить. Спрятать кнопку и показать список было бы
 * ровно тем, от чего защищаемся.
 *
 * PIN не показывается никогда и ничей. Он задаётся и забывается: карточка
 * сотрудника открывается на чужом экране чаще, чем кажется.
 */

const ROLES: { code: string; label: string; note: string }[] = [
  { code: 'owner', label: 'Владелец', note: 'всё' },
  { code: 'manager', label: 'Менеджер', note: 'смена, товар, приёмка, списание' },
  { code: 'cashier', label: 'Кассир', note: 'продажа и возврат' },
  { code: 'storekeeper', label: 'Кладовщик', note: 'приёмка, перемещение, пересчёт' },
  { code: 'pharmacist', label: 'Фармацевт', note: 'продажа, возврат, приёмка партий' },
];

function roleLabel(code: string): string {
  return ROLES.find((r) => r.code === code)?.label ?? code;
}

export function CabinetStaff({ token }: { token: string }) {
  const [security, setSecurity] = useState<CabinetSecurity | null>(null);
  const [staff, setStaff] = useState<CabinetStaffMember[] | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Настройка замка, пока она идёт.
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  // Показываются ровно один раз — сервер их больше не отдаст.
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const [editing, setEditing] = useState<CabinetStaffMember | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const state = await fetchCabinetSecurity(token);
      setSecurity(state);
      if (!state.enabled) {
        setStaff(null);
        return;
      }
      const people = await fetchCabinetStaff(token);
      setStaff(people.users);
      setLimit(people.limit);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось загрузить');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function beginSetup(fresh = false) {
    setBusy(true);
    setError(null);
    try {
      const started = await startCabinetSecondFactor(token, fresh);
      setSetup({ secret: started.secret, otpauthUri: started.otpauthUri });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось начать настройку');
    } finally {
      setBusy(false);
    }
  }

  async function finishSetup() {
    setBusy(true);
    setError(null);
    try {
      const done = await enableCabinetSecondFactor(token, code.trim());
      setRecoveryCodes(done.recoveryCodes);
      setSetup(null);
      setCode('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось включить');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(password: string, otp: string) {
    setBusy(true);
    setError(null);
    try {
      await disableCabinetSecondFactor(token, password, otp);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось выключить');
    } finally {
      setBusy(false);
    }
  }

  async function save(member: CabinetStaffMember | null, form: StaffForm) {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        role: form.role,
        phone: form.phone.trim(),
        ...(form.clearPin ? { clearPin: true } : form.pin.trim() ? { posPin: form.pin.trim() } : {}),
      };
      if (member) await updateCabinetStaff(token, member.id, payload);
      else await createCabinetStaff(token, payload);
      setEditing(null);
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  if (!security) {
    return (
      <section className="cab-section">
        <h2 className="cab-h2">
          <span>Сотрудники</span>
        </h2>
        <p className="cab-note">{error ?? 'Секунду…'}</p>
      </section>
    );
  }

  return (
    <section className="cab-section">
      <h2 className="cab-h2">
        <span>Сотрудники</span>
        {limit !== null && staff && <span className="cab-h2-total">{staff.length} из {limit}</span>}
      </h2>

      {error && <p className="cab-error cab-note">{error}</p>}

      {recoveryCodes && (
        <div className="cab-codes">
          <p className="cab-note">
            <strong>Сохраните эти коды сейчас — больше они не покажутся.</strong> Каждый работает
            один раз и заменяет код из приложения, если телефон потерялся.
          </p>
          <ul className="cab-codes-list">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button className="cab-button" onClick={() => setRecoveryCodes(null)}>
            Записал
          </button>
        </div>
      )}

      {!security.enabled && !setup && (
        <>
          <p className="cab-note">
            Чтобы вести PIN-ы отсюда, кабинет нужно запереть вторым фактором. Причина прямая: эта
            ссылка открывается с телефона, и если её узнают, чужой человек сможет поменять PIN
            кассиру и войти в кассу под ним. Пароля для такого мало.
          </p>
          <button className="cab-button" disabled={busy} onClick={() => void beginSetup()}>
            {security.pending ? 'Продолжить настройку' : 'Включить второй фактор'}
          </button>
        </>
      )}

      {setup && (
        <div className="cab-setup">
          <p className="cab-note">
            Откройте приложение-аутентификатор и добавьте ключ. Камерой — по ссылке ниже, или
            введите ключ руками, если камера не открывается.
          </p>
          <p className="cab-key">{setup.secret}</p>
          <p className="cab-note">
            <a href={setup.otpauthUri}>Добавить в приложение</a>
          </p>
          <label className="cab-label" htmlFor="cab-otp">
            Код из приложения
          </label>
          <input
            id="cab-otp"
            className="cab-input"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="cab-button" disabled={busy || !code.trim()} onClick={() => void finishSetup()}>
            Включить
          </button>
          <button className="cab-exit" disabled={busy} onClick={() => void beginSetup(true)}>
            Ключ не подходит — выпустить новый
          </button>
        </div>
      )}

      {security.enabled && (
        <>
          {staff && (
            <>
              {staff.map((member) => (
                <div className="cab-row" key={member.id}>
                  <span className="cab-row-name">
                    {member.name}
                    <span className="cab-row-note">
                      {roleLabel(member.role)}
                      {member.hasPin ? ' · вход в кассу есть' : ' · без входа в кассу'}
                    </span>
                  </span>
                  <span className="cab-row-dots" aria-hidden="true" />
                  <button className="cab-exit" onClick={() => setEditing(member)}>
                    Изменить
                  </button>
                </div>
              ))}
              {!adding && !editing && (
                <button className="cab-button" onClick={() => setAdding(true)}>
                  Добавить сотрудника
                </button>
              )}
            </>
          )}

          {(adding || editing) && (
            <StaffForm
              member={editing}
              busy={busy}
              onCancel={() => {
                setAdding(false);
                setEditing(null);
              }}
              onSave={(form) => void save(editing, form)}
            />
          )}

          <DisableSecondFactor busy={busy} onDisable={(p, c) => void turnOff(p, c)} />
        </>
      )}
    </section>
  );
}

interface StaffForm {
  name: string;
  role: string;
  phone: string;
  pin: string;
  clearPin: boolean;
}

function StaffForm({
  member,
  busy,
  onCancel,
  onSave,
}: {
  member: CabinetStaffMember | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (form: StaffForm) => void;
}) {
  const [form, setForm] = useState<StaffForm>({
    name: member?.name ?? '',
    role: member?.role ?? 'cashier',
    phone: member?.phone ?? '',
    pin: '',
    clearPin: false,
  });

  return (
    <div className="cab-setup">
      <label className="cab-label" htmlFor="cab-staff-name">
        Имя
      </label>
      <input
        id="cab-staff-name"
        className="cab-input"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />

      <label className="cab-label" htmlFor="cab-staff-role">
        Роль
      </label>
      <select
        id="cab-staff-role"
        className="cab-input"
        value={form.role}
        onChange={(e) => setForm({ ...form, role: e.target.value })}
      >
        {ROLES.map((r) => (
          <option key={r.code} value={r.code}>
            {r.label} — {r.note}
          </option>
        ))}
      </select>

      <label className="cab-label" htmlFor="cab-staff-pin">
        PIN для кассы
      </label>
      <input
        id="cab-staff-pin"
        className="cab-input"
        inputMode="numeric"
        value={form.pin}
        disabled={form.clearPin}
        onChange={(e) => setForm({ ...form, pin: e.target.value })}
      />
      {/* Пустое поле значит «не трогать», а не «снять»: прочитать прежний PIN
          нельзя, и правка имени не должна молча отбирать у человека кассу. */}
      <p className="cab-hint">
        {member
          ? 'Пусто — оставить прежний. Новый PIN сразу отключает старый вход: смена, открытая на кассе, закроется.'
          : 'Четыре-шесть цифр. Можно не задавать — тогда человек в кассу не входит.'}
      </p>
      {member?.hasPin && (
        <label className="cab-check">
          <input
            type="checkbox"
            checked={form.clearPin}
            onChange={(e) => setForm({ ...form, clearPin: e.target.checked, pin: '' })}
          />
          Снять вход в кассу совсем
        </label>
      )}

      <button className="cab-button" disabled={busy || !form.name.trim()} onClick={() => onSave(form)}>
        Сохранить
      </button>
      <button className="cab-exit" disabled={busy} onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}

/**
 * Выключение — с паролем и кодом сразу.
 *
 * Открытая вкладка на чужом телефоне иначе снимала бы ровно ту защиту, ради
 * которой она и заводилась.
 */
function DisableSecondFactor({
  busy,
  onDisable,
}: {
  busy: boolean;
  onDisable: (password: string, code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  if (!open) {
    return (
      <button className="cab-exit" onClick={() => setOpen(true)}>
        Выключить второй фактор
      </button>
    );
  }

  return (
    <div className="cab-setup">
      <p className="cab-note">
        Вместе с ним из кабинета пропадут и сотрудники: без второго фактора PIN-ы отсюда не
        выдаются. Вести их можно будет из кассы, как раньше.
      </p>
      <label className="cab-label" htmlFor="cab-off-password">
        Пароль кабинета
      </label>
      <input
        id="cab-off-password"
        className="cab-input"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <label className="cab-label" htmlFor="cab-off-code">
        Код из приложения
      </label>
      <input
        id="cab-off-code"
        className="cab-input"
        inputMode="numeric"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <button
        className="cab-button"
        disabled={busy || !password || !code.trim()}
        onClick={() => onDisable(password, code.trim())}
      >
        Выключить
      </button>
      <button className="cab-exit" disabled={busy} onClick={() => setOpen(false)}>
        Передумал
      </button>
    </div>
  );
}
