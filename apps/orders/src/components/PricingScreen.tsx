const CONTACT_EMAIL = 'support@anyq.kz';

export function PricingScreen() {
  return (
    <div className="order-content pricing-content">
      <div className="pricing-hero">
        <h1>Тарифы ANYQ</h1>
        <p>
          Касса, склад и заказы для магазинов, кафе, складов и HoReCa-поставщиков в Казахстане.
          Один PWA-планшет вместо кассового терминала, офлайн-режим, живые остатки.
        </p>
      </div>

      <div className="pricing-plan">
        <div className="pricing-plan-header">
          <span className="pricing-plan-name">Core</span>
          <span className="pricing-plan-tag">касса и склад</span>
        </div>
        <div className="pricing-price">
          29 900 ₸<span>/мес</span>
        </div>
        <p className="pricing-plan-desc">
          Для магазина, склада или аптеки: PWA-касса, остатки по точкам, смены со сверкой кассы,
          офлайн-режим с очередью синхронизации.
        </p>
        <ul className="pricing-feature-list">
          <li>1 точка, до 3 пользователей, товары без лимита</li>
          <li>Каждая доп. точка — +14 900 ₸/мес</li>
          <li>Каждый пользователь сверх включённых — +2 900 ₸/мес</li>
        </ul>
      </div>

      <div className="pricing-plan pricing-plan-addon">
        <div className="pricing-plan-header">
          <span className="pricing-plan-name">Supply</span>
          <span className="pricing-plan-tag">надстройка к Core</span>
        </div>
        <div className="pricing-price">
          49 900 ₸<span>/мес</span>
        </div>
        <p className="pricing-plan-desc">
          Для HoReCa-поставщиков и оптовых складов: публичный сайт заказов со своим адресом,
          push-уведомление в момент заказа, PWA-приложение, списание товара по факту выдачи.
        </p>
        <ul className="pricing-feature-list">
          <li>Первый склад — витрина + push + PWA + касса</li>
          <li>Каждый доп. склад — +19 900 ₸/мес</li>
        </ul>
      </div>

      <div className="section-title">Уровень поддержки</div>
      <div className="pricing-support-row">
        <span>Базовая</span>
        <span>включено</span>
      </div>
      <div className="pricing-support-row">
        <span>Приоритетная</span>
        <span>+9 900 ₸/мес</span>
      </div>
      <div className="pricing-support-row">
        <span>Персональный менеджер</span>
        <span>от +29 900 ₸/мес</span>
      </div>

      <div className="pricing-example">
        <div className="pricing-example-title">Пример</div>
        <p>HoReCa-поставщик с одним складом, базовая поддержка:</p>
        <p className="pricing-example-sum">Core 29 900 + Supply 49 900 = <strong>79 800 ₸/мес</strong></p>
      </div>

      <div className="pricing-cta">
        <p>
          Тариф подключается вручную — напишите нам, обсудим точки, пользователей и модули под
          ваш бизнес.
        </p>
        <a className="btn btn-primary btn-block" href={`mailto:${CONTACT_EMAIL}`}>
          Написать нам
        </a>
      </div>
    </div>
  );
}
