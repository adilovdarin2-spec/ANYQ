interface Props {
  companyName: string;
  subtitle?: string;
}

export function Header({ companyName, subtitle = 'Заказ поставщику · ANYQ' }: Props) {
  return (
    <div className="order-header">
      <div className="order-header-inner">
        <div className="order-brand-mark">A</div>
        <div className="order-header-text">
          <div className="order-company-name">{companyName}</div>
          <div className="order-header-sub">{subtitle}</div>
        </div>
      </div>
    </div>
  );
}
