import { useState } from 'react';
import { ApiError, disableMfa, enableMfa, startMfaSetup } from '../api';
import type { MfaSetup } from '../api';

interface Props {
  token: string;
  enabled: boolean;
  /** Ключ уже выпущен и ждёт кода — сканировали, но до конца не дошли. */
  pending: boolean;
  recoveryCodesLeft: number;
  onChanged: () => void;
}

/**
 * The second factor on the account that can change every price, every role and
 * every credit limit in every company on the platform.
 *
 * A password alone on that account is the whole platform's security, and
 * passwords are reused.
 */
export function MfaSettings({ token, enabled, pending, recoveryCodesLeft, onChanged }: Props) {
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div className="field">
        <h2 className="login-title">Коды восстановления</h2>
        {/* The only time these are readable. They are stored hashed, so there
            is no second chance to show them, and an owner who closes this
            without saving them has a phone as their only way in. */}
        <p>
          Сохраните их сейчас — больше они не покажутся. Каждый работает один раз, на случай
          потери телефона.
        </p>
        <pre style={{ fontSize: '1.05rem', lineHeight: 1.9, letterSpacing: '0.04em' }}>
          {recoveryCodes.join('\n')}
        </pre>
        <button
          className="btn btn-primary"
          onClick={() => {
            setRecoveryCodes(null);
            onChanged();
          }}
        >
          Я сохранил коды
        </button>
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="field">
        <h2 className="login-title">Двухфакторный вход включён</h2>
        <p>
          Осталось кодов восстановления: {recoveryCodesLeft}.
          {recoveryCodesLeft <= 2 && ' Их почти не осталось — выключите и включите заново, чтобы получить новые.'}
        </p>
        {/* Both factors to turn it off. A session left open on an unlocked
            laptop would otherwise remove the very protection that session was
            supposed to need. */}
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="mfa-password">Пароль</label>
          <input id="mfa-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="mfa-off-code">Код из приложения или код восстановления</label>
          <input id="mfa-off-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        {error && <div className="login-error">{error}</div>}
        <button
          className="btn btn-secondary"
          style={{ marginTop: 16 }}
          disabled={busy || !password || !code}
          onClick={() => run(async () => {
            await disableMfa(token, password, code);
            setPassword('');
            setCode('');
            onChanged();
          })}
        >
          Выключить двухфакторный вход
        </button>
      </div>
    );
  }

  if (setup) {
    return (
      <div className="field">
        <h2 className="login-title">{setup.reused ? 'Тот же ключ' : 'Отсканируйте ключ'}</h2>
        <p>
          {setup.reused
            ? 'Это тот ключ, который уже был выпущен. Если он есть в приложении на телефоне, просто введите код; если нет — добавьте его сейчас.'
            : 'Откройте Google Authenticator или другое такое приложение и добавьте ключ. Если камера не работает, введите его вручную:'}
        </p>
        <pre style={{ fontSize: '1.05rem', letterSpacing: '0.08em' }}>{setup.secret}</pre>
        <p style={{ wordBreak: 'break-all', fontSize: '0.85rem' }}>{setup.otpauthUri}</p>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="mfa-code">Код из приложения</label>
          <input id="mfa-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        {error && <div className="login-error">{error}</div>}
        <button
          className="btn btn-primary"
          style={{ marginTop: 16 }}
          disabled={busy || code.trim().length < 6}
          onClick={() => run(async () => {
            const result = await enableMfa(token, code.trim());
            setCode('');
            setSetup(null);
            setRecoveryCodes(result.recoveryCodes);
          })}
        >
          Включить
        </button>
      </div>
    );
  }

  // Ключ уже выпущен — значит человек сюда вернулся, а не начинает.
  //
  // Раньше этот экран в обоих случаях предлагал «Настроить», и нажатие выпускало
  // новый ключ поверх ждущего. Код с уже отсканированного телефона после этого
  // не подходил, а сервер отвечал «проверьте время на телефоне» — то есть
  // человек шёл крутить часы вместо того, чтобы сканировать заново.
  if (pending) {
    return (
      <div className="field">
        <h2 className="login-title">Ключ уже выпущен</h2>
        <p>
          Его отсканировали или собирались отсканировать, но код так и не ввели. Пока код не
          введён, второй фактор не включён и вход работает по-старому.
        </p>
        {error && <div className="login-error">{error}</div>}
        <button
          className="btn btn-primary"
          style={{ marginTop: 16 }}
          disabled={busy}
          onClick={() => run(async () => setSetup(await startMfaSetup(token)))}
        >
          Ввести код
        </button>
        {/* Отдельной кнопкой и с прямым предупреждением: это единственный способ
            потерять уже выданный ключ, и делать это случайно нельзя. */}
        <button
          className="btn btn-secondary"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={() => run(async () => setSetup(await startMfaSetup(token, true)))}
        >
          Выпустить новый ключ
        </button>
        <p style={{ fontSize: '0.85rem', marginTop: 8 }}>
          Новый ключ отменяет старый: то, что уже добавлено в приложение на телефоне, перестанет
          подходить.
        </p>
      </div>
    );
  }

  return (
    <div className="field">
      <h2 className="login-title">Двухфакторный вход</h2>
      <p>
        Второй фактор на учётной записи, которая может изменить любую цену, любую роль и любой
        кредитный лимит в любой компании. Пароля одного здесь мало.
      </p>
      {error && <div className="login-error">{error}</div>}
      <button
        className="btn btn-primary"
        style={{ marginTop: 16 }}
        disabled={busy}
        onClick={() => run(async () => setSetup(await startMfaSetup(token)))}
      >
        Настроить
      </button>
    </div>
  );
}
