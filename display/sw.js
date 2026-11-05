// Reception list and lounge screen (v0.144.0): this small service worker only receives "the tour list changed" notifications for the reception.
// It keeps no copy of the page (the list must always be the latest; the page itself keeps the last list it received for when the wifi drops).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let message = { title: 'The tour list changed', body: 'Open the list and print it again.', url: './' };
  try { message = { ...message, ...event.data.json() }; } catch { /* a push with no readable content: the default */ }
  event.waitUntil(self.registration.showNotification(message.title, { body: message.body, icon: '../icons/icon-192.png', badge: '../icons/icon-192.png', data: { url: message.url }, requireInteraction: true }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) { if ('focus' in client) { client.navigate?.(target).catch(() => {}); return client.focus(); } }
    return self.clients.openWindow(target);
  }));
});
