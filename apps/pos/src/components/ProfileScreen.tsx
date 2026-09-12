import { useState } from 'react';
import { Icon } from './Icon';
import { LANGUAGES } from '../i18n';
import type { PhraseKey } from '../i18n';
import { useTranslation } from '../i18n/useLanguage';
import type { Sale, Shift } from '../types';
import { formatMoney, formatTime, hoursSince } from '../utils';

interface Props {
  cashierName: string;
  role: string;
  shift: Shift;
  online: boolean;
  /** 'unavailable' when the service worker did not register. See offline.ts. */
  offlineReadiness: 'unknown' | 'ready' | 'unavailable';
  pendingCount: number;
  /** Продажи, которые сервер отказался принять, с его же объяснением почему. */
  stuckSales: Sale[];
  onRetryStuck: (id: string) => void;
  /** Отправить заново все отказанные разом — когда причина у них общая. */
  onRetryAllStuck: () => void;
  /**
   * Смены, которые закрыли на кассе, а на сервере закрыть не дали.
   *
   * У владельца такая смена висит открытой и без пересчитанной наличности:
   * сверка за этот день не посчитается, пока это не разберут.
   */
  refusedCloses: Shift[];
  storefrontUrl: string | null;
  pushSupported: boolean;
  pushEnabled: boolean;
  pushBusy: boolean;
  /** Почему уведомления не включились — рядом с переключателем, а не в консоли. */
  pushMessage?: string | null;
  onTogglePush: () => void;
  onShowDashboard?: () => void;
  onShowReports?: () => void;
  /** Owner-facing: somebody who can read who changed what can also work out
      whose account to use. */
  onShowAudit?: () => void;
  onShowDevices?: () => void;
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
  offlineReadiness,
  pendingCount,
  stuckSales,
  onRetryStuck,
  onRetryAllStuck,
  refusedCloses,
  storefrontUrl,
  pushSupported,
  pushEnabled,
  pushBusy,
  pushMessage,
  onTogglePush,
  onShowDashboard,
  onShowReports,
  onShowAudit,
  onShowDevices,
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

      {/* Said where somebody will read it before a bad morning, not in a log
          nobody opens. Without the worker the till cannot be opened at all
          without a network, which is the opposite of what it promises. */}
      {offlineReadiness === 'unavailable' && (
        <div className="mini-card" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <strong>{t('profile.offlineBroken')}</strong>
          <span className="field-hint">{t('profile.offlineBrokenWhy')}</span>
        </div>
      )}
      {/* Не число, а сами продажи: какая, на сколько и что ответил сервер.
          «1 требует внимания» — это просьба к кассиру догадаться, какой из
          сегодняшних чеков не прошёл, и к владельцу — поверить на слово. А
          причина всё это время лежала рядом, в той же записи. */}
      {refusedCloses.length > 0 && (
        <div className="profile-section">
          <div className="section-title">⚠ {t('profile.closeRefused')}</div>
          {refusedCloses.map((closed) => (
            <div key={closed.id} className="mini-card" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <strong>{t('profile.closeRefusedShift', { time: formatTime(closed.openedAt) })}</strong>
              <span className="field-hint">{closed.closeError}</span>
            </div>
          ))}
        </div>
      )}

      {stuckSales.length > 0 && (
        <div className="profile-section">
          <div className="section-title">⚠ {t('profile.needAttention')}</div>
          <div className="field-hint" style={{ marginBottom: 8 }}>{t('profile.stuckWhy')}</div>
          {/* Одна кнопка на всех — когда чеков за офлайн-утро тридцать, а
              причина у них одна. */}
          {stuckSales.length > 1 && (
            <button className="btn btn-secondary btn-block" style={{ marginBottom: 12 }} onClick={onRetryAllStuck}>
              {t('profile.stuckRetryAll', { count: stuckSales.length })}
            </button>
          )}
          {stuckSales.map((sale) => (
            <div key={sale.id} className="mini-card" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <strong>
                {formatTime(sale.createdAt)} · {formatMoney(sale.total)}
              </strong>
              <span className="field-hint">{sale.syncError}</span>
              <button className="btn btn-secondary" style={{ marginTop: 4 }} onClick={() => onRetryStuck(sale.id)}>
                {t('profile.stuckRetry')}
              </button>
            </div>
          ))}
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
          <span className="profile-action-label"><Icon name="summary" /> {t('profile.dashboard')}</span>
          <span>›</span>
        </button>
      )}

      {onShowReports && (
        <button type="button" className="profile-action" onClick={onShowReports}>
          <span className="profile-action-label"><Icon name="chart" /> {t('profile.reports')}</span>
          <span>›</span>
        </button>
      )}

      {onShowAudit && (
        <button type="button" className="profile-action" onClick={onShowAudit}>
          <span className="profile-action-label"><Icon name="journal" /> {t('profile.audit')}</span>
          <span>›</span>
        </button>
      )}

      {onShowExport && (
        <button type="button" className="profile-action" onClick={onShowExport}>
          <span className="profile-action-label"><Icon name="export" /> {t('profile.export')}</span>
          <span>›</span>
        </button>
      )}

      {onShowDevices && (
        <button type="button" className="profile-action" onClick={onShowDevices}>
          <span className="profile-action-label"><Icon name="devices" /> {t('profile.devices')}</span>
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
        <>
          <button type="button" className="profile-action" onClick={onTogglePush} disabled={pushBusy}>
            <span className="profile-action-label"><Icon name={pushEnabled ? 'bellOn' : 'bellOff'} /> {t('profile.push')}</span>
            <span>{pushEnabled ? t('profile.pushOn') : t('profile.pushOff')}</span>
          </button>
          {pushMessage && <div className="field-hint">{pushMessage}</div>}
        </>
      )}

      <button type="button" className="profile-action" onClick={onShowInstall}>
        <span className="profile-action-label"><Icon name="install" /> {t('profile.install')}</span>
        <span>›</span>
      </button>

      <div className="profile-section">
        <button type="button" className="btn btn-secondary btn-block" onClick={onCloseShift}>{t('profile.closeShift')}</button>
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={onLogout}>{t('profile.switchCashier')}</button>
      </div>
    </div>
  );
}
