const CACHE_NAME = 'anyq-pos-v1';
const CORE_ASSETS = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

// Fills the cache on first install so the app already works offline after a
// single visit — without this, nothing is cached until a resource has been
// fetched once through the 'fetch' handler below, which never covers the
// very first load (the SW isn't controlling the page yet when it happens).
async function precache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    CORE_ASSETS.map((url) =>
      fetch(url)
        .then((res) => (res.ok ? cache.put(url, res) : null))
        .catch(() => {}),
    ),
  );
  try {
    const htmlResponse = await fetch('/');
    if (htmlResponse.ok) {
      const html = await htmlResponse.clone().text();
      cache.put('/', htmlResponse);
      const assetUrls = [...html.matchAll(/(?:src|href)="(\/[^"]+?\.(?:js|css))"/g)].map((m) => m[1]);
      await Promise.all(
        assetUrls.map((url) =>
          fetch(url)
            .then((res) => (res.ok ? cache.put(url, res) : null))
            .catch(() => {}),
        ),
      );
    }
  } catch {
    // best-effort — the runtime handler below fills any gaps once online
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache successful responses — caching a transient 404/500 would
        // serve that error forever after, even once the network is fine again.
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))),
  );
});

// New-order alerts (Заказы screen) — see apps/pos/src/push.ts for the
// subscribe side and apps/api/src/push.ts for the send side.
self.addEventListener('push', (event) => {
  let payload = { title: 'ANYQ Касса', body: 'Новое уведомление' };
  try {
    payload = event.data.json();
  } catch {
    // ignore malformed payloads
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    }),
  );
});
