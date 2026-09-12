interface Props {
  companyName: string;
  /** Короткий номер заказа. `null` — если сервер старой версии его не прислал. */
  orderNumber: string | null;
  onNewOrder: () => void;
}

export function SuccessScreen({ companyName, orderNumber, onNewOrder }: Props) {
  return (
    <div className="screen">
      <div className="screen-header">
        <span className="screen-title">Заказ отправлен</span>
      </div>
      <div className="screen-body screen-body-center">
        <div className="success-icon">✓</div>
        <div className="success-title">Спасибо за заказ!</div>
        <p className="success-sub">
          {/* Без кавычек вокруг названия: у половины поставщиков они уже внутри,
              и получалось «Склад HoReCa «Дастархан Опт»» — двойные кавычки в
              первом же предложении, которое видит клиент. */}
          Заказ передан в {companyName}. С вами свяжутся для подтверждения и уточнения времени выдачи.
        </p>
        {/* Номер, а не идентификатор из двадцати пяти знаков. Это то, что
            человек называет по телефону, когда звонит уточнить время выдачи, —
            и до сих пор называть было нечего. */}
        {orderNumber && <div className="success-number">Заказ {orderNumber}</div>}
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
