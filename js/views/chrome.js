// Pieces shared by several screens.

import { h } from '../dom.js';
import { openSheet, closeSheet } from '../ui.js';
import { openOnlineSignIn } from './onlineSignIn.js';

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
// The destination chooser (Touring, Dining): one button showing where you are; tapping it lists the destinations, a tap on one goes there. It
// replaces a long sideways strip: in the field you jump from place to place to check things, so a list is quicker than scrolling.
// items: [{ label, sub, href, active }]
export function destinationMenu(items, { eyebrow = 'Destination' } = {}) {
  const here = items.find((i) => i.active) ?? items[0];
  return h('button', {
    class: 'dest-menu', type: 'button', 'aria-haspopup': 'dialog',
    onclick: () => openSheet({
      eyebrow, title: 'Where to?', cancelLabel: 'Close',
      body: h('div', { class: 'menu' }, items.map((i) => h('a', { class: `menu-row${i.active ? ' is-current' : ''}`, href: i.href, onclick: () => closeSheet() },
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, i.label), i.sub ? h('span', { class: 'menu-hint' }, i.sub) : null),
        h('span', { class: 'menu-side' }, i.active ? h('span', { class: 'here-tick' }, '✓') : null)))),
    }),
  }, h('span', { class: 'dest-menu-pin' }, '⌖'), h('span', { class: 'dest-menu-text' }, h('span', { class: 'dest-menu-name' }, here?.label ?? ''), here?.sub ? h('span', { class: 'dest-menu-sub' }, here.sub) : null), h('span', { class: 'dest-menu-chev' }, '⌄'));
}

// "Day 3–4 · Peru": what a destination line in the chooser says under its name.
export function destinationSub(trip, destination) {
  const days = trip.slots.filter((x) => x.destinationId === destination.id).map((x) => x.day);
  const range = days.length === 0 ? '' : Math.min(...days) === Math.max(...days) ? `Day ${days[0]}` : `Day ${Math.min(...days)}–${Math.max(...days)}`;
  return [range, destination.country].filter(Boolean).join(' · ');
}

// A title with its last word in the accent italic ("Siem <em>Reap</em>"), for destination names. A one-word title is left as it is.
export function accentTitle(text) {
  const words = String(text).split(' ');
  if (words.length < 2) return text;
  return [`${words.slice(0, -1).join(' ')} `, h('em', {}, words[words.length - 1])];
}

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
// Online but with no live online login: nothing is syncing, so it must not look like "Online". It lights
// the red dot, with its own word (see app.js's syncStatus).
const NO_LOGIN = { key: 'nologin', label: 'Not signed in' };
export function syncDot(ctx, { compact = false } = {}) {
  const status = ctx.syncStatus;
  const label = [...SYNC_STATES, NO_LOGIN].find((s) => s.key === status).label;
  const lit = status === 'nologin' ? 'offline' : status;
  // A button: tapping the light opens "Sync details" (what is really going on, in plain words).
  return h('button', { class: 'sync-lights', type: 'button', 'aria-label': `${label}. Tap for sync details`, title: label, onclick: () => syncDetailsSheet(ctx) },
    h('span', { class: 'sync-lights-dots' },
      SYNC_STATES.map((s) => h('span', { class: `sync-light sync-light--${s.key}${s.key === lit ? ' is-on' : ''}` }))),
    compact ? null : h('span', { class: `sync-lights-label sync-lights-label--${status}` }, label));
}

// Sync only works with a live online login in THIS browser (see sync.js's diagnoseSync), and when it
// does not, nothing else in the app says so. This sheet asks the server and explains, in plain words.
function syncDetailsSheet(ctx) {
  const box = h('div', { class: 'sync-details' }, h('p', { class: 'muted' }, 'Checking...'));
  openSheet({ eyebrow: 'Sync', title: 'Sync details', body: box, cancelLabel: 'Close' });
  ctx.syncDetails().then((result) => {
    box.replaceChildren(
      h('p', { class: `sync-details-headline${result.ok ? '' : ' is-problem'}` }, result.headline),
      ...result.lines.map((line) => h('p', { class: 'muted' }, line)),
      ...(result.needsSignIn ? [h('button', { class: 'btn', type: 'button', onclick: () => openOnlineSignIn(ctx) }, 'Sign in online')] : []));
  });
}

// The small sheet every "Export" button opens to ask PDF or Excel (SPEC.md, "5. Export"): tapping
// either one closes the sheet and runs `format => ...` with 'pdf' or 'xlsx'.
// dietary: true adds the "Include dietary needs" switch (reservation sheets only), off every time the
// sheet opens; run then receives ({ includeDietary }) as its second argument.
export function exportFormatSheet(run, { dietary = false } = {}) {
  const box = dietary ? h('input', { type: 'checkbox', 'aria-label': 'Include dietary needs' }) : null;
  const go = (format) => { closeSheet(); run(format, { includeDietary: Boolean(box?.checked) }); };
  openSheet({
    title: 'Export as...',
    body: [
      ...(dietary ? [
        h('label', { class: 'tick-row' }, box, h('span', {}, 'Include dietary needs (allergies)')),
        h('p', { class: 'muted' }, 'Only for the restaurant. The file is kept in Documents, named “with dietary”.'),
      ] : []),
      h('button', { class: 'btn', type: 'button', onclick: () => go('pdf') }, 'PDF — for WhatsApp and printing'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => go('xlsx') }, 'Excel (.xlsx) — to edit the list further'),
    ],
  });
}
