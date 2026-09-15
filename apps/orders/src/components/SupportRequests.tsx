import { useState } from 'react';
import type { SupportRequest } from '../types';

/**
 * «ANYQ просит посмотреть ваши цифры» — и кнопки, которыми это решается.
 *
 * Показывается в кабинете владельца, а не в кассе, потому что кассу видят
 * сотрудники, а это решение владельца. И показывается сверху, а не в глубине
 * настроек: просьба, которую надо искать, — это просьба, на которую ответят
 * «да» не читая.
 *
 * Отвеченное не исчезает. Владелец должен видеть не только то, что он
 * разрешил, но и то, о чём его просили и как часто: три просьбы за неделю —
 * это разговор, который лучше начать ему.
 */

const STATE_LABELS: Record<SupportRequest['state'], string> = {
  pending: 'Ждёт вашего ответа',
  active: 'Доступ открыт',
  declined: 'Вы отказали',
  revoked: 'Вы закрыли доступ',
  expired: 'Доступ истёк',
  none: '',
};

function when(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/** Чем закончилось разрешение — своими словами, а не двумя датами подряд. */
function usageSummary(request: SupportRequest): string {
  if (!request.lastUsedAt) {
    // Разрешение, которым не воспользовались, стоит назвать именно так: это
    // ответ на вопрос «а они вообще смотрели?».
    return request.state === 'pending' ? '' : 'Не воспользовались';
  }
  // «Смотрели с 14:25 до 14:25» — это один заход, описанный как промежуток.
  // Точное равенство здесь не работает: между первым и последним запросом
  // лежат миллисекунды, и они всегда разные. Промежутком это становится
  // тогда, когда он виден на часах.
  const first = new Date(request.firstUsedAt!).getTime();
  const last = new Date(request.lastUsedAt).getTime();
  return last - first < 60_000
    ? `Смотрели ${when(request.lastUsedAt)}`
    : `Смотрели с ${when(request.firstUsedAt!)} до ${when(request.lastUsedAt)}`;
}

export function SupportRequests({
  requests,
  onAnswer,
}: {
  requests: SupportRequest[];
  onAnswer: (id: string, action: 'grant' | 'decline' | 'revoke') => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function answer(id: string, action: 'grant' | 'decline' | 'revoke') {
    setBusyId(id);
    try {
      await onAnswer(id, action);
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) return null;

  const open = requests.filter((r) => r.state === 'pending' || r.state === 'active');
  const past = requests.filter((r) => r.state !== 'pending' && r.state !== 'active');

  return (
    <section className="cab-support">
      {open.map((request) => (
        <div key={request.id} className={`cab-support-card ${request.state}`}>
          <div className="cab-support-head">
            <strong>{request.state === 'pending' ? 'ANYQ просит посмотреть ваши цифры' : 'ANYQ смотрит ваши цифры'}</strong>
            <span className="cab-support-state">{STATE_LABELS[request.state]}</span>
          </div>
          <p className="cab-support-reason">«{request.reason}»</p>
          <p className="cab-support-meta">
            {request.who} · {when(request.requestedAt)}
            {request.expiresAt && request.state === 'active' && ` · закроется ${when(request.expiresAt)}`}
          </p>

          {request.state === 'pending' ? (
            <>
              <p className="cab-support-what">
                Откроется на сутки и закроется само. Мы увидим выручку по сменам и ваши цены —
                и ничего не сможем изменить.
              </p>
              <div className="cab-support-actions">
                <button
                  className="cab-btn-secondary"
                  disabled={busyId === request.id}
                  onClick={() => answer(request.id, 'decline')}
                >
                  Не разрешать
                </button>
                <button
                  className="cab-btn-primary"
                  disabled={busyId === request.id}
                  onClick={() => answer(request.id, 'grant')}
                >
                  {busyId === request.id ? 'Минуту…' : 'Разрешить на сутки'}
                </button>
              </div>
            </>
          ) : (
            <div className="cab-support-actions">
              <span className="cab-support-meta">{usageSummary(request)}</span>
              <button
                className="cab-btn-secondary"
                disabled={busyId === request.id}
                onClick={() => answer(request.id, 'revoke')}
              >
                Закрыть сейчас
              </button>
            </div>
          )}
        </div>
      ))}

      {past.length > 0 && (
        <details className="cab-support-past">
          <summary>Прошлые запросы ({past.length})</summary>
          {past.map((request) => (
            <div key={request.id} className="cab-support-row">
              <span>
                {STATE_LABELS[request.state]} · {request.who}
                <br />
                <span className="cab-support-meta">
                  «{request.reason}» · {when(request.requestedAt)}
                </span>
              </span>
              <span className="cab-support-meta">{usageSummary(request)}</span>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
