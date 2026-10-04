// The guest app's service worker: keeps the app's own files on the phone so it opens with no internet. (The programme itself is kept by
// guest.js.) Network first, with the kept copy as the fallback. Its scope is this folder only: it never touches the leader's app.
const VERSION = '0.85.0'; // keep equal to GUEST_VERSION in the tests
const CACHE = `tour-docs-guest-${VERSION}`;
const FILES = ['./', 'index.html', 'guest.css', 'guest.js', 'passport.js', 'stamps.js', 'manifest.webmanifest', '../js/supabase-config.js', '../js/pushUtil.js',
  '../icons/apple-touch-icon.png', '../icons/icon-192.png', '../icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('tour-docs-guest-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return; // the server question is never cached
  event.respondWith(
    fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      return response;
    }).catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit ?? caches.match('index.html'))));
});

// Notifications (Web Push). The sending service (supabase/functions/send-push) sends { title, body, url }; we show it, and a tap opens (or
// brings forward) the app at that address.
self.addEventListener('push', (event) => {
  let message = { title: 'Tour Docs', body: '', url: './' };
  try { message = { ...message, ...event.data.json() }; } catch { /* a push with no readable content: show the default */ }
  event.waitUntil(self.registration.showNotification(message.title, { body: message.body, icon: '../icons/icon-192.png', badge: '../icons/icon-192.png', data: { url: message.url }, silent: message.silent === true }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) { if ('focus' in client) { client.navigate?.(target).catch(() => {}); return client.focus(); } }
    return self.clients.openWindow(target);
  }));
});
