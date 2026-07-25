import { useState } from 'react';
import { posLogin } from '../api';
import type { PosSession } from '../api';

interface Props {
  onLogin: (session: PosSession) => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function PinLogin({ onLogin }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(value: string) {
    if (value.length === 0 || loading) return;
    setError(null);
    setLoading(true);
    try {
      const session = await posLogin(value);
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
      setPin('');
    } finally {
      setLoading(false);
    }
  }

  function press(key: string) {
    if (key === '') return;
    if (key === '⌫') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    setPin((p) => (p.length < 6 ? p + key : p));
  }

  return (
    <div className="pos-shell">
      <div className="form-card">
        <h1>Вход в кассу</h1>
        <p className="sub">Введите PIN-код кассира</p>
        <div className="pin-display">{pin ? pin.split('').map(() => '•').join(' ') : '—'}</div>
        {error && <div className="login-error">{error}</div>}
        <div className="pin-pad">
          {KEYS.map((k, i) =>
            k === '' ? (
              <span key={i} />
            ) : (
              <button key={i} type="button" className="pin-key" onClick={() => press(k)} disabled={loading}>
                {k}
              </button>
            ),
          )}
        </div>
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 16 }}
          disabled={loading || pin.length === 0}
          onClick={() => submit(pin)}
        >
          {loading ? 'Входим…' : 'Войти'}
        </button>
      </div>
    </div>
  );
}
