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

const PRIORITY_SUPPORT = 19900;

function waLink(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

interface CalcConfig {
  locations: number;
  users: number;
  supplyEnabled: boolean;
  warehouses: number;
  prioritySupport: boolean;
}

// Warehouses only matter once Supply is on — ignore it otherwise so
// e.g. leftover warehouse count from a prior toggle doesn't block a match.
function configsMatch(a: CalcConfig, b: CalcConfig): boolean {
  return (
    a.locations === b.locations &&
    a.users === b.users &&
    a.supplyEnabled === b.supplyEnabled &&
    (!a.supplyEnabled || a.warehouses === b.warehouses) &&
    a.prioritySupport === b.prioritySupport
  );
}

// Fixed-price cards for the visitor who wants to scan prices in five seconds
// instead of operating the calculator below — same underlying economics,
// just pre-computed at the configurations most businesses actually land on.
// Each card's "Настроить" button pushes this config into the calculator
// below and scrolls to it, so a tier is a starting point you can then
// adjust rather than a dead end.
const TIERS: {
  key: string;
  name: string;
  tag: string;
  price: number;
  priceNote: string | null;
  desc: string;
  features: string[];
  badge: string | null;
  message: string;
  config: CalcConfig;
}[] = [
  {
    key: 'start',
    name: 'Старт',
    tag: '1 точка',
    price: CORE_BASE,
    priceNote: null,
    desc: 'Всё для одной точки продаж — касса, склад, отчёты и все отраслевые модули без доплат.',
    features: ['1 точка, до 3 пользователей', 'Товары без лимита', 'Офлайн-режим и живые остатки', 'Рецепты, лояльность, FEFO, весовой товар'],
    badge: null,
    message: `Здравствуйте! Хочу подключить тариф «Старт» ANYQ — ${formatMoney(CORE_BASE)}/мес.`,
    config: { locations: 1, users: 3, supplyEnabled: false, warehouses: 1, prioritySupport: false },
  },
  {
    key: 'standard',
    name: 'Стандарт',
    tag: '1 точка',
    price: CORE_BASE + PRIORITY_SUPPORT,
    priceNote: null,
    desc: 'Всё из «Старт» плюс приоритетная поддержка — быстрее реакция и отдельный чат с командой.',
    features: ['Всё из тарифа «Старт»', 'Приоритетная поддержка', 'Быстрая реакция на вопросы', 'Помощь с настройкой'],
    badge: 'Популярный выбор',
    message: `Здравствуйте! Хочу подключить тариф «Стандарт» ANYQ — ${formatMoney(CORE_BASE + PRIORITY_SUPPORT)}/мес (с приоритетной поддержкой).`,
    config: { locations: 1, users: 3, supplyEnabled: false, warehouses: 1, prioritySupport: true },
  },
  {
    key: 'network',
    name: 'Сеть',
    tag: '2+ точки',
    price: CORE_BASE + CORE_EXTRA_LOCATION + CORE_EXTRA_USER * 2 + PRIORITY_SUPPORT,
    priceNote: 'от',
    desc: 'Для сети из нескольких точек. Пример ниже — на 2 точки и 5 пользователей, точный расчёт под вашу сеть — в калькуляторе.',
    features: ['Несколько точек продаж', 'Перемещения между точками', 'Сводные отчёты по сети', 'Приоритетная поддержка'],
    badge: null,
    message: 'Здравствуйте! У меня сеть из нескольких точек, хочу подключить ANYQ — посчитайте точный тариф под мою конфигурацию.',
    config: { locations: 2, users: 5, supplyEnabled: false, warehouses: 1, prioritySupport: true },
  },
  {
    key: 'enterprise',
    name: 'Индивидуально',
    tag: 'HoReCa и крупный бизнес',
    price: CORE_BASE + SUPPLY_FIRST_WAREHOUSE,
    priceNote: 'от',
    desc: 'HoReCa-поставщикам и крупным сетям — модуль Supply (B2B-витрина заказов) и личный менеджер.',
    features: ['Публичная витрина заказов Supply', 'Push-уведомления о заказах', 'Личный менеджер', 'Индивидуальные условия'],
    badge: null,
    message: 'Здравствуйте! Хочу обсудить индивидуальный тариф ANYQ (Supply / крупная сеть) — подскажите точный расчёт.',
    config: { locations: 1, users: 3, supplyEnabled: true, warehouses: 1, prioritySupport: false },
  },
];

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
  const [prioritySupport, setPrioritySupport] = useState(false);

  function applyTier(t: (typeof TIERS)[number]) {
    setLocations(t.config.locations);
    setUsers(t.config.users);
    setSupplyEnabled(t.config.supplyEnabled);
    setWarehouses(t.config.warehouses);
    setPrioritySupport(t.config.prioritySupport);
    document.getElementById('calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const activeTier = useMemo(
    () => TIERS.find((t) => configsMatch(t.config, { locations, users, supplyEnabled, warehouses, prioritySupport })) ?? null,
    [locations, users, supplyEnabled, warehouses, prioritySupport],
  );

  const calc = useMemo(() => {
    const extraLocations = Math.max(0, locations - CORE_INCLUDED_LOCATIONS);
    const extraUsers = Math.max(0, users - CORE_INCLUDED_USERS);
    const coreTotal = CORE_BASE + extraLocations * CORE_EXTRA_LOCATION + extraUsers * CORE_EXTRA_USER;
    const supplyTotal = supplyEnabled ? SUPPLY_FIRST_WAREHOUSE + Math.max(0, warehouses - 1) * SUPPLY_EXTRA_WAREHOUSE : 0;
    const supportTotal = prioritySupport ? PRIORITY_SUPPORT : 0;
    const total = coreTotal + supplyTotal + supportTotal;
    return { coreTotal, supplyTotal, total };
  }, [locations, users, supplyEnabled, warehouses, prioritySupport]);

  const calcMessage = [
    'Здравствуйте! Собрал(а) тариф ANYQ на сайте, хочу подключить:',
    `— Точки: ${locations}, пользователи: ${users} — ${formatMoney(calc.coreTotal)}/мес`,
    supplyEnabled ? `— Supply: ${warehouses} склад(ов) — ${formatMoney(calc.supplyTotal)}/мес` : null,
    prioritySupport ? `— Приоритетная поддержка — +${formatMoney(PRIORITY_SUPPORT)}/мес` : null,
    `Итого: ${formatMoney(calc.total)}/мес`,
  ]
    .filter(Boolean)
    .join('\n');
  const calcWaUrl = waLink(calcMessage);

  return (
    <section id="pricing" className="section section-alt">
      <div className="section-inner">
        <div className="section-head">
          <span className="section-eyebrow">Тарифы</span>
          <h2 className="section-heading">Прозрачные цены — без скрытых доплат</h2>
          <p className="section-sub">
            Четыре готовых варианта ниже покрывают большинство сценариев. Нужна нестандартная
            конфигурация — соберите точный тариф в калькуляторе под ним.
          </p>
        </div>

        <div className="tier-grid">
          {TIERS.map((t) => (
            <div className={`tier-card${t.badge ? ' popular' : ''}${activeTier?.key === t.key ? ' selected' : ''}`} key={t.key}>
              {t.badge && <span className="tier-badge">{t.badge}</span>}
              <div className="tier-name">{t.name}</div>
              <div className="tier-tag">{t.tag}</div>
              <div className="tier-price">
                {t.priceNote && <span className="tier-price-note">{t.priceNote}</span>}
                {formatMoney(t.price)}
                <span className="tier-price-period">/мес</span>
              </div>
              <p className="tier-desc">{t.desc}</p>
              <ul className="tier-features">
                {t.features.map((f) => (
                  <li key={f}>
                    <IconCheck className="icon-14" /> {f}
                  </li>
                ))}
              </ul>
              <div className="tier-actions">
                <a
                  className={`btn ${t.badge ? 'btn-primary' : 'btn-secondary'} btn-block tier-cta`}
                  href={waLink(t.message)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Написать в WhatsApp
                </a>
                <button type="button" className="tier-customize" onClick={() => applyTier(t)}>
                  {activeTier?.key === t.key ? <IconCheck className="icon-14" /> : null}
                  {activeTier?.key === t.key ? 'Настроено в калькуляторе' : 'Настроить тариф'}
                  {activeTier?.key !== t.key && <IconArrowRight className="icon-14" />}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="pricing-divider">
          <span>Или соберите точный тариф вручную</span>
        </div>

        <div className="calc-card calc-card-standalone" id="calculator">
          <div className="calc-card-title">Калькулятор тарифа</div>
          <p className="calc-card-hint">
            {activeTier
              ? `Настроено под тариф «${activeTier.name}» — можно менять точки, пользователей и модули ниже.`
              : 'Меняйте точки, пользователей и модули — сумма и сообщение в WhatsApp пересчитаются сами.'}
          </p>

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
            <input type="checkbox" checked={supplyEnabled} onChange={(e) => setSupplyEnabled(e.target.checked)} />
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

          <label className="calc-toggle-row">
            <span>
              <span className="calc-row-label">Приоритетная поддержка</span>
              <span className="calc-row-hint">Быстрая реакция и отдельный чат с командой</span>
            </span>
            <input type="checkbox" checked={prioritySupport} onChange={(e) => setPrioritySupport(e.target.checked)} />
          </label>

          <div className="calc-total-row">
            <span>Итого</span>
            <span className="calc-total-value">{formatMoney(calc.total)}/мес</span>
          </div>

          <a className="btn btn-primary btn-block calc-cta" href={calcWaUrl} target="_blank" rel="noopener noreferrer">
            <span className="btn-icon-row">
              <WhatsAppIcon />
              Написать в WhatsApp — {formatMoney(calc.total)}/мес
            </span>
          </a>

          <p className="calc-footnote">
            Есть личный менеджер и индивидуальные условия для крупных сетей — <IconArrowRight className="icon-14" /> напишите нам, обсудим.
          </p>
        </div>
      </div>
    </section>
  );
}
