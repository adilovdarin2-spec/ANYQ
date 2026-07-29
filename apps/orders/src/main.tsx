import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/global.css';

// This app is multi-tenant — one deployment, one URL per supplier
// (/company-slug). A static manifest.json can't know which supplier a visitor
// is on, so start_url is overridden at runtime to the current path: installing
// the PWA from a supplier's link launches straight back into their storefront,
// not a blank root.
function injectManifest() {
  const startUrl = window.location.pathname || '/';
  const manifest = {
    name: 'ANYQ Заказы',
    short_name: 'ANYQ Заказы',
    description: 'Витрина поставщика ANYQ — закажите товары онлайн',
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    background_color: '#F5FAF6',
    theme_color: '#146C43',
    orientation: 'portrait',
    lang: 'ru',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  link.href = url;
}

injectManifest();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
