import { useMemo, useState } from 'react';
import { WHATSAPP_NUMBER } from '../api';
import { formatMoney } from '../utils';
import { IconArrowRight, IconCheck, WhatsAppIcon } from './Icons';

/**
 * Единица цены — место, где лежит товар. Никогда — человек.
 *
 * До 15.09.2026 здесь считались пользователи: три включены, дальше по 4 900 за
 * каждого. Магазин с четырьмя кассирами платил за четвёртого — то есть за
 * операционное место, за которое мы сами себе запретили брать деньги. Строка
 * «Пользователи» убрана из калькулятора целиком, а не переименована: цену
 * определяет число мест хранения и набор модулей, и больше ничего.
 *
 * Цифры повторяют docs/PRICING.md. Биллинга в коде нет — это витрина расчёта,
 * поэтому, меняя цены там, меняйте и здесь.
 */
const POINT_BASE = 29900;
const STOCK_BASE = 69900;
const EXTRA_PLACE = 24900;

const REPORTS = 9900;
const BATCHES = 14900;

const SUPPLY_FIRST_WAREHOUSE = 99900;
const SUPPLY_EXTRA_WAREHOUSE = 34900;

const PRIORITY_SUPPORT = 19900;

/** С какого числа мест хранения условия обсуждаются отдельно. */
const NETWORK_PLACES = 6;

