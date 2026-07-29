import { ADMIN_URL, WHATSAPP_NUMBER } from '../api';
import { IconUser, WhatsAppIcon } from './Icons';

export function Footer() {
  const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Здравствуйте! Хочу узнать подробнее про ANYQ.')}`;
  const waDisplay = '+7 778 417 5136';

  function go(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <footer className="landing-footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-brand">
            <div className="landing-logo">
              <span className="order-brand-mark">A</span>
              <span className="landing-logo-text">ANYQ</span>
            </div>
            <p>Касса, склад и заказы для магазинов, складов, аптек и HoReCa в Казахстане.</p>
          </div>

          <div className="footer-col">
            <div className="footer-col-title">Продукт</div>
            <button type="button" onClick={() => go('features')}>Возможности</button>
            <button type="button" onClick={() => go('for-whom')}>Для кого</button>
            <button type="button" onClick={() => go('pricing')}>Тарифы</button>
            <button type="button" onClick={() => go('faq')}>Вопросы</button>
          </div>

          <div className="footer-col">
            <div className="footer-col-title">Аккаунт</div>
            <a href={ADMIN_URL} target="_blank" rel="noopener noreferrer">
              <IconUser className="icon-14" /> Войти в аккаунт
            </a>
          </div>

          <div className="footer-col">
            <div className="footer-col-title">Контакты</div>
            <a href={waUrl} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon className="icon-14" /> {waDisplay}
            </a>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} ANYQ by Astryx</span>
        </div>
      </div>
    </footer>
  );
}
