import { useState } from 'react';
import type { PosRegisterChoice } from '../api';
import { useTranslation } from '../i18n/useLanguage';

/**
 * «Какая это касса?» — вопрос, который задают один раз.
 *
 * Появляется, когда устройство себя не узнало, а кассы у магазина уже есть:
 * переустановили программу, почистили кэш, поменяли планшет. Раньше в этот
 * момент молча заводилась новая строка, и та же касса у входа оказывалась в
 * списке второй, третьей, четвёртой — а тариф считает рабочие места.
 *
 * Кассир уже вошёл и может торговать. Экран закрывается кнопкой «позже», и
 * это не лазейка: касса без номера просто не подписана в списке владельца, и
 * вопрос повторится при следующем входе.
 *
 * Кнопки крупные: за терминалом стоят в перчатках и отвечают на этот вопрос в
 * восемь утра при очереди.
 */
interface Props {
  choices: PosRegisterChoice[];
  /** Почему «новой» быть нельзя. Пусто — можно. */
  newRefusal: string | null;
  onClaim: (registerId: string) => Promise<void>;
  onCreate: () => Promise<void>;
  onSkip: () => void;
}

function lastSeenPhrase(iso: string, locale: string): string {
  const seen = new Date(iso);
  if (Number.isNaN(seen.getTime())) return '';
  return seen.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function RegisterChoiceScreen({ choices, newRefusal, onClaim, onCreate, onSkip }: Props) {
  const { t, language } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = language === 'kk' ? 'kk-KZ' : 'ru-RU';

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('register.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-shell register-choice">
      <div className="register-choice-card">
        <h1>{t('register.which')}</h1>
        <p className="register-choice-hint">{t('register.why')}</p>

        <div className="register-choice-list">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="register-choice-option"
              disabled={busy}
              onClick={() => run(() => onClaim(choice.id))}
            >
              {/*
                Крупно — номер, и только он. Имя касса носит то, которое ей дал
                владелец: «касса у входа», а у касс, заведённых до нумерации, —
                «Устройство», угаданное по браузеру. Ни то ни другое не отвечает
                на вопрос «за какой кассой вы стоите», а номер отвечает.
              */}
              <span className="register-choice-name">{t('register.number', { number: choice.number })}</span>
              <span className="register-choice-meta">
                {choice.name && choice.name !== t('register.number', { number: choice.number })
                  ? `${choice.name} · `
                  : ''}
                {t('register.lastSeen')} {lastSeenPhrase(choice.lastSeenAt, locale)}
              </span>
            </button>
          ))}
        </div>

        {newRefusal ? (
          // Причина, а не серая кнопка. Кассир, которому нужна вторая касса, и
          // так упрётся — пусть он сразу знает, к кому идти.
          <div className="register-choice-refusal">{newRefusal}</div>
        ) : (
          <button type="button" className="btn btn-primary register-choice-new" disabled={busy} onClick={() => run(onCreate)}>
            {t('register.new')}
          </button>
        )}

        {error && <div className="register-choice-error">{error}</div>}

        <button type="button" className="register-choice-skip" disabled={busy} onClick={onSkip}>
          {t('register.later')}
        </button>
      </div>
    </div>
  );
}
