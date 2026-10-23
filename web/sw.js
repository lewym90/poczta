// Service worker: powłoka aplikacji offline. Dane z API zawsze z sieci (offline czyta aplikacja z własnej pamięci).
const V = 'poczta-v1';
const SHELL = ['./', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || /\/api\//.test(u.pathname) || /\/zdrowie$/.test(u.pathname)) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((ch) => ch.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match('./'))));
});
