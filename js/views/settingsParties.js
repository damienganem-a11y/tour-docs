// Settings > Travel parties (step 7c, owner only): every travel party at a glance, and who is in it.
//
// This screen only shows. To change who travels with whom, tap a guest here (or open them from
// Settings > Guests) and use "Change travel party" there — that is the one place a party ever changes,
// so there is only one way to do it, kept simple.

import { h } from '../dom.js';
import { alphabetical, displayNames, plural } from '../rules.js';
import { pageHead } from './chrome.js';

export function partiesSettingsPage(ctx, trip) {
  const names = displayNames(trip.guests);
  const inOrder = alphabetical(names);

  // Every party, with its current members (a party nobody is in anymore — everybody moved away from
  // it — simply is not shown; nothing needs deleting).
  const byParty = new Map();
  for (const guest of trip.guests) {
    if (!byParty.has(guest.partyId)) byParty.set(guest.partyId, []);
    byParty.get(guest.partyId).push(guest);
  }
  const parties = trip.parties
    .map((party) => ({ party, members: (byParty.get(party.id) ?? []).sort(inOrder) }))
    .filter(({ members }) => members.length > 0)
    .sort((a, b) => inOrder(a.members[0], b.members[0]));

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'Settings', title: 'Travel parties',
      subtitle: `${parties.length} travel part${parties.length === 1 ? 'y' : 'ies'} · tap a guest to change it`,
    }),
    h('div', {}, parties.map(({ party, members }) => h('div', { class: 'card' },
      h('div', { class: 'card-row' }, h('div', { class: 'act-name' }, party.type), h('div', { class: 'muted' }, plural(members.length, 'person'))),
      h('div', {}, members.map((g) => h('a', {
        class: 'row', href: `#/trip/${trip.id}/settings/guests/${g.id}`,
      },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, names.get(g.id)),
          g.leftAt ? h('div', { class: 'row-sub' }, 'Left the trip') : null),
        h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›')))))
    )));
}
