import { useState } from 'react';

interface Props {
  company: string;
  /** Первый заход: пароля ещё нет, владелец его придумывает. */
  needsPassword: boolean;
  submitting: boolean;
  error: string | null;
  /**
   * Сервер попросил код из приложения.
   *
   * Поле появляется только после того, как пароль оказался верен: спросить код
   * сразу значило бы сказать нашедшему ссылку, что за ней живой кабинет с
   * защитой, — то есть что подбирать пароль имеет смысл.
   */
  needsCode: boolean;
  onSubmit: (password: string, code: string) => void;
  /**
   * Владелец начал исправлять то, на что жаловался сервер.
   *
   * Отказ приходит сверху и сам не уходит: сервер ответил «пароль короче 10
   * знаков», владелец набрал пятнадцать — и надпись про «короче» висела под
   * полем, противореча тому, что в нём написано. Верить в такой момент нечему:
   * либо экран врёт, либо пароль правда не тот.
   */
  onEdit: () => void;
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
export function CabinetGate({ company, needsPassword, submitting, error, needsCode, onSubmit, onEdit }: Props) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  /* Код из приложения или код восстановления — поле одно и запрос один, разная только
     клавиатура: шесть цифр набирают каждый вход, код восстановления — один раз в жизни. */
  const [recovery, setRecovery] = useState(false);
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
            if (canSubmit) onSubmit(password, code.trim());
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
            onChange={(e) => {
              setPassword(e.target.value);
              onEdit();
            }}
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
                onChange={(e) => {
                  setRepeat(e.target.value);
                  onEdit();
                }}
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

          {needsCode && (
            <>
              <label className="cab-label" htmlFor="cab-code">
                {recovery ? 'Код восстановления' : 'Код из приложения'}
              </label>
              {/* Цифровая клавиатура — только пока ждём шесть цифр.

                  Поле с самого начала принимало и код восстановления — `XZ7I-VOEM`, буквы и
                  дефис, — и подсказка прямо это предлагала. Но `inputMode="numeric"` на телефоне
                  открывает цифровую панель, на которой букв нет вовсе. А кабинет и есть экран
                  телефона — так написано в соседнем предупреждении про второй фактор. То есть
                  ровно в тот единственный раз, когда код восстановления нужен, набрать его было
                  нечем. Найдено 02.10.2026 прогоном кабинета. */}
              <input
                id="cab-code"
                className="cab-input"
                type="text"
                inputMode={recovery ? 'text' : 'numeric'}
                autoComplete={recovery ? 'off' : 'one-time-code'}
                autoCapitalize="characters"
                value={code}
                autoFocus
                onChange={(e) => setCode(e.target.value)}
              />
              {recovery ? (
                <p className="cab-hint">
                  Один из тех, что вы сохранили при включении — вроде XZ7I-VOEM. Каждый работает один раз.
                </p>
              ) : (
                <p className="cab-hint">Шесть цифр из приложения-аутентификатора.</p>
              )}
              <button
                className="cab-link"
                type="button"
                onClick={() => {
                  setRecovery((was) => !was);
                  setCode('');
                }}
              >
                {recovery ? 'У меня есть приложение' : 'Телефон потерялся — ввести код восстановления'}
              </button>
            </>
          )}

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
