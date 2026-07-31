import { useState } from 'react';
import type { FormEvent } from 'react';
import { login } from '../api';

interface Props {
  onLogin: (token: string, user: { id: string; email: string; name: string }) => void;
}

export function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(email, password);
      onLogin(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand" style={{ marginBottom: 22 }}>
          <span className="brand-mark">A</span>
          <span className="brand-name">ANYQ</span>
        </div>
        <h1 className="login-title">Вход в суперадмин</h1>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="password">Пароль</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="login-error">{error}</div>}
        <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} disabled={loading} type="submit">
          {loading ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
