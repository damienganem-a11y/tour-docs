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
import { farewellOf, GUEST_LINK_GRACE_DAYS, guestLinkExpiry } from '../guestSheet.js';
import { NOTIFY_KINDS, notifySettings } from '../notifyRules.js';

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

  // The message guests read once their link has expired (7 days after the trip's last day): a few sentences and, if wanted, a web address.
  const farewell = farewellOf(trip);
  const expiry = guestLinkExpiry(trip);
  const farewellCard = (() => {
    const text = h('textarea', { class: 'text-input', rows: '5', maxlength: '500', 'aria-label': 'Message after the trip' }, farewell.text);
    const website = h('input', { class: 'text-input', type: 'text', value: farewell.website, placeholder: 'Web address, e.g. example-expeditions.com', 'aria-label': 'Web address', maxlength: '100', autocapitalize: 'none', autocorrect: 'off' });
    return h('div', { class: 'card team-member' },
      h('div', { class: 'act-name' }, 'Message after the trip'),
      h('div', { class: 'muted' }, `Guests read it once their link has expired${expiry ? ` (after ${expiry}, ${GUEST_LINK_GRACE_DAYS} days after the last day)` : ''}. Their programme is then removed from the server.`),
      text, website,
      h('div', { class: 'card-actions' }, h('button', { class: 'btn btn--small', type: 'button', onclick: () => run({ type: 'guest-links', action: 'farewell', text: text.value, website: website.value }, 'Message saved') }, 'Save the message')));
  })();

  // A short message to every guest who turned notifications on in their app (needs the one-time setup of supabase/PUSH_SETUP.md).
  const announceCard = (() => {
    const title = h('input', { class: 'text-input', type: 'text', maxlength: '80', placeholder: 'Title, e.g. Change of plan', 'aria-label': 'Notification title' });
    const body = h('textarea', { class: 'text-input', rows: '3', maxlength: '200', placeholder: 'Message (200 letters at most)', 'aria-label': 'Notification message' });
    const important = h('input', { type: 'checkbox', 'aria-label': 'Important' });
    return h('div', { class: 'card team-member' },
      h('div', { class: 'act-name' }, 'Send a message to the guests'),
      h('div', { class: 'muted' }, 'It arrives as a notification on the phones of the guests who turned notifications on in their app.'),
      title, body,
      h('label', { class: 'check-row' }, important, ' Important: arrives with sound, even during the guest\'s quiet night hours'),
      h('div', { class: 'card-actions' }, h('button', { class: 'btn btn--small', type: 'button', onclick: async () => {
        if (!title.value.trim() || !body.value.trim()) { showToast('Write a title and a message.', true); return; }
        try { const r = await ctx.notifyAllGuests(trip.id, title.value.trim(), body.value.trim(), important.checked); showToast(r?.sent > 0 ? `Sent to ${plural(r.sent, 'phone')}` : 'No guest has notifications on yet, or the setup is not done (supabase/PUSH_SETUP.md).', !(r?.sent > 0)); if (r?.sent > 0) { title.value = ''; body.value = ''; } }
        catch { showToast('Could not send. Are you online and signed in?', true); }
      } }, 'Send now')));
  })();

  // Which changes tell the guests by themselves (all on by default). Each switch is saved at once.
  const notifyOn = notifySettings(trip);
  const notifyCard = h('div', { class: 'card team-member' },
    h('div', { class: 'act-name' }, 'What guests are notified about'),
    h('div', { class: 'muted' }, 'Only guests who turned notifications on in their app are told. Each guest can also turn kinds off, and keep the night quiet, in their own app.'),
    ...NOTIFY_KINDS.map((kind) => h('label', { class: 'check-row' },
      h('input', { type: 'checkbox', checked: notifyOn[kind.key], 'aria-label': kind.label, onchange: (event) => run({ type: 'guest-links', action: 'notify-settings', settings: { [kind.key]: event.target.checked } }, event.target.checked ? 'Notification on' : 'Notification off') }),
      ` ${kind.label}`)));
  // How many guests can be reached, and what was sent lately (asks the server; says nothing if it cannot).
  const reach = h('div', { class: 'card team-member' }, h('div', { class: 'act-name' }, 'Notifications sent'), h('div', { class: 'muted' }, 'Checking…'));
  ctx.guestPushOverview?.(trip.id).then((overview) => {
    if (!overview) { reach.lastChild.textContent = 'Not available (sign in online).'; return; }
    reach.replaceChildren(h('div', { class: 'act-name' }, 'Notifications sent'),
      h('div', { class: 'muted' }, `${overview.guests_on} of ${guests.length} guests have notifications on. The others must be told another way.`),
      ...(overview.recent.length === 0 ? [h('div', { class: 'muted' }, 'Nothing sent yet.')] : overview.recent.map((m) => h('div', { class: 'seat-line-row' },
        h('div', {}, h('b', {}, m.title), ` ${m.priority === 'important' ? '(important) ' : ''}· ${m.sent} of ${m.audience} phones`), h('div', { class: 'muted' }, `${m.body} · ${new Date(m.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`)))));
  }).catch(() => { reach.lastChild.textContent = 'Not available right now.'; });

  return h('div', {}, head,
    notice('A guest sees only their own programme: their activities and times, At leisure, and their dinners with their own travel party. Never allergies, notes or other guests.'),
    without.length > 0
      ? h('button', { class: 'btn', type: 'button', onclick: () => run({ type: 'guest-links', action: 'create', guestIds: without.map((g) => g.id) }, `${plural(without.length, 'link')} created`) },
        without.length === guests.length ? 'Create links for everyone' : `Create links for the ${without.length} without one`)
      : null,
    optionsCard, notifyCard, announceCard, reach, farewellCard, statusLine, sendNow,
    h('div', {}, ...guests.map(guestCard)));
}
