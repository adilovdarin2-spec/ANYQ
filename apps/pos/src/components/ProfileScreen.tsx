import { useState } from 'react';
import { LANGUAGES } from '../i18n';
import type { PhraseKey } from '../i18n';
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

// Phrase keys, not labels: a constant holding translated text is translated
// once, at import, and never changes when somebody switches language.
const ROLE_PHRASES: Record<string, PhraseKey> = {
  owner: 'role.owner',
  manager: 'role.manager',
  cashier: 'role.cashier',
  warehouse_staff: 'role.warehouse',
  pharmacist: 'role.pharmacist',
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
      <div className="tab-header">{t('tab.profile')}</div>

      <div className="profile-card">
        <div className="profile-avatar">{cashierName.charAt(0)}</div>
        <div>
          <div className="profile-name">{cashierName}</div>
          <div className="profile-role">{ROLE_PHRASES[role] ? t(ROLE_PHRASES[role]) : role}</div>
        </div>
      </div>

      <div className="profile-row">
        <span>{t('profile.shift')}</span>
        <span>{t('profile.shiftSince', { time: formatTime(shift.openedAt), hours: Math.floor(hours) })}</span>
      </div>
      <div className="profile-row">
        <span>{t('profile.sync')}</span>
        <span>
          <span className={`dot ${online ? 'online' : 'offline'}`}></span>{' '}
          {online ? t('shift.bar.online') : t('shift.bar.offline')}
          {pendingCount > 0 ? ` · ${t('profile.syncPending', { count: pendingCount })}` : ''}
        </span>
      </div>
      {stuckCount > 0 && (
        <div className="profile-row">
          <span>⚠ {t('profile.needAttention')}</span>
          <span>{t('profile.stuck', { count: stuckCount })}</span>
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
        {language !== 'ru' && <div className="field-hint">{t('language.caveat')}</div>}
      </div>

      {onShowDashboard && (
        <button type="button" className="profile-action" onClick={onShowDashboard}>
          <span>🧭 {t('profile.dashboard')}</span>
          <span>›</span>
        </button>
      )}

      {onShowReports && (
        <button type="button" className="profile-action" onClick={onShowReports}>
          <span>📊 {t('profile.reports')}</span>
          <span>›</span>
        </button>
      )}

      {onShowAudit && (
        <button type="button" className="profile-action" onClick={onShowAudit}>
          <span>📝 {t('profile.audit')}</span>
          <span>›</span>
        </button>
      )}

      {onShowExport && (
        <button type="button" className="profile-action" onClick={onShowExport}>
          <span>↓ {t('profile.export')}</span>
          <span>›</span>
        </button>
      )}

      {storefrontUrl && (
        <div className="profile-section">
          <div className="section-title">{t('profile.storefront')}</div>
          <div className="mini-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ fontSize: '0.85rem', wordBreak: 'break-all', color: 'var(--ink-muted)' }}>{storefrontUrl}</div>
            <button type="button" className="btn btn-secondary" onClick={copyLink}>
              {copied ? t('profile.copied') : t('profile.copyLink')}
            </button>
          </div>
        </div>
      )}

      {pushSupported && (
        <button type="button" className="profile-action" onClick={onTogglePush} disabled={pushBusy}>
          <span>{pushEnabled ? '🔔' : '🔕'} {t('profile.push')}</span>
          <span>{pushEnabled ? t('profile.pushOn') : t('profile.pushOff')}</span>
        </button>
      )}

      <button type="button" className="profile-action" onClick={onShowInstall}>
        <span>⬇ {t('profile.install')}</span>
        <span>›</span>
      </button>

      <div className="profile-section">
        <button type="button" className="btn btn-secondary btn-block" onClick={onCloseShift}>{t('profile.closeShift')}</button>
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={onLogout}>{t('profile.switchCashier')}</button>
      </div>
    </div>
  );
}
