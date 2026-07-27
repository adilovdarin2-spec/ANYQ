interface Props {
  companyName: string;
  onNewOrder: () => void;
}

export function SuccessScreen({ companyName, onNewOrder }: Props) {
  return (
    <div className="screen">
      <div className="screen-header">
        <span className="screen-title">Заказ отправлен</span>
      </div>
      <div className="screen-body">
        <div className="success-icon">✓</div>
        <div className="success-title">Спасибо за заказ!</div>
        <p className="success-sub">
          Заказ передан в «{companyName}». С вами свяжутся для подтверждения и уточнения времени выдачи.
        </p>
      </div>
      <div className="screen-footer">
        <div className="screen-footer-inner">
          <button className="btn btn-secondary btn-block" onClick={onNewOrder}>
            Сделать ещё один заказ
          </button>
        </div>
      </div>
    </div>
  );
}
