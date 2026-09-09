import { useState } from 'react';
import type { CabinetInfo } from '../types';
import { ORDERS_BASE } from '../api';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  info: CabinetInfo | null;
  loading: boolean;
  error: string | null;
  resetting: boolean;
  onBack: () => void;
  onReset: () => void;
}

/**
 * Ссылка на кабинет владельца — выдаётся здесь и больше нигде.
 *
 * Адрес собирает касса, а не сервер: домен витрины касса знает из своей
 * сборки, а сервер не знает и знать не обязан. Если переменная не задана,
 * ссылка не показывается вовсе — лучше вопрос «а где ссылка», чем адрес,
 * ведущий в никуда, который владелец успеет кому-нибудь переслать.
 */
export function CabinetLinkScreen({ info, loading, error, resetting, onBack, onReset }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const link = info && ORDERS_BASE ? `${ORDERS_BASE.replace(/\/+$/, '')}/k/${info.secret}` : null;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер обмена закрыт настройками браузера. Ссылка на экране целиком —
      // её можно выделить руками, и это не повод показывать ошибку.
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('cabinet.title')}</span>
      </div>

      <div className="screen-body">
        <p className="field-hint">{t('cabinet.what')}</p>

        {loading && <p className="field-hint">{t('common.loading')}</p>}
        {error && <div className="login-error">{error}</div>}

        {info && !link && <div className="login-error">{t('cabinet.noOrdersUrl')}</div>}

        {link && info && (
          <>
            <div className="cabinet-link">{link}</div>
            <button className="btn btn-primary btn-block" onClick={copy}>
              {copied ? t('cabinet.copied') : t('cabinet.copy')}
            </button>

            <div className="orders-section-title">{t('cabinet.state')}</div>
            <div className="report-row">
              <span>{t('cabinet.password')}</span>
              <span className={info.hasPassword ? 'pill' : 'pill warn'}>
                {info.hasPassword ? t('cabinet.passwordSet') : t('cabinet.passwordNotSet')}
              </span>
            </div>
            <div className="report-row">
              <span>{t('cabinet.lastLogin')}</span>
              <span>{info.lastLoginAt ? new Date(info.lastLoginAt).toLocaleString('ru-RU') : t('cabinet.never')}</span>
            </div>

            <p className="field-hint">{t('cabinet.howToGive')}</p>

            <div className="orders-section-title">{t('cabinet.resetTitle')}</div>
            <p className="field-hint">{t('cabinet.resetWhy')}</p>
            {confirming ? (
              <>
                <div className="login-error">{t('cabinet.resetConfirm')}</div>
                <button className="btn btn-danger btn-block" onClick={onReset} disabled={resetting}>
                  {resetting ? t('common.saving') : t('cabinet.resetDo')}
                </button>
                <button className="btn btn-secondary btn-block" onClick={() => setConfirming(false)}>
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <button className="btn btn-secondary btn-block" onClick={() => setConfirming(true)}>
                {t('cabinet.reset')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
