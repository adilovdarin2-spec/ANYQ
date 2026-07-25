import { useState } from 'react';

interface Props {
  onOpen: (openingCash: number) => void;
}

export function OpenShiftScreen({ onOpen }: Props) {
  const [cash, setCash] = useState('0');
  const value = Number(cash);
  const valid = Number.isFinite(value) && value >= 0;

  return (
    <div className="pos-shell">
      <div className="form-card">
        <h1>Открыть смену</h1>
        <p className="sub">Без открытой смены продажи не проводятся — это требование кассовой дисциплины.</p>
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
          Открыть смену
        </button>
      </div>
    </div>
  );
}
