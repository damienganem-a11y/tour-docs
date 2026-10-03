// Preview as another role (owner only): a way to see exactly what a View-only person or a Team colleague sees, without signing out.
// Only the screens change: roleFor() answers with the previewed role, so menus, buttons and notices are those of that role. Nothing can be
// changed while previewing (the one change function refuses), nothing is sent to the server for that role, and nothing about the account
// changes: "Exit preview" brings the owner back at once. The preview ends by itself when the app is closed (kept per browser tab only).

import { h } from '../dom.js';
import { openSheet, closeSheet } from '../ui.js';

const LABEL = { viewer: 'View only', team: 'Team' };

// The sheet that starts a preview.
export function openPreviewSheet(ctx) {
  const choice = (role, text) => h('button', { class: 'btn btn--plain', type: 'button', onclick: () => { closeSheet(); ctx.setPreview(role); ctx.go('#/'); } },
    h('div', {}, LABEL[role]), h('div', { class: 'muted', style: 'font-size:14px;font-weight:400;margin-top:2px;' }, text));
  openSheet({
    eyebrow: 'Preview', title: 'See the app as someone else',
    subtitle: 'You stay signed in as yourself.',
    body: [
      choice('viewer', 'Sees the trip and its documents. Nothing can be changed.'),
      choice('team', 'Works on bookings and roll call. What you do here is REALLY applied, as a test request from "Preview (Team)", and shows in the Journal. Undo takes it back.'),
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
