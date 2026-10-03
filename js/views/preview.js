// Preview as another role (owner only): a way to see exactly what a View-only person or a Team colleague sees, without signing out.
// Only the screens change: roleFor() answers with the previewed role, so menus, buttons and notices are those of that role. Nothing can be
// changed while previewing (the one change function refuses), nothing is sent to the server for that role, and nothing about the account
// changes: "Exit preview" brings the owner back at once. The preview ends by itself when the app is closed (kept per browser tab only).

import { h } from '../dom.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { alphabetical, displayNames } from '../rules.js';
import { buildGuestSheet } from '../guestSheet.js';

const LABEL = { viewer: 'View only', team: 'Team' };

// Preview as a GUEST: builds that guest's sheet from the trip as it is right now, hands it to the guest app on this phone (nothing goes to the
// server, no link is used) and opens the guest app on it. The guest app shows a bar to come back here.
export const GUEST_PREVIEW_KEY = 'tourdocs.guest.preview';
function openGuestPreview(ctx, trip) {
  if (!trip) {
    const trips = ctx.trips.filter((t) => !t.deletedAt && t.guests.length > 0);
    openSheet({
      eyebrow: 'Preview as a guest', title: 'Which trip?',
      body: trips.map((t) => h('button', { class: 'btn btn--plain', type: 'button', onclick: () => openGuestPreview(ctx, t) }, t.name)),
    });
    return;
  }
  const names = displayNames(trip.guests);
  const guests = trip.guests.filter((g) => !g.leftAt).sort(alphabetical(names));
  const select = h('select', { class: 'text-input', 'aria-label': 'Guest' }, guests.map((g) => h('option', { value: g.id }, names.get(g.id))));
  const open = h('button', {
    class: 'btn', type: 'button',
    onclick: () => {
      const guest = guests.find((g) => g.id === select.value);
      try { localStorage.setItem(GUEST_PREVIEW_KEY, JSON.stringify(buildGuestSheet(trip, guest, new Date().toISOString()))); } catch { showToast('Could not prepare the preview.', true); return; }
      location.href = new URL('guest/?preview=1', location.href).href;
    },
  }, 'Open the guest app as this guest');
  openSheet({
    eyebrow: 'Preview as a guest', title: trip.name,
    subtitle: 'The guest app, exactly as this guest sees it, from the trip as it is now. Nothing is sent anywhere.',
    body: [select, open],
  });
}

// The sheet that starts a preview. `trip` is the trip being looked at (from Settings), or none (from the Trips screen).
export function openPreviewSheet(ctx, trip = null) {
  const choice = (role, text) => h('button', { class: 'btn btn--plain', type: 'button', onclick: () => { closeSheet(); ctx.setPreview(role); ctx.go('#/'); } },
    h('div', {}, LABEL[role]), h('div', { class: 'muted', style: 'font-size:14px;font-weight:400;margin-top:2px;' }, text));
  openSheet({
    eyebrow: 'Preview', title: 'See the app as someone else',
    subtitle: 'You stay signed in as yourself.',
    body: [
      choice('viewer', 'Sees the trip and its documents. Nothing can be changed.'),
      choice('team', 'Works on bookings and roll call. What you do here is REALLY applied, as a test request from "Preview (Team)", and shows in the Journal. Undo takes it back.'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => openGuestPreview(ctx, trip) }, h('div', {}, 'Guest'), h('div', { class: 'muted', style: 'font-size:14px;font-weight:400;margin-top:2px;' }, 'The guest app: choose any guest and see their programme.')),
    ],
  });
}

// The bar shown above every screen while a preview is on; null otherwise.
export function previewBar(ctx) {
  const role = ctx.previewRole;
  if (!role) return null;
  return h('div', { class: 'preview-bar', role: 'status' },
    h('span', {}, role === 'team' ? 'Previewing as Team: changes are real test requests' : 'Previewing as View only'),
    h('button', { type: 'button', onclick: () => { ctx.setPreview(null); ctx.go('#/'); } }, 'Exit preview'));
}
