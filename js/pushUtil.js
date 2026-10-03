// Small, pure helpers for Web Push, shared by the leader's app and the guest app (no network and no page here, so the tests can check them).

// The public key comes as URL-safe base64 text; the browser wants bytes.
export function urlBase64ToUint8Array(text) {
  const padded = `${text}${'='.repeat((4 - (text.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// What the server needs from a subscription: where to send, and the two keys. (From subscription.toJSON().)
export function subscriptionFields(subscription) {
  const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
  return { endpoint: json.endpoint, p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' };
}

// Can this phone get notifications from this app, and what must be done first? On an iPhone a web app only gets them once it has been added to the
// Home Screen (iOS 16.4 or later); elsewhere the browser itself is enough.
//   { supported, needsInstall, denied }
export function pushCapability(env = { navigator, window, Notification: globalThis.Notification }) {
  const nav = env.navigator;
  const win = env.window;
  const iphone = /iphone|ipad/i.test(nav.userAgent || '');
  const installed = nav.standalone === true || (win.matchMedia ? win.matchMedia('(display-mode: standalone)').matches : false);
  const apis = 'serviceWorker' in nav && 'PushManager' in win && env.Notification !== undefined;
  return { supported: apis || (iphone && !installed), needsInstall: iphone && !installed, denied: env.Notification?.permission === 'denied' };
}
