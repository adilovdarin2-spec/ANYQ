import { useMemo, useState } from 'react';
import { WHATSAPP_NUMBER } from '../api';
import { formatMoney } from '../utils';
import { IconArrowRight, IconCheck, WhatsAppIcon } from './Icons';

const CORE_BASE = 59900;
const CORE_INCLUDED_LOCATIONS = 1;
const CORE_INCLUDED_USERS = 3;
const CORE_EXTRA_LOCATION = 24900;
const CORE_EXTRA_USER = 4900;

const SUPPLY_FIRST_WAREHOUSE = 99900;
const SUPPLY_EXTRA_WAREHOUSE = 34900;

const SUPPORT_TIERS = [
  { key: 'basic', label: 'Базовая', price: 0, sub: 'включено', badge: null },
  { key: 'priority', label: 'Приоритетная', price: 19900, sub: `+${formatMoney(19900)}/мес`, badge: 'Популярный выбор' },
  { key: 'dedicated', label: 'Личный менеджер', price: 49900, sub: `от ${formatMoney(49900)}/мес`, badge: null },
] as const;

type SupportKey = (typeof SUPPORT_TIERS)[number]['key'];

interface StepperProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  onIncrement: () => void;
  onDecrement: () => void;
}

function Stepper({ label, hint, value, min, onIncrement, onDecrement }: StepperProps) {
  return (
    <div className="calc-row">
      <div>
        <div className="calc-row-label">{label}</div>
        {hint && <div className="calc-row-hint">{hint}</div>}
      </div>
      <div className="qty-stepper">
        <button type="button" onClick={onDecrement} disabled={value <= min}>
          −
        </button>
        <span>{value}</span>
        <button type="button" onClick={onIncrement}>
          +
        </button>
      </div>
    </div>
  );
}

