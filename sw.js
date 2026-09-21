// The service worker: what makes Tour Docs work without internet.
//
// It keeps a copy of every file of the app on the phone. Later, with no network at all (a plane,
// a bus in the desert), the phone opens the app from that copy. The trips you work on are stored
// separately, by the app itself (see js/db.js).
//
// How it behaves:
//   - First visit with internet: all the files below are copied (the "install" step).
//   - Later, WITH internet: it asks the network first, so a new version you uploaded arrives
//     straight away, and it refreshes its copy. If the network is very slow (over 3 seconds), it
//     uses its copy instead of making you wait.
//   - Later, WITHOUT internet: it uses its copy. Once the network has failed, it does not try it again
//     for 30 seconds, so the app opens fast instead of waiting for a timeout on every single file.
//
// When you add a file to the app, add it to FILES below. The tests page checks that the list is
// complete (a file missing from the list is the classic reason an app fails offline).

const VERSION = '0.5.3'; // keep equal to js/version.js
const CACHE = `tour-docs-${VERSION}`;
const SLOW = 3000;        // milliseconds to wait for the network before using the copy
const PAUSE = 30000;      // after the network failed once, do not try it again for this long (milliseconds)
let networkDownUntil = 0; // until when we skip the network (see answer() below)

const FILES = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/tour_docs_sample_trip_ZX-01.json',
  'js/app.js',
  'js/changes.js',
  'js/db.js',
  'js/dom.js',
  'js/gate.js',
  'js/ids.js',
  'js/journal.js',
  'js/loader.js',
  'js/passcode-config.js',
  'js/rules.js',
  'js/time.js',
  'js/ui.js',
  'js/users.js',
  'js/version.js',
  'js/views/chrome.js',
  'js/views/destination.js',
  'js/views/guest.js',
  'js/views/journal.js',
  'js/views/move.js',
  'js/views/passcode.js',
  'js/views/trip.js',
  'js/views/trips.js',
  'js/views/undo.js',
  'js/views/welcome.js',
];

// Install: copy every file (fresh from the network, never from the browser's own short-term memory).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting()) // start using this version straight away
  );
});

// Activate: throw away the copies of older versions, and take charge of the open pages.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// Every request for a file of the app: network first, copy if the network fails or is slow.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(answer(request));
});

async function answer(request) {
  const cache = await caches.open(CACHE);
  // The page itself is asked for as "./" or as "index.html": both are the same file.
  const copy = () => cache.match(request, { ignoreSearch: true }).then((found) => found ?? (request.mode === 'navigate' ? cache.match('index.html') : undefined));

  // Airplane mode, or the network failed a moment ago: go straight to the copy. Without this, every file
  // of the app would wait for its own timeout, one after the other, and the app would take ages to open.
  const networkLooksDown = navigator.onLine === false || Date.now() < networkDownUntil;

  if (!networkLooksDown) {
    try {
      const fromNetwork = await withTimeout(fetch(request.url, { cache: 'no-cache' }), SLOW);
      if (fromNetwork.ok) cache.put(request, fromNetwork.clone()); // keep our copy fresh
      return fromNetwork;
    } catch {
      networkDownUntil = Date.now() + PAUSE; // no network, or too slow: use the copy, and stop waiting for a while
    }
  }

  const found = await copy();
  if (found) return found;
  return new Response('Offline, and this file was not saved yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

// Gives up on a request that takes too long, so a bad connection never blocks the app.
function withTimeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('too slow')), milliseconds);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
