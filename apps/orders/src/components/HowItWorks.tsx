const STEPS = [
  {
    n: '1',
    title: 'Оставляете заявку',
    desc: 'Пишете в WhatsApp — с ходом расчёта из калькулятора или просто «хочу подключить». Отвечаем в рабочее время в течение часа.',
  },
  {
    n: '2',
    title: 'Настраиваем за один день',
    desc: 'Заводим точки продаж, товары и сотрудников, включаем нужные модули под ваш профиль — магазин, склад, аптеку, кафе или HoReCa-склад.',
  },
  {
    n: '3',
    title: 'Начинаете работать',
    desc: 'Выдаём PIN-коды сотрудникам, показываем кассу на реальных данных — и с этого момента продажи идут через ANYQ.',
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="section">
      <div className="section-inner">
        <div className="section-head">
          <span className="section-eyebrow">Как подключиться</span>
          <h2 className="section-heading">От заявки до первой продажи — один день</h2>
          <p className="section-sub">Без сложного внедрения и обучения на неделю — три простых шага.</p>
        </div>

        <div className="steps-grid">
          {STEPS.map((s) => (
            <div className="step-card" key={s.n}>
              <div className="step-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
