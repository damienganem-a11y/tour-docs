// The account sheet: what belongs to this phone and this person, not to a trip (owner's request, 18 Oct 2026: reachable from inside a trip too,
// not only from the Trips screen). Opened from the avatar (the first letter of the owner's name).
// `extraRows` are added by the screen that opens it (the Trips screen adds "Reset the demo", which needs its sample loader).

import { h } from '../dom.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { APP_VERSION } from '../version.js';
import { openPreviewSheet } from './preview.js';
import { notificationsCard } from './settingsRequests.js';

const row = (title, hint, run, extra = null) => h('button', { class: 'menu-row', type: 'button', onclick: run },
  h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, title), hint ? h('span', { class: 'menu-hint' }, hint) : null),
  h('span', { class: 'menu-side' }, extra, h('span', { class: 'row-chev' }, '›')));

// Can the app open without internet? (Yes once its files are saved on the phone: after one visit with internet.)
export function offlineStatus() {
  if (!('serviceWorker' in navigator)) return 'offline needs https';
  return navigator.serviceWorker.controller ? 'works offline' : 'open it once more to work offline';
}

export function avatarButton(ctx, extraRows = []) {
  return h('button', { class: 'avatar', type: 'button', 'aria-label': 'Account', onclick: () => openAccountSheet(ctx, extraRows) }, (ctx.owner.name || '?').trim().slice(0, 1).toUpperCase());
}

export function openAccountSheet(ctx, extraRows = []) {
  const faceId = !ctx.biometricAvailable ? null
    : ctx.biometricOn
      ? row('Face ID / Touch ID', 'On: asked every time the app is reopened', async () => { await ctx.disableBiometric(); closeSheet(); }, h('span', { class: 'muted' }, 'Turn off'))
      : row('Face ID / Touch ID', 'Off', async () => {
        try { await ctx.enableBiometric(); closeSheet(); showToast('Face ID / Touch ID is on: it will be offered every time the app is reopened.'); }
        catch (error) { showToast(`Could not turn on Face ID / Touch ID (${error.message}).`, true); }
      }, h('span', { class: 'muted' }, 'Turn on'));
  openSheet({
    eyebrow: 'Account', title: ctx.owner.name, subtitle: 'This phone', cancelLabel: 'Close',
    body: [
      h('div', { class: 'menu' },
        row('Notifications', 'Turn them on, send a test', () => { closeSheet(); openSheet({ eyebrow: 'This phone', title: 'Notifications', body: [notificationsCard(ctx)], cancelLabel: 'Close' }); }),
        faceId,
        ctx.previewRole ? null : row('Preview as…', 'View only, Team or Guest', () => { closeSheet(); openPreviewSheet(ctx); }),
        ...extraRows.map((r) => row(r.title, r.hint, () => { closeSheet(); r.run(); })),
        row('Sign out', null, () => { closeSheet(); ctx.signOut(); })),
      // So you can see at once which version is on the phone, and whether it can work offline.
      h('p', { class: 'muted footer-note' }, `Tour Docs ${APP_VERSION} · ${offlineStatus()}`),
    ],
  });
}
