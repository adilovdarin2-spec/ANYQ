import { useState } from 'react';
import type { PosDevice } from '../api';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  devices: PosDevice[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onRename: (id: string, label: string) => void;
  onRevoke: (id: string) => void;
  onRestore: (id: string) => void;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * The registers signed in to this shop, and the switch that turns one off.
 *
 * The screen somebody opens with a shaking hand because a tablet is gone. Two
 * things follow from that. The rows have to be recognisable — a name, who used
 * it last, when it was last seen — because a list of four identical cuids is a
 * list nobody dares act on. And the register being held has to be marked and
 * refused, because switching that one off logs the person out of this screen.
 */
export function DevicesScreen({
  devices,
  loading,
  error,
  submitting,
  onBack,
  onRefresh,
  onRename,
  onRevoke,
  onRestore,
}: Props) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  function startRename(device: PosDevice) {
    setRenaming(device.id);
    setDraft(device.label);
  }

  function commitRename(id: string) {
    const label = draft.trim();
    if (label !== '') onRename(id, label);
    setRenaming(null);
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('devices.title')}</span>
        <button className="icon-btn" onClick={onRefresh} aria-label={t('common.refreshShort')} style={{ marginLeft: 'auto' }}>⟳</button>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}

        <p className="field-hint">{t('devices.why')}</p>

        {loading && devices.length === 0 && <div className="empty-state">{t('common.loading')}</div>}
        {!loading && devices.length === 0 && !error && <div className="empty-state">{t('devices.none')}</div>}

        {devices.map((device) => (
          <div key={device.id} className={device.revokedAt ? 'report-row low' : 'report-row'}>
            <span style={{ flex: 1 }}>
              {renaming === device.id ? (
                <span className="transfer-add-row">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t('devices.namePlaceholder')}
                    autoFocus
                  />
                  <button className="btn btn-primary" disabled={submitting} onClick={() => commitRename(device.id)}>
                    {t('common.save')}
                  </button>
                </span>
              ) : (
                <>
                  <strong>{device.label}</strong>
                  {device.current && <span className="chip-status confirmed" style={{ marginLeft: 8 }}>{t('devices.thisOne')}</span>}
                  <br />
                  <span className="order-meta">
                    {device.lastUserName
                      ? t('devices.lastUsed', { name: device.lastUserName, when: formatWhen(device.lastSeenAt) })
                      : t('devices.lastSeen', { when: formatWhen(device.lastSeenAt) })}
                  </span>
                  {device.revokedAt && (
                    <>
                      <br />
                      <span className="order-meta">
                        {device.revokedByName
                          ? t('devices.revokedBy', { name: device.revokedByName, when: formatWhen(device.revokedAt) })
                          : t('devices.revokedAt', { when: formatWhen(device.revokedAt) })}
                      </span>
                    </>
                  )}
                </>
              )}
            </span>

            {renaming !== device.id && (
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-secondary" disabled={submitting} onClick={() => startRename(device)}>
                  {t('devices.rename')}
                </button>
                {device.revokedAt ? (
                  <button className="btn btn-secondary" disabled={submitting} onClick={() => onRestore(device.id)}>
                    {t('devices.restore')}
                  </button>
                ) : device.current ? (
                  // Not hidden — shown and disabled, so the absence of a button
                  // is explained rather than looking like a bug.
                  <button className="btn btn-secondary" disabled title={t('devices.cannotRevokeSelf')}>
                    {t('devices.revoke')}
                  </button>
                ) : confirming === device.id ? (
                  <>
                    <button className="btn btn-secondary" onClick={() => setConfirming(null)}>{t('common.cancel')}</button>
                    <button
                      className="btn btn-primary"
                      disabled={submitting}
                      onClick={() => {
                        onRevoke(device.id);
                        setConfirming(null);
                      }}
                    >
                      {t('devices.confirmRevoke')}
                    </button>
                  </>
                ) : (
                  // Asked twice. Cutting off the wrong register in a shop with
                  // four of them stops a till mid-sale.
                  <button className="btn btn-secondary" disabled={submitting} onClick={() => setConfirming(device.id)}>
                    {t('devices.revoke')}
                  </button>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
