// Settings > Guest app (owner only): what guests see and receive in their app, apart from the links themselves (those are in Guest links).
// Other options, which changes send a notification, a message to everyone, what was sent, and the message read after the trip.
// Every change goes through the one change function (changes.js), so it is in the Journal.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { showToast } from '../ui.js';
import { plural } from '../rules.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { farewellOf, GUEST_LINK_GRACE_DAYS, guestLinkExpiry } from '../guestSheet.js';
import { NOTIFY_KINDS, notifySettings } from '../notifyRules.js';

export function guestAppSettingsPage(ctx, trip) {
  const head = pageHead({
    back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
    eyebrow: 'Guest app', title: 'Guest app', subtitle: 'What guests see and receive in their app.',
  });
  if (ctx.roleFor(trip.id) !== 'owner') return h('div', {}, head, notice('Only the owner of a trip manages the guest app.'));

  const guests = trip.guests.filter((g) => !g.leftAt);

  async function run(change, message) {
    const result = await applyChange(ctx, trip.id, change);
    if (result.ok) { ctx.refresh(); showToast(message); } else showToast(result.error, true);
  }

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

  return h('div', {}, head, optionsCard, notifyCard, announceCard, reach, farewellCard);
}
