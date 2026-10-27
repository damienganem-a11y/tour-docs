// "Add this app to your Home Screen" (owner's request, 27 Oct 2026). When a guest opens their link (from a QR code or a web link) in the phone's browser, a short
// sheet explains why the app is better on the Home Screen and offers to do it:
//   - Android (Chrome and friends): a real "Add to Home Screen" button, which opens the phone's own install question straight away.
//   - iPhone and iPad: Apple gives websites NO way to start it, so the button opens three plain steps (Share, "Add to Home Screen", "Add"). Opened inside another
//     app (Messages, WhatsApp, Instagram...), the phone cannot do it at all: the sheet says to open the link in Safari first, and can copy the link.
//   - "Continue in the browser" always works; the offer comes back after 3 days, at most 3 times; a small row on Today lets a guest reopen it any time.
// Nothing here changes the guest's data: it only shows a sheet. The decisions (which phone is this, when to offer) are pure functions, checked by the leader's tests.

const KEY = 'tourdocs.guest.install';        // { dismissedAt, times }
const AGAIN_AFTER_MS = 3 * 86400000;
const MAX_OFFERS = 3;

// Which phone and browser is this? Returns 'installed' | 'ios-safari' | 'ios-inapp' | 'android-prompt' | 'android' | 'desktop'.
//   env = { ua, standalone (already on the Home Screen), touchMac (an iPad that says it is a Mac), canPrompt (the browser gave us its install question) }
export function installPlatform({ ua = '', standalone = false, touchMac = false, canPrompt = false } = {}) {
  if (standalone) return 'installed';
  const ios = /iPhone|iPad|iPod/.test(ua) || touchMac;
  if (ios) {
    // Inside Facebook, Instagram, Messenger, Line, Snapchat, TikTok or a web view without "Safari" in its name: no "Add to Home Screen" there.
    const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|Messenger|MicroMessenger|GSA\//.test(ua) || !/Safari/.test(ua);
    return inApp ? 'ios-inapp' : 'ios-safari';
  }
  if (/Android/.test(ua)) return canPrompt ? 'android-prompt' : 'android';
  return 'desktop';
}

// Should the sheet open by itself now? saved = what was stored ({ dismissedAt, times }).
export function shouldOffer(platform, saved, now = Date.now()) {
  if (platform === 'installed' || platform === 'desktop') return false;
  if (!saved?.dismissedAt) return true;
  return (saved.times ?? 1) < MAX_OFFERS && now - saved.dismissedAt >= AGAIN_AFTER_MS;
}

export const readOffer = (store) => { try { return JSON.parse(store.get(KEY)) ?? null; } catch { return null; } };
const rememberDismissed = (store) => { const old = readOffer(store); store.set(KEY, JSON.stringify({ dismissedAt: Date.now(), times: (old?.times ?? 0) + 1 })); };

// The words, per platform.
const SHARE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H16"/></svg>';
export const INSTALL_STEPS = {
  'ios-safari': [['Tap the Share button', 'the square with an arrow, at the bottom of Safari (at the top on an iPad)', true], ['Scroll down and tap "Add to Home Screen"', null], ['Tap "Add"', 'then open the app from your Home Screen']],
  'ios-inapp': [['Open this link in Safari first', 'You opened it inside another app, which cannot add it to the Home Screen. Tap the Safari icon (a compass), or the "…" menu, then "Open in Safari".'], ['Then tap Share, "Add to Home Screen", "Add"', null]],
  android: [['Open your browser\'s menu', 'the three dots at the top right'], ['Tap "Add to Home screen" or "Install app"', null], ['Tap "Add"', null]],
};
export const INSTALL_BENEFITS = ['It opens like any app, with one tap', 'Your programme stays available without internet', 'You can be told when something changes'];

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value; else if (key.startsWith('on')) node.addEventListener(key.slice(2), value); else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}

// Opens the sheet. deps = { store, tripName, platform, prompt (the browser's install question or null), copyLink () }. `manual` = opened by the guest (no "later" memory kept).
export function openInstallSheet({ store, tripName, platform, prompt, manual = false }) {
  if (document.querySelector('.install-sheet')) return;
  const close = (remember) => { if (remember && !manual) rememberDismissed(store); overlay.remove(); };
  const card = el('div', { class: 'install-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add to Home Screen' });
  const overlay = el('div', { class: 'install-sheet', onclick: (e) => { if (e.target === overlay) close(true); } }, card);

  const showSteps = () => {
    const steps = INSTALL_STEPS[platform] ?? INSTALL_STEPS.android;
    const copied = el('p', { class: 'install-note', role: 'status' });
    card.replaceChildren(...[
      el('h2', {}, 'Add it to your Home Screen'),
      el('ol', { class: 'install-steps' }, steps.map(([title, detail, share]) => el('li', {}, el('b', {}, title, share ? el('span', { class: 'install-share', 'aria-hidden': 'true' }) : null), detail ? el('span', {}, detail) : null))),
      platform === 'ios-safari' ? el('p', { class: 'install-note' }, 'Do it now, while your programme is open: the app then opens straight on it.') : null,
      platform === 'ios-inapp' ? el('button', { class: 'install-link', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(location.href); copied.textContent = 'Link copied. Open Safari and paste it in the address bar.'; } catch { copied.textContent = 'Could not copy. Press and hold the address to copy it.'; } } }, 'Copy my link') : null,
      copied,
      el('button', { class: 'install-main', type: 'button', onclick: () => close(true) }, 'Got it')].filter(Boolean));
    // the little Share icon is a fixed picture made here, never typed text
    const slot = card.querySelector('.install-share'); if (slot) slot.innerHTML = SHARE_ICON;
  };

  const primary = platform === 'android-prompt'
    ? el('button', { class: 'install-main', type: 'button', onclick: async () => { try { prompt.prompt(); await prompt.userChoice; } catch { /* the phone decides */ } close(false); } }, 'Add to Home Screen')
    : el('button', { class: 'install-main', type: 'button', onclick: showSteps }, platform === 'ios-inapp' ? 'Show me how' : 'Show me how');
  card.append(
    el('small', {}, tripName),
    el('h2', {}, 'Get the most out of this app'),
    el('p', {}, 'Add it to your Home Screen. It takes ten seconds.'),
    el('ul', { class: 'install-benefits' }, INSTALL_BENEFITS.map((b) => el('li', {}, b))),
    primary,
    el('button', { class: 'install-link', type: 'button', onclick: () => close(true) }, 'Continue in the browser'));
  document.body.append(overlay);
}