export function PricingScreen() {
  const [locations, setLocations] = useState(1);
  const [users, setUsers] = useState(3);
  const [supplyEnabled, setSupplyEnabled] = useState(false);
  const [warehouses, setWarehouses] = useState(1);
  const [support, setSupport] = useState<SupportKey>('basic');

  const calc = useMemo(() => {
    const extraLocations = Math.max(0, locations - CORE_INCLUDED_LOCATIONS);
    const extraUsers = Math.max(0, users - CORE_INCLUDED_USERS);
    const coreTotal = CORE_BASE + extraLocations * CORE_EXTRA_LOCATION + extraUsers * CORE_EXTRA_USER;
    const supplyTotal = supplyEnabled ? SUPPLY_FIRST_WAREHOUSE + Math.max(0, warehouses - 1) * SUPPLY_EXTRA_WAREHOUSE : 0;
    const supportTier = SUPPORT_TIERS.find((t) => t.key === support)!;
    const total = coreTotal + supplyTotal + supportTier.price;
    return { coreTotal, supplyTotal, supportTier, total };
  }, [locations, users, supplyEnabled, warehouses, support]);

  const message = [
    'Здравствуйте! Собрал(а) тариф ANYQ на сайте, хочу подключить:',
    `— Core: ${locations} точка(и), ${users} пользователь(ей) — ${formatMoney(calc.coreTotal)}/мес`,
    supplyEnabled ? `— Supply: ${warehouses} склад(ов) — ${formatMoney(calc.supplyTotal)}/мес` : null,
    `— Поддержка: ${calc.supportTier.label}`,
    `Итого: ${formatMoney(calc.total)}/мес`,
  ]
    .filter(Boolean)
    .join('\n');
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

  function toggleSupply() {
    setSupplyEnabled((v) => !v);
  }

  return (
    <section id="pricing" className="section section-alt">
      <div className="section-inner">
        <div className="section-head">
          <span className="section-eyebrow">Тарифы</span>
          <h2 className="section-heading">Соберите тариф под свой бизнес</h2>
          <p className="section-sub">
            Платите за точки, пользователей и модули, которыми реально пользуетесь — без переплаты
            за лишний функционал.
          </p>
        </div>

        <div className="pricing-layout">
          <div className="calc-card">
            <div className="calc-card-title">Калькулятор тарифа</div>

            <Stepper
              label="Точки продаж"
              hint="1 точка включена в базовый пакет"
              value={locations}
              min={1}
              onIncrement={() => setLocations((v) => v + 1)}
              onDecrement={() => setLocations((v) => Math.max(1, v - 1))}
            />
            <Stepper
              label="Пользователи"
              hint="3 пользователя включены в базовый пакет"
              value={users}
              min={3}
              onIncrement={() => setUsers((v) => v + 1)}
              onDecrement={() => setUsers((v) => Math.max(3, v - 1))}
            />

            <label className="calc-toggle-row">
              <span>
                <span className="calc-row-label">Модуль Supply</span>
                <span className="calc-row-hint">B2B-витрина для HoReCa-поставщиков и складов</span>
              </span>
              <input type="checkbox" checked={supplyEnabled} onChange={toggleSupply} />
            </label>

            {supplyEnabled && (
              <Stepper
                label="Склады с витриной"
                value={warehouses}
                min={1}
                onIncrement={() => setWarehouses((v) => v + 1)}
                onDecrement={() => setWarehouses((v) => Math.max(1, v - 1))}
              />
            )}

            <div className="calc-row-label" style={{ margin: '18px 0 10px' }}>
              Уровень поддержки
            </div>
            <div className="support-options">
              {SUPPORT_TIERS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`support-option${support === t.key ? ' on' : ''}${t.badge ? ' has-badge' : ''}`}
                  onClick={() => setSupport(t.key)}
                >
                  {t.badge && <span className="support-option-badge">{t.badge}</span>}
                  <span className="support-option-label">{t.label}</span>
                  <span className="support-option-sub">{t.sub}</span>
                </button>
              ))}
            </div>

            <div className="calc-total-row">
              <span>Итого</span>
              <span className="calc-total-value">{formatMoney(calc.total)}/мес</span>
            </div>

            <a className="btn btn-primary btn-block calc-cta" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <span className="btn-icon-row">
                <WhatsAppIcon />
                Написать в WhatsApp — {formatMoney(calc.total)}/мес
              </span>
            </a>
          </div>

          <div className="pricing-layout-side">
            <div className="pricing-plan pricing-plan-static">
              <div className="pricing-plan-header">
                <span className="pricing-plan-name">Core</span>
                <span className="pricing-plan-tag">касса и склад</span>
              </div>
              <p className="pricing-plan-desc">
                PWA-касса, остатки по точкам, смены со сверкой кассы, офлайн-режим с очередью
                синхронизации. Для магазина, склада, аптеки, кафе или ресторана.
              </p>
              <ul className="pricing-feature-list">
                <li>Базовый пакет — {formatMoney(CORE_BASE)}/мес (1 точка, 3 пользователя, товары без лимита)</li>
                <li>Каждая доп. точка — +{formatMoney(CORE_EXTRA_LOCATION)}/мес</li>
                <li>Каждый пользователь сверх включённых — +{formatMoney(CORE_EXTRA_USER)}/мес</li>
              </ul>
              <div className="pricing-plan-note">
                <IconCheck className="icon-16" /> Входит в любой тариф ANYQ
              </div>
            </div>

            <button
              type="button"
              className={`pricing-plan pricing-plan-addon pricing-plan-toggle${supplyEnabled ? ' on' : ''}`}
              onClick={toggleSupply}
              aria-pressed={supplyEnabled}
            >
              <div className="pricing-plan-header">
                <span className="pricing-plan-name">Supply</span>
                <span className="pricing-plan-tag">надстройка к Core</span>
              </div>
              <p className="pricing-plan-desc">
                Публичный сайт заказов со своим адресом, push-уведомление в момент заказа,
                PWA-приложение, списание товара по факту выдачи — дешевле отдельного B2B-портала,
                но с полноценной кассой в комплекте.
              </p>
              <ul className="pricing-feature-list">
                <li>Первый склад — {formatMoney(SUPPLY_FIRST_WAREHOUSE)}/мес</li>
                <li>Каждый доп. склад — +{formatMoney(SUPPLY_EXTRA_WAREHOUSE)}/мес</li>
              </ul>
              <div className="pricing-plan-note pricing-plan-cta">
                {supplyEnabled ? (
                  <>
                    <IconCheck className="icon-16" /> Добавлено в расчёт слева
                  </>
                ) : (
                  <>
                    Добавить в расчёт <IconArrowRight className="icon-16" />
                  </>
                )}
              </div>
            </button>

            <div className="pricing-cta">
              <p>Тариф подключается вручную — напишите нам расчёт из калькулятора, обсудим детали под ваш бизнес.</p>
              <a className="btn btn-primary btn-block" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <span className="btn-icon-row">
                  <WhatsAppIcon />
                  Написать в WhatsApp — {formatMoney(calc.total)}/мес
                </span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
