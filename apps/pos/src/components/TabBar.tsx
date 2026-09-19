import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export type MainTab = 'floor' | 'orders' | 'sale' | 'products' | 'operations' | 'profile';

interface Props {
  active: MainTab;
  onChange: (tab: MainTab) => void;
  showProducts: boolean;
  showOperations: boolean;
  /** Кафе начинает работу с зала, а не с чека. */
  showFloor: boolean;
  /** У поставщика день состоит из заказов, а не из чеков. */
  showOrders: boolean;
  ordersBadge?: number;
  operationsBadge?: number;
}

// The label is a key, resolved at render: a module-level constant would be
// translated once, at import, and never change when the language does.
const TABS: { key: MainTab; icon: IconName; phrase: PhraseKey }[] = [
  // Первым — то, с чего начинается работа. У официанта это стол: заказ живёт
  // за столом, а чек появляется в конце. Касса рядом и никуда не делась —
  // навынос пробивают ею.
  { key: 'floor', icon: 'table', phrase: 'tab.floor' },
  { key: 'orders', icon: 'orders', phrase: 'tab.orders' },
  { key: 'sale', icon: 'sale', phrase: 'tab.sale' },
  { key: 'products', icon: 'products', phrase: 'tab.products' },
  { key: 'operations', icon: 'operations', phrase: 'tab.operations' },
  { key: 'profile', icon: 'profile', phrase: 'tab.profile' },
];

export function TabBar({ active, onChange, showProducts, showOperations, showFloor, showOrders, operationsBadge = 0, ordersBadge = 0 }: Props) {
  const { t } = useTranslation();
  const visible = TABS.filter((tab) => {
    if (tab.key === 'floor') return showFloor;
    if (tab.key === 'orders') return showOrders;
    if (tab.key === 'products') return showProducts;
    if (tab.key === 'operations') return showOperations;
    return true;
  });

  return (
    <nav className="tab-bar">
      <div className="tab-bar-inner">
        {visible.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab-bar-item${active === tab.key ? ' active' : ''}`}
            onClick={() => onChange(tab.key)}
          >
            <span className="tab-bar-icon">
              <Icon name={tab.icon} />
              {tab.key === 'operations' && operationsBadge > 0 && <span className="tab-bar-badge">{operationsBadge}</span>}
              {tab.key === 'orders' && ordersBadge > 0 && <span className="tab-bar-badge">{ordersBadge}</span>}
            </span>
            <span className="tab-bar-label">{t(tab.phrase)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
