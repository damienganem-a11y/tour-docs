// The guest app's service worker: keeps the app's own files on the phone so it opens with no internet. (The programme itself is kept by
// guest.js.) Network first, with the kept copy as the fallback. Its scope is this folder only: it never touches the leader's app.
const VERSION = '0.59.0'; // keep equal to GUEST_VERSION in the tests
const CACHE = `tour-docs-guest-${VERSION}`;
const FILES = ['./', 'index.html', 'guest.css', 'guest.js', 'manifest.webmanifest', '../js/supabase-config.js',
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
