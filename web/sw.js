// Service worker: powłoka aplikacji offline. Dane z API zawsze z sieci (offline czyta aplikacja z własnej pamięci).
const V = 'poczta-v25';
const SHELL = ['./', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || /\/api\//.test(u.pathname) || /\/zdrowie$/.test(u.pathname)) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((ch) => ch.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match('./'))));
});

// Powiadomienia push: iOS wymaga pokazania powiadomienia przy każdym pushu.
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: 'Poczta', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'Poczta', { body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag, renotify: false, data: { url: d.url || './' } }),
    d.badge != null && self.navigator.setAppBadge ? (d.badge ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {}) : null,
  ]));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (cs) => {
    const c = cs.find((x) => x.url.startsWith(self.registration.scope));
    if (c) { await c.focus(); if ('navigate' in c) return c.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  }));
});

// iOS potrafi unieważnić subskrypcję: odnawiamy ją i zgłaszamy serwerowi.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const h = { 'Content-Type': 'application/json', 'X-Poczta': '1' };
    const { key } = await (await fetch('api/push/key', { headers: h })).json();
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch('api/push/subscribe', { method: 'POST', headers: h, body: JSON.stringify({ subscription: sub.toJSON() }) });
  })().catch(() => {}));
});
