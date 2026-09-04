import { useState } from 'react';
import type { CompanyLocation } from '../types';

interface Props {
  locations: CompanyLocation[];
  currentLocationId: string | null;
  switchingLocation: boolean;
  locationError: string | null;
  onSwitchLocation: (locationId: string) => void;
  onOpen: (openingCash: number) => void;
}

export function OpenShiftScreen({
  locations,
  currentLocationId,
  switchingLocation,
  locationError,
  onSwitchLocation,
  onOpen,
}: Props) {
  const [cash, setCash] = useState('0');
  const value = Number(cash);
  const valid = Number.isFinite(value) && value >= 0 && !!currentLocationId && !switchingLocation;

  return (
    <div className="pos-shell">
      <div className="form-card">
        <h1>Открыть смену</h1>
        <p className="sub">Без открытой смены продажи не проводятся — это требование кассовой дисциплины.</p>

        {/* Only a company with somewhere to choose between sees a choice. The
            point is picked before the shift opens, not during it: the shift,
            its sales and its cash all belong to one location. */}
        {locations.length > 1 && (
          <div className="form-field">
            <label>Точка</label>
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

        {locationError && <div className="login-error">{locationError}</div>}
        {locations.length === 0 && <div className="login-error">У компании не настроена точка — обратитесь к владельцу</div>}

        <div className="form-field">
          <label htmlFor="opening-cash">Наличные в кассе на начало смены</label>
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
          {switchingLocation ? 'Загружаем товары точки…' : 'Открыть смену'}
        </button>
      </div>
    </div>
  );
}
