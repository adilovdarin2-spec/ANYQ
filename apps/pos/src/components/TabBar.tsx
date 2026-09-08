import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';

export type MainTab = 'sale' | 'products' | 'operations' | 'profile';

interface Props {
  active: MainTab;
  onChange: (tab: MainTab) => void;
  showProducts: boolean;
  showOperations: boolean;
  operationsBadge?: number;
}

// The label is a key, resolved at render: a module-level constant would be
// translated once, at import, and never change when the language does.
const TABS: { key: MainTab; icon: string; phrase: PhraseKey }[] = [
  { key: 'sale', icon: '🛒', phrase: 'tab.sale' },
  { key: 'products', icon: '📦', phrase: 'tab.products' },
  { key: 'operations', icon: '⚙️', phrase: 'tab.operations' },
  { key: 'profile', icon: '👤', phrase: 'tab.profile' },
];

export function TabBar({ active, onChange, showProducts, showOperations, operationsBadge = 0 }: Props) {
  const { t } = useTranslation();
  const visible = TABS.filter((tab) => {
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
              {tab.icon}
              {tab.key === 'operations' && operationsBadge > 0 && <span className="tab-bar-badge">{operationsBadge}</span>}
            </span>
            <span className="tab-bar-label">{t(tab.phrase)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
