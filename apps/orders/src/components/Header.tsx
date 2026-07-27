interface Props {
  companyName: string;
}

export function Header({ companyName }: Props) {
  return (
    <div className="order-header">
      <div className="order-header-inner">
        <div className="order-brand-mark">A</div>
        <div className="order-header-text">
          <div className="order-company-name">{companyName}</div>
          <div className="order-header-sub">Заказ поставщику · ANYQ</div>
        </div>
      </div>
    </div>
  );
}
