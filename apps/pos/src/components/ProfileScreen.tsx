import { useState } from 'react';
import { LANGUAGES } from '../i18n';
import { useTranslation } from '../i18n/useLanguage';
import type { Shift } from '../types';
import { formatTime, hoursSince } from '../utils';

interface Props {
  cashierName: string;
  role: string;
  shift: Shift;
  online: boolean;
  pendingCount: number;
  stuckCount: number;
  storefrontUrl: string | null;
  pushSupported: boolean;
  pushEnabled: boolean;
  pushBusy: boolean;
  onTogglePush: () => void;
  onShowDashboard?: () => void;
  onShowReports?: () => void;
  /** Owner-facing: somebody who can read who changed what can also work out
      whose account to use. */
  onShowAudit?: () => void;
  /** Owner-facing: the whole catalogue with costs is not a cashier's to carry
      out of the building. */
  onShowExport?: () => void;
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
  stuckCount,
  storefrontUrl,
  pushSupported,
  pushEnabled,
  pushBusy,
  onTogglePush,
  onShowDashboard,
  onShowReports,
  onShowAudit,
  onShowExport,
  onShowInstall,
  onCloseShift,
  onLogout,
}: Props) {
  const { t, language, setLanguage } = useTranslation();
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
      {stuckCount > 0 && (
        <div className="profile-row">
          <span>⚠ Требуют внимания</span>
          <span>{stuckCount} — обратитесь к владельцу, продажа не проведена</span>
        </div>
      )}

      {/* First, because it is the screen whoever answers for the money opens
          before anything else. */}
      {/* Kazakhstan trades in both languages, and a cashier who reads Kazakh
          more comfortably makes fewer mistakes in Kazakh. The coverage figure
          is shown rather than hidden: nobody should switch expecting the whole
          product and find the gap in the middle of a stocktake. */}
      <div className="profile-section">
        <div className="section-title">{t('language.title')}</div>
        <div className="category-bar">
          {LANGUAGES.map((option) => (
            <button
              key={option.code}
              type="button"
              className={option.code === language ? 'category-chip on' : 'category-chip'}
              onClick={() => setLanguage(option.code)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {/* The sentence, and deliberately no fraction beside it. A count of
            translated keys measures the dictionary, not the interface: every
            key in the dictionary is translated, while most of the product is
            not in the dictionary at all, so "81/81" would read as a claim
            about the app and contradict the sentence it sits next to. */}
        {language !== 'ru' && <div className="field-hint">{t('language.partial')}</div>}
      </div>

      {onShowDashboard && (
        <button type="button" className="profile-action" onClick={onShowDashboard}>
          <span>🧭 Сводка владельца</span>
          <span>›</span>
        </button>
      )}

      {onShowReports && (
        <button type="button" className="profile-action" onClick={onShowReports}>
          <span>📊 Отчёты</span>
          <span>›</span>
        </button>
      )}

      {onShowAudit && (
        <button type="button" className="profile-action" onClick={onShowAudit}>
          <span>📝 Журнал изменений</span>
          <span>›</span>
        </button>
      )}

      {onShowExport && (
        <button type="button" className="profile-action" onClick={onShowExport}>
          <span>↓ Выгрузка данных</span>
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
