export type MainTab = 'sale' | 'products' | 'operations' | 'profile';

interface Props {
  active: MainTab;
  onChange: (tab: MainTab) => void;
  showProducts: boolean;
  showOperations: boolean;
  operationsBadge?: number;
}

const TABS: { key: MainTab; icon: string; label: string }[] = [
  { key: 'sale', icon: '🛒', label: 'Касса' },
  { key: 'products', icon: '📦', label: 'Товары' },
  { key: 'operations', icon: '⚙️', label: 'Операции' },
  { key: 'profile', icon: '👤', label: 'Профиль' },
];

export function TabBar({ active, onChange, showProducts, showOperations, operationsBadge = 0 }: Props) {
  const visible = TABS.filter((t) => {
    if (t.key === 'products') return showProducts;
    if (t.key === 'operations') return showOperations;
    return true;
  });

  return (
    <nav className="tab-bar">
      <div className="tab-bar-inner">
        {visible.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-bar-item${active === t.key ? ' active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            <span className="tab-bar-icon">
              {t.icon}
              {t.key === 'operations' && operationsBadge > 0 && <span className="tab-bar-badge">{operationsBadge}</span>}
            </span>
            <span className="tab-bar-label">{t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
