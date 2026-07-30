import { IconBuilding, IconChefHat, IconPill, IconStore, IconTruck } from './Icons';

const SEGMENTS = [
  {
    icon: IconStore,
    title: 'Магазины и супермаркеты',
    desc: 'Розничная касса, скидки, лояльность, весовой товар и варианты — всё для одной или сети точек.',
  },
  {
    icon: IconBuilding,
    title: 'Склады и дистрибьюторы',
    desc: 'Приёмка, инвентаризация, перемещения между точками и производство/фасовка из сырья.',
  },
  {
    icon: IconPill,
    title: 'Аптеки',
    desc: 'Партийный учёт и списание по FEFO — товар с ближайшим сроком годности продаётся первым.',
  },
  {
    icon: IconTruck,
    title: 'HoReCa-поставщики',
    desc: 'Публичная витрина заказов для партнёров, push-уведомления и списание склада по факту выдачи.',
  },
  {
    icon: IconChefHat,
    title: 'Кафе и рестораны',
    desc: 'Карта зала, кухонный дисплей, рецепты с фудкостом и модификаторы блюд прямо на кассе.',
  },
];

export function ForWhom() {
  return (
    <section id="for-whom" className="section">
      <div className="section-inner">
        <div className="section-head">
          <span className="section-eyebrow">Для кого</span>
          <h2 className="section-heading">Один продукт под разные виды бизнеса</h2>
          <p className="section-sub">
            Модули включаются под конкретную задачу — вы платите за то, чем пользуетесь, а не за универсальный
            комбайн с лишними функциями.
          </p>
        </div>

        <div className="whom-grid">
          {SEGMENTS.map(({ icon: Icon, title, desc }) => (
            <div className="whom-card" key={title}>
              <div className="whom-icon">
                <Icon className="icon-24" />
              </div>
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
