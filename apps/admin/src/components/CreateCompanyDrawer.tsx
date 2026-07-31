import { useState } from 'react';
import type { LocationType, ModuleKey, SupportLevel } from '../types';
import { MODULE_LABELS, SUPPORT_LABELS } from '../types';
import { newValidUntil, formatDate } from '../utils';
import type { DurationPreset } from '../utils';
import { DURATION_LABELS } from '../utils';
import type { CreateCompanyPayload } from '../api';

interface Props {
  onClose: () => void;
  onCreate: (payload: CreateCompanyPayload) => Promise<void>;
}

const LOCATION_TYPES: LocationType[] = ['shop', 'warehouse', 'pharmacy', 'supply', 'restaurant'];
const ALL_MODULES: ModuleKey[] = ['shop', 'warehouse', 'pharmacy', 'supply', 'terminal', 'restaurant', 'retail'];
const ALL_DURATIONS: DurationPreset[] = ['1m', '3m', '6m', '1y'];

function parseLimit(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function CreateCompanyDrawer({ onClose, onCreate }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('shop');
  const [locationAddress, setLocationAddress] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');

  const [modules, setModules] = useState<ModuleKey[]>(['shop']);
  const [locationLimit, setLocationLimit] = useState('');
  const [userLimit, setUserLimit] = useState('');
  const [skuLimit, setSkuLimit] = useState('');
  const [supportLevel, setSupportLevel] = useState<SupportLevel>('basic');
  const [duration, setDuration] = useState<DurationPreset>('1m');
  const [notes, setNotes] = useState('');

  const step1Valid = name.trim() !== '' && phone.trim() !== '' && locationName.trim() !== '' && ownerName.trim() !== '';

  function toggleModule(m: ModuleKey) {
    setModules((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        phone: phone.trim(),
        location: { name: locationName.trim(), type: locationType, address: locationAddress.trim() },
        owner: { name: ownerName.trim(), phone: ownerPhone.trim() },
        tariff: {
          modules,
          locationLimit: parseLimit(locationLimit),
          userLimit: parseLimit(userLimit),
          skuLimit: parseLimit(skuLimit),
          supportLevel,
          validUntil: newValidUntil(duration),
          notes: notes.trim(),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать компанию');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="content-title">Новая компания</div>
            <div className="steps">
              <span className={step === 1 ? 'step active' : 'step'}>1. Контакты</span>
              <span>→</span>
              <span className={step === 2 ? 'step active' : 'step'}>2. Тариф</span>
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="drawer-body">
          {step === 1 && (
            <>
              <div className="field">
                <label htmlFor="name">Название / контакт</label>
                <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Магазин «Название» или имя владельца" />
              </div>
              <div className="field">
                <label htmlFor="phone">Телефон</label>
                <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 700 000 00 00" />
              </div>

              <div className="section-title">Первая точка</div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="locName">Название точки</label>
                  <input id="locName" type="text" value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="Магазин на Абая" />
                </div>
                <div className="field">
                  <label htmlFor="locType">Тип</label>
                  <select id="locType" value={locationType} onChange={(e) => setLocationType(e.target.value as LocationType)}>
                    {LOCATION_TYPES.map((m) => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="locAddr">Адрес</label>
                <input id="locAddr" type="text" value={locationAddress} onChange={(e) => setLocationAddress(e.target.value)} placeholder="Город, улица, дом" />
              </div>

              <div className="section-title">Первый пользователь (владелец)</div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="ownerName">Имя</label>
                  <input id="ownerName" type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Имя Фамилия" />
                </div>
                <div className="field">
                  <label htmlFor="ownerPhone">Телефон</label>
                  <input id="ownerPhone" type="tel" value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+7 700 000 00 00" />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="field">
                <label>Модули</label>
                <div className="module-toggles">
                  {ALL_MODULES.map((m) => (
                    <button type="button" key={m} className={modules.includes(m) ? 'module-toggle on' : 'module-toggle'} onClick={() => toggleModule(m)}>
                      {MODULE_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="locLimit">Лимит точек</label>
                  <input id="locLimit" type="number" min="0" value={locationLimit} onChange={(e) => setLocationLimit(e.target.value)} placeholder="Без ограничений" />
                </div>
                <div className="field">
                  <label htmlFor="userLimit">Лимит пользователей</label>
                  <input id="userLimit" type="number" min="0" value={userLimit} onChange={(e) => setUserLimit(e.target.value)} placeholder="Без ограничений" />
                </div>
                <div className="field">
                  <label htmlFor="skuLimit">Лимит SKU</label>
                  <input id="skuLimit" type="number" min="0" value={skuLimit} onChange={(e) => setSkuLimit(e.target.value)} placeholder="Без ограничений" />
                </div>
              </div>

              <div className="field">
                <label htmlFor="support">Уровень поддержки</label>
                <select id="support" value={supportLevel} onChange={(e) => setSupportLevel(e.target.value as SupportLevel)}>
                  {(Object.keys(SUPPORT_LABELS) as SupportLevel[]).map((k) => <option key={k} value={k}>{SUPPORT_LABELS[k]}</option>)}
                </select>
              </div>

              <div className="field">
                <label>Срок тарифа</label>
                <div className="module-toggles">
                  {ALL_DURATIONS.map((d) => (
                    <button type="button" key={d} className={duration === d ? 'module-toggle on' : 'module-toggle'} onClick={() => setDuration(d)}>
                      {DURATION_LABELS[d]}
                    </button>
                  ))}
                </div>
                <div className="module-note-inline">Действует до {formatDate(newValidUntil(duration))}</div>
              </div>

              <div className="field">
                <label htmlFor="notes">Индивидуальные условия</label>
                <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Договорённости вне стандартной сетки" />
              </div>

              {error && <div className="login-error">{error}</div>}
            </>
          )}
        </div>

        <div className="drawer-footer">
          {step === 2 && <button className="btn btn-secondary" onClick={() => setStep(1)}>Назад</button>}
          {step === 1 && <button className="btn btn-primary" disabled={!step1Valid} onClick={() => setStep(2)}>Далее</button>}
          {step === 2 && <button className="btn btn-primary" disabled={submitting} onClick={handleSubmit}>{submitting ? 'Создаём…' : 'Создать компанию'}</button>}
        </div>
      </div>
    </div>
  );
}
