import type { OpenShiftInfo } from '../api';
import { formatDateTime } from '../utils';
import { useTranslation } from '../i18n/useLanguage';

/**
 * Доступ закрыт, а смена осталась открытой.
 *
 * Тариф кончается сам, в полночь, без чьего-либо участия — посреди смены
 * круглосуточного магазина или смены, которую забыли закрыть. Блокировку за
 * неоплату ставим мы, и тоже не глядя на то, стоит ли кто-то за кассой.
 *
 * До 01.10.2026 и то и другое закрывало вход. Смена оставалась открытой
 * навсегда: кассир не входит, выручка дня ни с чем не сверена, а в ящике
 * лежит наличность. Деньги магазина — не рычаг в споре об оплате, и счёт
 * собственной кассы запирать мы не вправе.
 *
 * Поэтому вход остаётся открыт ровно за одним действием. Продать, принять,
 * открыть новую смену нельзя — это отказывается на сервере и без этого
 * экрана; здесь просто не из чего выбрать, кроме закрытия.
 */

interface Props {
  /** Слова сервера: «доступ заблокирован» и «срок истёк» — разные новости. */
  message: string;
  shifts: OpenShiftInfo[];
  loading: boolean;
  onClose: (shift: OpenShiftInfo) => void;
  onLogout: () => void;
}

export function TariffLockedScreen({ message, shifts, loading, onClose, onLogout }: Props) {
  const { t } = useTranslation();

  return (
    <div className="screen">
      <div className="screen-header">
        <span className="screen-title">{t('tariffLock.title')}</span>
      </div>

      <div className="screen-body">
        <div className="login-error">{message}</div>
        {/* Смену могли закрыть прямо здесь — и тогда «смена осталась открытой» становится
            неправдой прямо над строкой «открытых смен больше нет». */}
        {shifts.length > 0 && <p className="field-hint">{t('tariffLock.what')}</p>}

        {loading && shifts.length === 0 && <div className="empty-state">{t('common.loading')}</div>}

        {shifts.map((openShift) => (
          <div key={openShift.id} className="order-card">
            <div className="order-card-head">
              <div>
                <div className="order-customer">{openShift.cashierName}</div>
                <div className="order-meta">{formatDateTime(openShift.openedAt)}</div>
              </div>
            </div>
            <button className="btn btn-primary btn-block" onClick={() => onClose(openShift)}>
              {t('tariffLock.close')}
            </button>
          </div>
        ))}

        {!loading && shifts.length === 0 && (
          /* Смену успели закрыть с другого устройства — тогда здесь делать
             больше нечего, и это надо сказать, а не показывать пустоту. */
          <div className="empty-state">{t('tariffLock.nothingLeft')}</div>
        )}
      </div>

      <div className="screen-footer">
        <button className="btn btn-ghost btn-block" onClick={onLogout}>
          {t('profile.switchCashier')}
        </button>
      </div>
    </div>
  );
}
