const CACHE = 'perry-park-v13';
const ASSETS = ['./', './index.html', './manifest.json', './icons/icon-192.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
      return cached || network;
    })
  );
});

self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch (err) { data = {body: e.data.text()}; }
  // FCM webpush sends wrap the fields in a `notification` object; plain pushes don't
  const n = data.notification || data;
  e.waitUntil(self.registration.showNotification(n.title || 'Perry Park Cup', {
    body: n.body || '',
    icon: './icons/icon-192.svg',
    badge: './icons/icon-192.svg',
    tag: n.tag || 'perry-park',
    data: (data.fcmOptions && data.fcmOptions.link) || n.click_action || n.url || './',
    vibrate: [200, 100, 200]
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data || './'));
});
