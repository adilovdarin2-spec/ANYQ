import { useState } from 'react';
import type { CompanyLocation } from '../types';
import type { OpenShiftInfo } from '../api';
import { formatDateTime } from '../utils';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  locations: CompanyLocation[];
  currentLocationId: string | null;
  switchingLocation: boolean;
  locationError: string | null;
  onSwitchLocation: (locationId: string) => void;
  onOpen: (openingCash: number) => void;
  /**
   * Смены, уже открытые на выбранной точке.
   *
   * Две открытые смены на одной точке — это не поломка: на точке может стоять
   * две кассы. Но чаще это забытая вчерашняя, и тогда деньги одного ящика
   * раскладываются по двум сверкам, а недостача появляется из ниоткуда.
   * Запрещать нельзя — вторая касса обязана торговать; сказать нужно.
   */
  openShifts?: OpenShiftInfo[];
}

export function OpenShiftScreen({
  locations,
  currentLocationId,
  switchingLocation,
  locationError,
  onSwitchLocation,
  onOpen,
  openShifts,
}: Props) {
  const { t } = useTranslation();
  const [cash, setCash] = useState('0');
  const value = Number(cash);
  const valid = Number.isFinite(value) && value >= 0 && !!currentLocationId && !switchingLocation;

  return (
    <div className="pos-shell">
      <div className="form-card">
        <h1>{t('shift.open.title')}</h1>
        <p className="sub">{t('shift.open.why')}</p>

        {/* Only a company with somewhere to choose between sees a choice. The
            point is picked before the shift opens, not during it: the shift,
            its sales and its cash all belong to one location. */}
        {locations.length > 1 && (
          <div className="form-field">
            <label>{t('shift.open.location')}</label>
            <div className="category-bar">
              {locations.map((location) => (
                <button
                  key={location.id}
                  type="button"
                  className={location.id === currentLocationId ? 'category-chip on' : 'category-chip'}
                  disabled={switchingLocation}
                  onClick={() => onSwitchLocation(location.id)}
                >
                  {location.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Перед вводом суммы, а не после: человек должен решить, открывать ли
            вторую смену, до того, как пересчитает ящик под неё. */}
        {openShifts && openShifts.length > 0 && (
          <div className="field-hint" style={{ marginTop: 0 }}>
            {/* Первые две и счёт остальных. Магазин, в котором смены не
                закрывают месяцами, — это как раз тот магазин, ради которого
                предупреждение и написано, и девять одинаковых строк вытолкнули
                бы с экрана саму форму открытия. */}
            {openShifts.slice(0, 2).map((shift) => (
              <p key={shift.id}>
                {t('shift.open.alreadyOpen', {
                  cashier: shift.cashierName,
                  time: formatDateTime(shift.openedAt),
                })}
              </p>
            ))}
            {openShifts.length > 2 && <p>{t('shift.open.alreadyOpenMore', { count: openShifts.length - 2 })}</p>}
            <p>{t('shift.open.alreadyOpenWhy')}</p>
          </div>
        )}

        {locationError && <div className="login-error">{locationError}</div>}
        {locations.length === 0 && <div className="login-error">{t('shift.open.noLocation')}</div>}

        <div className="form-field">
          <label htmlFor="opening-cash">{t('shift.open.cash')}</label>
          <input
            id="opening-cash"
            type="number"
            inputMode="numeric"
            min="0"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={!valid} onClick={() => onOpen(value)}>
          {switchingLocation ? t('shift.open.loading') : t('shift.open.submit')}
        </button>
      </div>
    </div>
  );
}
