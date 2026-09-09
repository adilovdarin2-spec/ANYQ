import { useState } from 'react';

interface Props {
  company: string;
  /** Первый заход: пароля ещё нет, владелец его придумывает. */
  needsPassword: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
}

/**
 * Дверь в кабинет: придумать пароль в первый раз или ввести его потом.
 *
 * Один экран на оба случая, потому что для владельца это одно и то же место —
 * он открыл свою ссылку и хочет увидеть магазин. Меняется заголовок и то, что
 * происходит с введённым.
 *
 * Название компании показывается до всякого пароля намеренно: владелец должен
 * убедиться, что открыл свою ссылку, а не соседа. Больше по ссылке не видно
 * ничего — ни выручки, ни точек, ни имён.
 */
export function CabinetGate({ company, needsPassword, submitting, error, onSubmit }: Props) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [show, setShow] = useState(false);

  // Свой текст вместо серверного «пароли не совпадают»: это единственная
  // ошибка, которую видно, не отправляя пароль на сервер.
  const mismatch = needsPassword && repeat.length > 0 && password !== repeat;
  const canSubmit = password.length > 0 && !submitting && (!needsPassword || (repeat.length > 0 && !mismatch));

  return (
    <div className="cab-gate">
      <div className="cab-gate-card">
        <div className="cab-brand">ANYQ</div>
        <h1 className="cab-gate-title">{company}</h1>
        <p className="cab-gate-sub">
          {needsPassword
            ? 'Это ваш кабинет. Придумайте пароль — его знаете только вы, мы его не видим и не восстанавливаем.'
            : 'Кабинет владельца. Введите свой пароль.'}
        </p>

        <form
          className="cab-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSubmit(password);
          }}
        >
          <label className="cab-label" htmlFor="cab-password">
            Пароль
          </label>
          <input
            id="cab-password"
            className="cab-input"
            type={show ? 'text' : 'password'}
            value={password}
            autoComplete={needsPassword ? 'new-password' : 'current-password'}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />

          {needsPassword && (
            <>
              <label className="cab-label" htmlFor="cab-repeat">
                Ещё раз
              </label>
              <input
                id="cab-repeat"
                className="cab-input"
                type={show ? 'text' : 'password'}
                value={repeat}
                autoComplete="new-password"
                onChange={(e) => setRepeat(e.target.value)}
              />
              <p className="cab-hint">
                От 10 знаков. По этой ссылке видна выручка — телефон и дата рождения не подойдут.
              </p>
            </>
          )}

          <label className="cab-check">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Показать пароль
          </label>

          {mismatch && <p className="cab-error">Пароли не совпадают</p>}
          {error && <p className="cab-error">{error}</p>}

          <button className="cab-button" type="submit" disabled={!canSubmit}>
            {submitting ? 'Секунду…' : needsPassword ? 'Сохранить и войти' : 'Войти'}
          </button>
        </form>

        <p className="cab-foot">
          Забыли пароль? Его нельзя восстановить — новую ссылку выдаёт касса, раздел «Кабинет владельца».
        </p>
      </div>
    </div>
  );
}
