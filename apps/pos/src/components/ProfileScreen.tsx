import { useState } from 'react';
import type { Shift } from '../types';
import { formatTime, hoursSince } from '../utils';

interface Props {
  cashierName: string;
  role: string;
  shift: Shift;
  online: boolean;
  pendingCount: number;
  storefrontUrl: string | null;
  pushSupported: boolean;
  pushEnabled: boolean;
  pushBusy: boolean;
  onTogglePush: () => void;
  onShowReports?: () => void;
  onShowInstall: () => void;
  onCloseShift: () => void;
  onLogout: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  cashier: 'Кассир',
  warehouse_staff: 'Кладовщик',
  pharmacist: 'Фармацевт',
};

export function ProfileScreen({
  cashierName,
  role,
  shift,
  online,
  pendingCount,
  storefrontUrl,
  pushSupported,
  pushEnabled,
  pushBusy,
  onTogglePush,
  onShowReports,
  onShowInstall,
  onCloseShift,
  onLogout,
}: Props) {
  const [copied, setCopied] = useState(false);
  const hours = hoursSince(shift.openedAt);

  function copyLink() {
    if (!storefrontUrl) return;
    navigator.clipboard.writeText(storefrontUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="tab-content">
      <div className="tab-header">Профиль</div>

      <div className="profile-card">
        <div className="profile-avatar">{cashierName.charAt(0)}</div>
        <div>
          <div className="profile-name">{cashierName}</div>
          <div className="profile-role">{ROLE_LABELS[role] ?? role}</div>
        </div>
      </div>

      <div className="profile-row">
        <span>Смена</span>
        <span>с {formatTime(shift.openedAt)} · {Math.floor(hours)} ч</span>
      </div>
      <div className="profile-row">
        <span>Синхронизация</span>
        <span>
          <span className={`dot ${online ? 'online' : 'offline'}`}></span>{' '}
          {online ? 'Онлайн' : 'Офлайн'}
          {pendingCount > 0 ? ` · ждут отправки: ${pendingCount}` : ''}
        </span>
      </div>

      {onShowReports && (
        <button type="button" className="profile-action" onClick={onShowReports}>
          <span>📊 Отчёты</span>
          <span>›</span>
        </button>
      )}

      {storefrontUrl && (
        <div className="profile-section">
          <div className="section-title">Ссылка магазина для клиентов</div>
          <div className="mini-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ fontSize: '0.85rem', wordBreak: 'break-all', color: 'var(--ink-muted)' }}>{storefrontUrl}</div>
            <button type="button" className="btn btn-secondary" onClick={copyLink}>
              {copied ? 'Скопировано ✓' : 'Скопировать ссылку'}
            </button>
          </div>
        </div>
      )}

      {pushSupported && (
        <button type="button" className="profile-action" onClick={onTogglePush} disabled={pushBusy}>
          <span>{pushEnabled ? '🔔' : '🔕'} Уведомления о заказах</span>
          <span>{pushEnabled ? 'Включены' : 'Выключены'}</span>
        </button>
      )}

      <button type="button" className="profile-action" onClick={onShowInstall}>
        <span>⬇ Установить приложение</span>
        <span>›</span>
      </button>

      <div className="profile-section">
        <button type="button" className="btn btn-secondary btn-block" onClick={onCloseShift}>Закрыть смену</button>
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={onLogout}>Сменить кассира</button>
      </div>
    </div>
  );
}
