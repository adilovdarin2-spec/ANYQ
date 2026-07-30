import { WHATSAPP_NUMBER } from '../api';
import { IconArrowRight, IconBell, IconBox, IconWifiOff } from './Icons';

// Decorative — a simplified, honest recreation of the real POS screen
// (same product-tile shape, same cart bar) rather than an abstract icon
// grid or a claimed screenshot.
const MOCK_PRODUCTS = [
  { name: 'Хлеб белый', price: '250 ₸' },
  { name: 'Молоко 1л', price: '590 ₸' },
  { name: 'Вода 0.5л', price: '150 ₸' },
  { name: 'Кофе 200мл', price: '890 ₸' },
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
          <div className="device-mockup">
            <div className="device-mockup-screen">
              <div className="device-mockup-head">
                <span className="order-brand-mark">A</span>
                <span>Касса</span>
                <span className="device-mockup-dot" />
              </div>
              <div className="device-mockup-grid">
                {MOCK_PRODUCTS.map((p) => (
                  <div className="device-mockup-tile" key={p.name}>
                    <span className="device-mockup-tile-name">{p.name}</span>
                    <span className="device-mockup-tile-price">{p.price}</span>
                  </div>
                ))}
              </div>
              <div className="device-mockup-cart">
                <span>Корзина · 2 тов.</span>
                <span>1 730 ₸</span>
              </div>
            </div>
          </div>
          <div className="hero-visual-badge hero-visual-badge-offline">
            <IconWifiOff className="icon-16" /> Офлайн-режим
          </div>
          <div className="hero-visual-badge hero-visual-badge-push">
            <IconBell className="icon-16" /> Новый заказ!
          </div>
        </div>
      </div>
    </section>
  );
}
