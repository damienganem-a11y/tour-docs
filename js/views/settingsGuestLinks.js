// Settings > Guest links (owner only): a personal link per guest, for the guest app (Phase 5).
//
// A link opens the guest's own programme and nothing else. It holds a long random secret (see ids.js newToken), so it cannot be
// guessed; whoever has the link sees that guest's programme, so the owner can switch a link off at any moment, or make a new one
// (the old one then stops working). The programme itself is a small "sheet" the owner's phone sends to the server (guestSheet.js).
//
// Every change goes through the one change function (changes.js), so it is in the Journal. It cannot be undone with Undo: a link that
// was renewed must not come back; switching one off and on again does the same job.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { showToast, openSheet, closeSheet } from '../ui.js';
import { alphabetical, displayNames, plural } from '../rules.js';
import { formatFullMoment } from '../time.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { qrSvg } from '../qr.js';

// Where the guest app lives: the "guest" folder next to this app. The secret goes after the "#", which a browser never sends to
// the web server, so it does not appear in any server log.
const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function guestLinkUrl(token) {
  return `${new URL('guest/', window.location.href).href}#${token}`;
}

export function guestLinksSettingsPage(ctx, trip) {
  const head = pageHead({
    back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
    eyebrow: 'Guest links', title: 'Guest links', subtitle: 'A personal link for each guest, to see their own programme.',
  });
  if (ctx.roleFor(trip.id) !== 'owner') return h('div', {}, head, notice('Only the owner of a trip manages the guest links.'));

  const names = displayNames(trip.guests);
  const guests = trip.guests.filter((g) => !g.leftAt).sort(alphabetical(names));
  const links = trip.guestLinks ?? {};
  const without = guests.filter((g) => !links[g.id]);

  async function run(change, message) {
    const result = await applyChange(ctx, trip.id, change);
    if (result.ok) { ctx.refresh(); showToast(message); } else showToast(result.error, true);
  }

  // Copies the link; on a phone, the share sheet is more useful (Messages, WhatsApp, Mail), so it is offered too.
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); showToast('Link copied'); } catch { showToast('Could not copy. Use Share instead.', true); }
  }
  async function share(guest, url) {
    try { await navigator.share({ title: trip.name, text: `${guest.first}, your programme for ${trip.name}:`, url }); } catch { /* cancelled: nothing to do */ }
  }

  // The link as a QR code, to show on the phone for the guest to scan, or to print. Drawn right here, no internet needed.
  function qrSheet(guest, url) {
    const picture = h('div', { class: 'qr-box' });
    picture.innerHTML = qrSvg(url, { pixels: 260 }); // the picture is made by qr.js from the link, nothing typed by anyone
    openSheet({
      eyebrow: 'QR code', title: guest.first, subtitle: 'Ask the guest to point their camera at it.',
      body: [picture, h('p', { class: 'muted qr-url' }, url)],
    });
  }

  function renewSheet(guest) {
    openSheet({
      eyebrow: 'New link', title: `New link for ${guest.first}?`,
      subtitle: 'The old link stops working at once. Send the new one to the guest.',
      body: h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); run({ type: 'guest-links', action: 'renew', guestIds: [guest.id] }, 'New link made'); } }, 'Make a new link'),
    });
  }

  function guestCard(guest) {
    const link = links[guest.id];
    const card = h('div', { class: 'card team-member' }, h('div', { class: 'act-name' }, names.get(guest.id)));
    if (!link) {
      card.append(h('div', { class: 'muted' }, 'No link yet'),
        h('div', { class: 'card-actions' },
          h('button', { class: 'btn btn--small', type: 'button', onclick: () => run({ type: 'guest-links', action: 'create', guestIds: [guest.id] }, 'Link created') }, 'Create link')));
      return card;
    }
    const url = guestLinkUrl(link.token);
    card.append(h('div', { class: 'muted' }, link.active ? 'Link is on' : 'Link is switched off'));
    if (link.active) {
      card.append(h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => copy(url) }, 'Copy link'),
        h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => qrSheet(guest, url) }, 'QR code'),
        navigator.share ? h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => share(guest, url) }, 'Share') : null));
    }
    card.append(h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => run({ type: 'guest-links', action: link.active ? 'switch-off' : 'switch-on', guestIds: [guest.id] }, link.active ? 'Link switched off' : 'Link switched on') }, link.active ? 'Switch off' : 'Switch on'),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => renewSheet(guest) }, 'New link')));
    return card;
  }

  // How the last sending of the sheets to the server went, so a problem is visible instead of silent.
  const status = ctx.guestSheetStatus();
  const statusLine = h('p', { class: 'muted count-line' },
    status.error ? `The programmes could not be sent to the server: ${status.error}`
      : status.lastOkAt ? `Programmes sent to the server ${formatFullMoment(status.lastOkAt, localTimeZone())}.`
      : Object.keys(links).length ? 'Programmes are sent to the server whenever you are online and something changes.' : '');
  const sendNow = Object.keys(links).length > 0
    ? h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: async () => { const s = await ctx.resendGuestSheets(trip.id); ctx.refresh(); showToast(s.error ? 'Could not send. Are you online?' : 'Programmes sent', Boolean(s.error)); } }, 'Send programmes now')
    : null;

  // Whether guests see, next to each tour they are booked on, the other tours offered in the same half-day (read only: asking for a change comes later).
  const optionsOn = trip.guestOptions !== false;
  const optionsCard = h('div', { class: 'card team-member' },
    h('div', { class: 'act-name' }, 'Show guests their other options'),
    h('div', { class: 'muted' }, optionsOn ? 'On: a guest sees a button "Other options" under each tour they are booked on.' : 'Off: a guest sees only what they are booked on.'),
    h('div', { class: 'card-actions' }, h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => run({ type: 'guest-links', action: optionsOn ? 'options-off' : 'options-on' }, optionsOn ? 'Other options hidden' : 'Other options shown') }, optionsOn ? 'Switch off' : 'Switch on')));

  return h('div', {}, head,
    notice('A guest sees only their own programme: their activities and times, At leisure, and their dinners with their own travel party. Never allergies, notes or other guests.'),
    without.length > 0
      ? h('button', { class: 'btn', type: 'button', onclick: () => run({ type: 'guest-links', action: 'create', guestIds: without.map((g) => g.id) }, `${plural(without.length, 'link')} created`) },
        without.length === guests.length ? 'Create links for everyone' : `Create links for the ${without.length} without one`)
      : null,
    optionsCard, statusLine, sendNow,
    h('div', {}, ...guests.map(guestCard)));
}
