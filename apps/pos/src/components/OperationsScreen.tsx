import { useState } from 'react';
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
  /** Как часто это делают. См. WEIGHTS ниже. */
  weight: OperationWeight;
}

export type OperationGroup = 'stock' | 'suppliers' | 'money' | 'setup' | 'restaurant';

/**
 * Как часто человек это делает.
 *
 * Разделы по темам здесь были с самого начала, и их не хватило. Владелец,
 * открыв «Операции», видел двадцать четыре строки **одинакового вида**:
 * «Приёмка», которую делают каждый день, стояла таким же серым рядком, как
 * «Перенести товары», которое делают один раз в жизни. Тема отвечает на
 * вопрос «про что это», а человек, открывший меню, спрашивает другое — «где
 * то, что мне сейчас нажать».
 *
 * Поэтому вес. Ежедневное — крупными плитками наверху, и его мало: три-пять
 * штук, в которые попадают пальцем не глядя. Периодическое — прежними
 * строками, по темам. Разовое — под свёрнутой строкой, потому что открывать
 * его будут дважды за всё время, а место оно занимало наравне с работой.
 *
 * Вес — свойство самой операции, а не настройка: «приёмка» для всех
 * ежедневная, «ячейки» для всех разовые. Разным бизнесам разное достаётся
 * само собой — у аптеки в ежедневном окажутся партии со сроками, у кафе зал
 * и кухня, у оптовика заказы с витрины, потому что остальным этих операций
 * не выдают вовсе.
 */
export type OperationWeight = 'daily' | 'sometimes' | 'rare';

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
  // Свёрнуто по умолчанию и намеренно: развернув один раз, человек не должен
  // видеть это каждый следующий заход — иначе смысл теряется.
  const [showRare, setShowRare] = useState(false);

  const daily = items.filter((item) => item.weight === 'daily');
  const sometimes = items.filter((item) => item.weight === 'sometimes');
  const rare = items.filter((item) => item.weight === 'rare');

  return (
    <div className="tab-content">
      <div className="tab-header">{t('tab.operations')}</div>
      {items.length === 0 && <div className="empty-state">{t('ops.noneOnTariff')}</div>}

      {daily.length > 0 && (
        <div className="ops-daily">
          {daily.map((item) => (
            <button key={item.key} type="button" className="ops-tile" onClick={item.onClick}>
              <span className="ops-tile-icon"><Icon name={item.icon} /></span>
              <span className="ops-tile-label">{item.label}</span>
              {/* Число на плитке — это то, что ждёт: непросроченных заказов,
                  кончающихся сроков. Ноль не показывается: значок, который
                  висит всегда, перестают замечать вместе с тем днём, когда он
                  правда что-то значит. */}
              {!!item.badge && <span className="ops-tile-badge">{item.badge}</span>}
            </button>
          ))}
        </div>
      )}

      {GROUPS.map((group) => {
        const inGroup = sometimes.filter((item) => item.group === group.key);
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

      {rare.length > 0 && (
        <div className="operations-group">
          <button type="button" className="ops-rare-toggle" onClick={() => setShowRare(!showRare)}>
            <span className="operations-label">{t('opsWeight.rare')}</span>
            <span className="operations-chevron">{showRare ? '⌄' : '›'}</span>
          </button>
          {showRare &&
            rare.map((item) => (
              <button key={item.key} type="button" className="operations-row" onClick={item.onClick}>
                <span className="operations-icon"><Icon name={item.icon} /></span>
                <span className="operations-label">{item.label}</span>
                {!!item.badge && <span className="operations-badge">{item.badge}</span>}
                <span className="operations-chevron">›</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
