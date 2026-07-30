import { useState } from 'react';
import { POS_LOGIN_URL, WHATSAPP_NUMBER } from '../api';
import { IconMenu, IconUser, IconX, WhatsAppIcon } from './Icons';

const NAV_ITEMS: { id: string; label: string }[] = [
  { id: 'features', label: 'Возможности' },
  { id: 'for-whom', label: 'Для кого' },
  { id: 'pricing', label: 'Тарифы' },
  { id: 'faq', label: 'Вопросы' },
];

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Здравствуйте! Хочу узнать подробнее про ANYQ.')}`;

  function go(id: string) {
    setOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <header className="landing-header">
      <div className="landing-header-inner">
        <a
          className="landing-logo"
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            go('top');
          }}
        >
          <span className="order-brand-mark">A</span>
          <span className="landing-logo-text">ANYQ</span>
        </a>

        <nav className="landing-nav" aria-label="Разделы сайта">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} type="button" onClick={() => go(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="landing-header-actions">
          <a className="btn btn-ghost landing-login-btn" href={POS_LOGIN_URL} target="_blank" rel="noopener noreferrer">
            <IconUser className="icon-16" />
            <span>Войти</span>
          </a>
          <a className="btn btn-primary landing-header-cta" href={waUrl} target="_blank" rel="noopener noreferrer">
            <WhatsAppIcon />
            <span>Написать</span>
          </a>
          <button className="landing-menu-btn" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={open}>
            {open ? <IconX /> : <IconMenu />}
          </button>
        </div>
      </div>

      {open && (
        <div className="landing-mobile-nav">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} type="button" onClick={() => go(item.id)}>
              {item.label}
            </button>
          ))}
          <a className="btn btn-secondary btn-block" href={POS_LOGIN_URL} target="_blank" rel="noopener noreferrer">
            <IconUser className="icon-16" /> Войти в кассу
          </a>
          <a className="btn btn-primary btn-block" href={waUrl} target="_blank" rel="noopener noreferrer">
            <WhatsAppIcon /> Написать в WhatsApp
          </a>
        </div>
      )}
    </header>
  );
}
