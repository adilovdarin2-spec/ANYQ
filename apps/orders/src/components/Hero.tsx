import { WHATSAPP_NUMBER } from '../api';
import { IconArrowRight, IconBell, IconBox, IconChart, IconWifiOff } from './Icons';

const VISUAL_ITEMS = [
  { icon: IconWifiOff, label: 'Офлайн-касса' },
  { icon: IconBox, label: 'Живые остатки' },
  { icon: IconBell, label: 'Заказы push' },
  { icon: IconChart, label: 'Отчёты и фудкост' },
];

export function Hero() {
  const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Здравствуйте! Хочу подключить ANYQ для своего бизнеса.')}`;

  function scrollToPricing(e: React.MouseEvent) {
    e.preventDefault();
    document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <section id="top" className="hero">
      <div className="hero-inner">
        <div className="hero-copy">
          <span className="hero-eyebrow">Касса · склад · заказы · отчёты</span>
          <h1>Одна система вместо пяти разных программ для бизнеса</h1>
          <p className="hero-sub">
            ANYQ заменяет кассовый терминал, складской учёт, приём заказов от партнёров и отчётность —
            одним PWA-приложением на обычном телефоне или планшете. Работает офлайн, считает остатки
            в реальном времени и подключается за один день.
          </p>
          <div className="hero-cta-row">
            <a className="btn btn-primary btn-lg" href="#pricing" onClick={scrollToPricing}>
              Подобрать тариф <IconArrowRight className="icon-18" />
            </a>
            <a className="btn btn-secondary btn-lg" href={waUrl} target="_blank" rel="noopener noreferrer">
              Написать в WhatsApp
            </a>
          </div>
          <div className="trust-pills">
            <span className="trust-pill"><IconWifiOff className="icon-14" /> Работает офлайн</span>
            <span className="trust-pill"><IconBox className="icon-14" /> Живые остатки по точкам</span>
            <span className="trust-pill"><IconBell className="icon-14" /> Push-уведомления</span>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="hero-visual-card">
            <div className="hero-visual-head">
              <span className="order-brand-mark">A</span>
              <span>ANYQ</span>
            </div>
            <div className="hero-visual-grid">
              {VISUAL_ITEMS.map(({ icon: Icon, label }) => (
                <div className="hero-visual-item" key={label}>
                  <Icon className="icon-22" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
