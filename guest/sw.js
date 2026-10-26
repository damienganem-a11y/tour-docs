// The guest app's service worker: keeps the app's own files on the phone so it opens with no internet. (The programme itself is kept by
// guest.js.) Network first, with the kept copy as the fallback. Its scope is this folder only: it never touches the leader's app.
const VERSION = '0.128.0'; // keep equal to GUEST_VERSION in the tests
const CACHE = `tour-docs-guest-${VERSION}`;
const FILES = ['./', 'index.html', 'guest.css', 'guest.js', 'passport.js', 'explorer/state.js', 'explorer/themes.js', 'explorer/common.js', 'explorer/runner.js', 'explorer/fit.js', 'explorer/sequence.js', 'explorer/pour.js', 'explorer/mirror.js', 'explorer/rhythm.js', 'explorer/catch.js', 'explorer/flap.js', 'explorer/hidden.js', 'explorer/spot.js', 'explorer/archery.js', 'explorer/maze.js', 'explorer/carve.js', 'explorer/pipes.js', 'explorer/games.js', 'stamps.js', 'album.js', 'greetings.js', 'manifest.webmanifest', '../js/supabase-config.js', '../js/pushUtil.js', '../js/albumImage.js',
  '../icons/apple-touch-icon.png', '../icons/apple-touch-icon-2.png', '../icons/icon-192.png', '../icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('tour-docs-guest-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return; // the server question is never cached
  // Network first, but a slow connection gives up after 5 seconds and uses the kept copy. Only good answers are kept (never a 404 page).
  const fromNetwork = Promise.race([fetch(request), new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 5000))]);
  event.respondWith(
    fromNetwork.then((response) => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {}); }
      return response;
    }).catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit ?? caches.match('index.html'))));
});

// Notifications (Web Push). The sending service (supabase/functions/send-push) sends { title, body, url }; we show it, and a tap opens (or
// brings forward) the app at that address.
// Every notification is also kept in a small list on the phone (the guest's Messages page reads it), the newest 60.
function saveToInbox(message) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('tourdocs-guest', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('inbox', { keyPath: 'id', autoIncrement: true });
      open.onerror = () => resolve();
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('inbox', 'readwrite');
        const storeObject = tx.objectStore('inbox');
        storeObject.add({ title: String(message.title ?? ''), body: String(message.body ?? ''), at: Date.now() });
        const keys = storeObject.getAllKeys();
        keys.onsuccess = () => { const all = keys.result; for (const key of all.slice(0, Math.max(0, all.length - 60))) storeObject.delete(key); };
        tx.oncomplete = () => { db.close(); self.clients.matchAll({ includeUncontrolled: true }).then((clients) => clients.forEach((c) => c.postMessage({ type: 'inbox' }))).catch(() => {}); resolve(); };
        tx.onerror = () => resolve();
      };
    } catch { resolve(); }
  });
}
self.addEventListener('push', (event) => {
  let message = { title: 'Tour Docs', body: '', url: './' };
  try { message = { ...message, ...event.data.json() }; } catch { /* a push with no readable content: show the default */ }
  event.waitUntil(Promise.all([saveToInbox(message), self.registration.showNotification(message.title, { body: message.body, icon: '../icons/icon-192.png', badge: '../icons/icon-192.png', data: { url: message.url }, silent: message.silent === true })]));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // The address is relative to this app's own folder (the scope). A notification sent earlier with "./guest/" would end in .../guest/guest/ (not found): fixed here.
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href.replace('/guest/guest/', '/guest/');
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) { if ('focus' in client) { client.navigate?.(target).catch(() => {}); return client.focus(); } }
    return self.clients.openWindow(target);
  }));
});
