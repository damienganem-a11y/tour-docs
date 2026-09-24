// Pieces shared by several screens.

import { h } from '../dom.js';
import { openSheet, closeSheet } from '../ui.js';

// The top of a screen: an optional "‹ back" link, a small label, the big title, a line of detail.
// action: an optional button shown on the right of the title, taking all the room that is left
// (the Undo button uses this). The line of detail then goes underneath, across the full width —
// unless tightSubtitle is set, which tucks it under the title instead, inside that column, so a
// short subtitle (just a date, say) does not sit below a taller action button, wasting the room
// beside it that the action button does not fill.
// title is optional: a list screen already named by its eyebrow and its bottom tab (By guest, By
// destination) does not need to repeat itself in a second, bigger heading. With no title, the
// eyebrow sits right above the action (Sort/Undo) — its own line, but tight against it (see
// .page-head-eyebrow-only in styles.css), since squeezing both onto one row leaves the action's
// own content (e.g. Sort + Undo together) too little room and forces an awkward wrap.
export function pageHead({ back, eyebrow, title, subtitle, action, tightSubtitle = false }) {
  const eyebrowEl = eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null;
  const detail = subtitle ? h('div', { class: 'subtitle' }, subtitle) : null;
  const backLink = back ? h('a', { class: 'back-link', href: back.href }, `‹ ${back.label}`) : null;

  if (!title) {
    return h('header', { class: 'page-head page-head-eyebrow-only' }, backLink, eyebrowEl, action, detail);
  }

  const heading = h('div', { class: 'page-head-text' }, eyebrowEl, h('h1', { class: 'title' }, title), tightSubtitle ? detail : null);
  return h('header', { class: 'page-head' },
    backLink,
    action ? h('div', { class: 'page-head-row' }, heading, action) : heading,
    tightSubtitle ? null : detail
  );
}

// A small traffic light showing whether trips are backed up to the owner's account right now
// (Phase 2, step 2a): green = online and everything pushed, orange = online with a push still in
// flight, red = no internet. All three lights are always shown, left to right, green/orange/red —
// only the one matching the current state is lit — plus a word next to them, since a single dot
// that just changes color was hard to read at a glance (a single green dot looks the same whether
// it just turned green or has been green the whole time). It never blocks or asks anything.
// compact drops the word (kept only as the aria-label/tooltip): the top bar inside a trip already
// has the back link, the Use/Settings switch and the trip code fighting for room on one line, and
// which light is lit is already unambiguous on its own there.
const SYNC_STATES = [
  { key: 'synced', label: 'Online' },
  { key: 'pending', label: 'Loading' },
  { key: 'offline', label: 'Offline' },
];
export function syncDot(ctx, { compact = false } = {}) {
  const status = ctx.syncStatus;
  const label = SYNC_STATES.find((s) => s.key === status).label;
  return h('span', { class: 'sync-lights', role: 'status', 'aria-label': label, title: label },
    h('span', { class: 'sync-lights-dots' },
      SYNC_STATES.map((s) => h('span', { class: `sync-light sync-light--${s.key}${s.key === status ? ' is-on' : ''}` }))),
    compact ? null : h('span', { class: `sync-lights-label sync-lights-label--${status}` }, label));
}

// The small sheet every "Export" button opens to ask PDF or Excel (SPEC.md, "5. Export"): tapping
// either one closes the sheet and runs `format => ...` with 'pdf' or 'xlsx'.
export function exportFormatSheet(run) {
  const go = (format) => { closeSheet(); run(format); };
  openSheet({
    title: 'Export as...',
    body: [
      h('button', { class: 'btn', type: 'button', onclick: () => go('pdf') }, 'PDF — for WhatsApp and printing'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => go('xlsx') }, 'Excel (.xlsx) — to edit the list further'),
    ],
  });
}
