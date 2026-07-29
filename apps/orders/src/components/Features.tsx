import {
  IconBell,
  IconBox,
  IconChart,
  IconChefHat,
  IconLayers,
  IconPill,
  IconSmartphone,
  IconTag,
  IconTruck,
  IconWifiOff,
} from './Icons';

const FEATURES = [
  {
    icon: IconWifiOff,
    title: 'Работает без интернета',
    desc: 'Касса продолжает пробивать чеки в офлайне. Все продажи уходят в очередь и синхронизируются, как только связь вернётся.',
  },
  {
    icon: IconBox,
    title: 'Живые остатки по точкам',
    desc: 'Приход, списание и перемещение товара обновляют остатки в реальном времени сразу на всех точках и складах.',
  },
  {
    icon: IconSmartphone,
    title: 'PWA — без App Store',
    desc: 'Ставится на телефон или планшет за минуту прямо из браузера, без магазинов приложений и долгих обновлений.',
  },
  {
    icon: IconBell,
    title: 'Push-уведомления о заказах',
    desc: 'Новый заказ от партнёра моментально приходит уведомлением — ни один заказ не потеряется и не будет пропущен.',
  },
  {
    icon: IconChefHat,
    title: 'Кухонный дисплей (KDS)',
    desc: 'Заказ со стола сразу появляется на экране кухни со статусами приготовления — официант и повар всегда синхронны.',
  },
  {
    icon: IconChart,
    title: 'Рецепты и фудкост',
    desc: 'Ингредиенты списываются со склада автоматически по рецепту, а отчёты сразу показывают маржу каждого блюда.',
  },
  {
    icon: IconPill,
    title: 'Партии и сроки годности',
    desc: 'FEFO-логика списывает в первую очередь товар с ближайшим сроком годности — критично для аптек и продуктов.',
  },
  {
    icon: IconTruck,
    title: 'Перемещения между складами',
    desc: 'Передача товара между точками и складами с полной историей движения — видно, где и что находится в любой момент.',
  },
  {
    icon: IconTag,
    title: 'Скидки и бонусные баллы',
    desc: 'Гибкие скидки на чек и программа лояльности для постоянных клиентов — настраиваются без разработчиков.',
  },
  {
    icon: IconLayers,
    title: 'Варианты товара',
    desc: 'Один товар — много вариантов размера, цвета или объёма. На кассе всё выбирается в два касания, без путаницы.',
  },
];

export function Features() {
  return (
    <section id="features" className="section">
      <div className="section-inner">
        <div className="section-head">
          <span className="section-eyebrow">Возможности</span>
          <h2 className="section-heading">Всё, что нужно для операционки бизнеса</h2>
          <p className="section-sub">
            ANYQ строился не как касса с довеском, а как полноценная система учёта — под магазины, склады,
            аптеки, кафе и рестораны, и поставщиков HoReCa.
          </p>
        </div>

        <div className="features-grid">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div className="feature-card" key={title}>
              <div className="feature-icon">
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
