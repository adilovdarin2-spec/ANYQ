export interface OperationItem {
  key: string;
  icon: string;
  label: string;
  badge?: number;
  onClick: () => void;
}

interface Props {
  items: OperationItem[];
}

export function OperationsScreen({ items }: Props) {
  return (
    <div className="tab-content">
      <div className="tab-header">Операции</div>
      {items.length === 0 && <div className="empty-state">На вашем тарифе нет дополнительных операций</div>}
      {items.map((item) => (
        <button key={item.key} type="button" className="operations-row" onClick={item.onClick}>
          <span className="operations-icon">{item.icon}</span>
          <span className="operations-label">{item.label}</span>
          {!!item.badge && <span className="operations-badge">{item.badge}</span>}
          <span className="operations-chevron">›</span>
        </button>
      ))}
    </div>
  );
}
