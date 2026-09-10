import { useTranslation } from '../i18n/useLanguage';
import type { PhraseKey } from '../i18n';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface OperationItem {
  key: string;
  icon: IconName;
  label: string;
  badge?: number;
  onClick: () => void;
  /** К какой части работы относится. См. GROUPS ниже. */
  group: OperationGroup;
}

export type OperationGroup = 'stock' | 'suppliers' | 'money' | 'setup' | 'restaurant';

/**
 * Разделы операций и их порядок.
 *
 * Список операций был плоским, и пока в нём было восемь строк, это работало.
 * Сейчас их за двадцать, и плоский список из двадцати одинаковых строк — это
 * не меню, а перечень: кладовщик, которому нужна приёмка, читает его глазами
 * сверху донизу каждый раз.
 *
 * Разделы названы по тому, **что человек собирается сделать**, а не по тому,
 * как устроен продукт: «товар и остатки», а не «складской модуль». Порядок —
 * по частоте: то, что делают каждый день, стоит первым.
 */
const GROUPS: { key: OperationGroup; title: PhraseKey }[] = [
  { key: 'stock', title: 'opsGroup.stock' },
  { key: 'suppliers', title: 'opsGroup.suppliers' },
  { key: 'money', title: 'opsGroup.money' },
  { key: 'restaurant', title: 'opsGroup.restaurant' },
  { key: 'setup', title: 'opsGroup.setup' },
];

interface Props {
  items: OperationItem[];
}

export function OperationsScreen({ items }: Props) {
  const { t } = useTranslation();
  return (
    <div className="tab-content">
      <div className="tab-header">{t('tab.operations')}</div>
      {items.length === 0 && <div className="empty-state">{t('ops.noneOnTariff')}</div>}

      {GROUPS.map((group) => {
        const inGroup = items.filter((item) => item.group === group.key);
        if (inGroup.length === 0) return null;
        return (
          <div key={group.key} className="operations-group">
            <div className="operations-group-title">{t(group.title)}</div>
            {inGroup.map((item) => (
              <button key={item.key} type="button" className="operations-row" onClick={item.onClick}>
                <span className="operations-icon"><Icon name={item.icon} /></span>
                <span className="operations-label">{item.label}</span>
                {!!item.badge && <span className="operations-badge">{item.badge}</span>}
                <span className="operations-chevron">›</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