function waLink(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

interface CalcConfig {
  /** «Склад» вместо «Точки»: ячейки, перемещения, закупки, производство. */
  warehouse: boolean;
  /** Мест, где лежит товар: точки и склады вместе. */
  places: number;
  reports: boolean;
  batches: boolean;
  supplyEnabled: boolean;
  warehouses: number;
  prioritySupport: boolean;
}

function priceOf(c: CalcConfig): { base: number; supply: number; total: number } {
  const base = c.warehouse ? STOCK_BASE + Math.max(0, c.places - 1) * EXTRA_PLACE : POINT_BASE;
  const addons = (c.reports ? REPORTS : 0) + (c.batches ? BATCHES : 0);
  const supply = c.supplyEnabled ? SUPPLY_FIRST_WAREHOUSE + Math.max(0, c.warehouses - 1) * SUPPLY_EXTRA_WAREHOUSE : 0;
  const support = c.prioritySupport ? PRIORITY_SUPPORT : 0;
  return { base, supply, total: base + addons + supply + support };
}

// Мест больше одного бывает только у «Склада», складов с витриной — только у
// витрины. Сравнивать то, что в этой конфигурации ничего не значит, — значит
// не узнать свой же тариф из-за числа, оставшегося от прошлого переключателя.
function configsMatch(a: CalcConfig, b: CalcConfig): boolean {
  return (
    a.warehouse === b.warehouse &&
    (!a.warehouse || a.places === b.places) &&
    a.reports === b.reports &&
    a.batches === b.batches &&
    a.supplyEnabled === b.supplyEnabled &&
    (!a.supplyEnabled || a.warehouses === b.warehouses) &&
    a.prioritySupport === b.prioritySupport
  );
}

const POINT: CalcConfig = {
  warehouse: false,
  places: 1,
  reports: false,
  batches: false,
  supplyEnabled: false,
  warehouses: 1,
  prioritySupport: false,
};

const STOCK: CalcConfig = { ...POINT, warehouse: true };
const SUPPLY: CalcConfig = { ...STOCK, supplyEnabled: true };
const NETWORK: CalcConfig = { ...STOCK, places: NETWORK_PLACES, reports: true, prioritySupport: true };

// Карточки с готовой ценой — для того, кто хочет увидеть цифру за пять секунд,
// а не крутить калькулятор. Экономика та же: каждая цена посчитана из тех же
// констант на конфигурации, в которую чаще всего попадают, — выдуманных чисел
// в карточках нет. Кнопка «Настроить» кладёт конфигурацию в калькулятор ниже,
// так что тариф — это точка отсчёта, а не тупик.
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
    key: 'point',
    name: 'Точка',
    tag: 'Один магазин',
    price: priceOf(POINT).total,
    priceNote: null,
    desc: 'Касса, остатки и приёмка для одного магазина. Кассиров сколько угодно — за людей мы не берём.',
    features: [
      'Касса, работающая без интернета',
      'Приёмка, инвентаризация, списание',
      'Скидки, лояльность, весовой товар',
      'Кабинет владельца с телефона',
    ],
    badge: null,
    message: `Здравствуйте! Хочу подключить тариф «Точка» ANYQ — ${formatMoney(priceOf(POINT).total)}/мес.`,
    config: POINT,
  },
  {
    key: 'stock',
    name: 'Склад',
    tag: 'Магазин с подсобкой или склад',
    price: priceOf(STOCK).total,
    priceNote: null,
    desc: 'Всё из «Точки» плюс адресное хранение, перемещения между местами и закупки у поставщика.',
    features: [
      'Всё из тарифа «Точка»',
      'Ячейки и размещение товара',
      'Перемещения со сверкой обеих сторон',
      'Заказы поставщику и контроль долга',
    ],
    badge: 'Популярный выбор',
    message: `Здравствуйте! Хочу подключить тариф «Склад» ANYQ — ${formatMoney(priceOf(STOCK).total)}/мес.`,
    config: STOCK,
  },
  {
    key: 'supply',
    name: 'Опт',
    tag: 'Дистрибьютор',
    price: priceOf(SUPPLY).total,
    priceNote: null,
    desc: 'Всё из «Склада» плюс сайт заказов: клиенты набирают заказ сами, вы видите его в ту же секунду.',
    features: [
      'Всё из тарифа «Склад»',
      'Витрина заказов на своём адресе',
      'Уведомление о заказе сразу, без опроса',
      'Списание товара по факту выдачи',
    ],
    badge: null,
    message: `Здравствуйте! Хочу подключить тариф «Опт» ANYQ — ${formatMoney(priceOf(SUPPLY).total)}/мес.`,
    config: SUPPLY,
  },
  {
    key: 'network',
    name: 'Сеть',
    tag: `От ${NETWORK_PLACES} мест`,
    price: priceOf(NETWORK).total,
    priceNote: 'от',
    desc: `Пример — ${NETWORK_PLACES} мест хранения с отчётами и приоритетной поддержкой. Точный расчёт под вашу сеть обсуждаем отдельно.`,
    features: [
      'Несколько точек и складов',
      'Сводка по сети у владельца',
      'Приоритетная поддержка',
      'Индивидуальные условия',
    ],
    badge: null,
    message:
      'Здравствуйте! У меня сеть из нескольких точек и складов, хочу подключить ANYQ — посчитайте точный тариф под мою конфигурацию.',
    config: NETWORK,
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
  const [warehouse, setWarehouse] = useState(POINT.warehouse);
  const [places, setPlaces] = useState(POINT.places);
  const [reports, setReports] = useState(POINT.reports);
  const [batches, setBatches] = useState(POINT.batches);
  const [supplyEnabled, setSupplyEnabled] = useState(POINT.supplyEnabled);
  const [warehouses, setWarehouses] = useState(POINT.warehouses);
  const [prioritySupport, setPrioritySupport] = useState(POINT.prioritySupport);

  function applyTier(t: (typeof TIERS)[number]) {
    setWarehouse(t.config.warehouse);
    setPlaces(t.config.places);
    setReports(t.config.reports);
    setBatches(t.config.batches);
    setSupplyEnabled(t.config.supplyEnabled);
    setWarehouses(t.config.warehouses);
    setPrioritySupport(t.config.prioritySupport);
    document.getElementById('calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* Витрина заказов стоит на складе: она показывает остатки по местам и
     списывает по факту выдачи. Включить её отдельно нельзя — и честнее
     переключить склад самим, чем показать сумму, которую потом не подтвердим. */
  function toggleSupply(on: boolean) {
    setSupplyEnabled(on);
    if (on) setWarehouse(true);
  }

  function toggleWarehouse(on: boolean) {
    setWarehouse(on);
    if (!on) {
      setPlaces(1);
      setSupplyEnabled(false);
    }
  }

  const activeTier = useMemo(
    () =>
      TIERS.find((t) =>
        configsMatch(t.config, { warehouse, places, reports, batches, supplyEnabled, warehouses, prioritySupport }),
      ) ?? null,
    [warehouse, places, reports, batches, supplyEnabled, warehouses, prioritySupport],
  );

  const calc = useMemo(
    () => priceOf({ warehouse, places, reports, batches, supplyEnabled, warehouses, prioritySupport }),
    [warehouse, places, reports, batches, supplyEnabled, warehouses, prioritySupport],
  );

  const calcMessage = [
    'Здравствуйте! Собрал(а) тариф ANYQ на сайте, хочу подключить:',
    warehouse
      ? `— Склад, мест хранения: ${places} — ${formatMoney(calc.base)}/мес`
      : `— Точка, один магазин — ${formatMoney(calc.base)}/мес`,
    reports ? `— Отчёты и печать чека — +${formatMoney(REPORTS)}/мес` : null,
    batches ? `— Партии и сроки годности — +${formatMoney(BATCHES)}/мес` : null,
    supplyEnabled ? `— Витрина заказов: ${warehouses} склад(ов) — ${formatMoney(calc.supply)}/мес` : null,
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
          <h2 className="section-heading">Платите за места, а не за людей</h2>
          <p className="section-sub">
            Цена зависит от того, в скольких местах у вас лежит товар. Кассиров, сборщиков и
            приёмщиков заводите сколько нужно — за них мы не берём.
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
              ? `Настроено под тариф «${activeTier.name}» — можно менять места и модули ниже.`
              : 'Меняйте места и модули — сумма и сообщение в WhatsApp пересчитаются сами.'}
          </p>

          <label className="calc-toggle-row">
            <span>
              <span className="calc-row-label">Склад</span>
              <span className="calc-row-hint">Ячейки, перемещения между местами, закупки, производство</span>
            </span>
            <input type="checkbox" checked={warehouse} onChange={(e) => toggleWarehouse(e.target.checked)} />
          </label>

          {warehouse && (
            <Stepper
              label="Мест хранения"
              hint="Точки и склады вместе. Первое включено"
              value={places}
              min={1}
              onIncrement={() => setPlaces((v) => v + 1)}
              onDecrement={() => setPlaces((v) => Math.max(1, v - 1))}
            />
          )}

          <label className="calc-toggle-row">
            <span>
              <span className="calc-row-label">Отчёты и печать чека</span>
              <span className="calc-row-hint">Выручка по дням, история склада, печать на стационарном ПК</span>
            </span>
            <input type="checkbox" checked={reports} onChange={(e) => setReports(e.target.checked)} />
          </label>

          <label className="calc-toggle-row">
            <span>
              <span className="calc-row-label">Партии и сроки годности</span>
              <span className="calc-row-hint">Списание по FEFO — первым уходит то, что раньше испортится</span>
            </span>
            <input type="checkbox" checked={batches} onChange={(e) => setBatches(e.target.checked)} />
          </label>

          <label className="calc-toggle-row">
            <span>
              <span className="calc-row-label">Витрина заказов</span>
              <span className="calc-row-hint">
                Ваши клиенты заказывают сами, с живыми остатками. Работает на складе — включит его вместе с собой
              </span>
            </span>
            <input type="checkbox" checked={supplyEnabled} onChange={(e) => toggleSupply(e.target.checked)} />
          </label>

          {supplyEnabled && (
            <Stepper
              label="Складов с витриной"
              value={warehouses}
              min={1}
              onIncrement={() => setWarehouses((v) => v + 1)}
              onDecrement={() => setWarehouses((v) => Math.max(1, v - 1))}
            />
          )}

          <label className="calc-toggle-row">
            <span>
              <span className="calc-row-label">Приоритетная поддержка</span>
              <span className="calc-row-hint">
                «Не работает касса» — ответ в течение часа, с 8:00 до 22:00, семь дней в неделю.
                Остальное — в течение рабочего дня. Разбор причины письмом — в течение трёх дней
              </span>
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
            Фискальный чек пока пробивает ваша зарегистрированная касса — ANYQ ведёт учёт рядом с
            ней. <IconArrowRight className="icon-14" /> напишите, расскажем, как это устроено.
          </p>
        </div>
      </div>
    </section>
  );
}
