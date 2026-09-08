import { useTranslation } from '../i18n/useLanguage';

interface Props {
  platform: 'ios' | 'other';
  visible: boolean;
  canInstallDirectly: boolean;
  install: () => void;
  dismiss: () => void;
}

export function InstallPrompt({ platform, visible, canInstallDirectly, install, dismiss }: Props) {
  const { t } = useTranslation();
  if (!visible) return null;

  return (
    <div className="install-banner" role="dialog" aria-label={t('install.dialog')}>
      <div className="install-banner-head">
        <span className="install-banner-title">{t('install.title')}</span>
        <button className="icon-btn" onClick={dismiss} aria-label={t('install.close')}>✕</button>
      </div>

      {platform === 'ios' ? (
        <>
          <p>{t('install.why')}</p>
          <ol className="install-steps">
            <li><span className="share-glyph">⬆︎</span> {t('install.iosShare')}</li>
            <li>{t('install.iosScroll')}</li>
            <li>{t('install.iosConfirm')}</li>
          </ol>
        </>
      ) : canInstallDirectly ? (
        <>
          <p>{t('install.offlineWhy')}</p>
          <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={install}>{t('install.button')}</button>
        </>
      ) : (
        <p>{t('install.manual')}</p>
      )}
    </div>
  );
}
