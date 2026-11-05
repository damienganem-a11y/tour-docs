// Settings > Reception & screens (v0.144.0, owner's decisions, 5 Nov 2026).
//   Reception link: for the reception desk. The tours of today and tomorrow with every colour and its guests, always up to date, Print / Save as PDF
//                   with a stamp (version, printed when). When the list changes, the reception's screen is told (after 10 quiet minutes).
//   Lounge screen:  for a TV in the lounge (Fire TV stick + a kiosk browser). The same tours in big letters, updating by itself. Guests' names are off
//                   by default (a lounge screen is public); the owner can switch them on.
// Each link covers the whole trip (a cruise: each day another port) or one destination. A link can be switched off (and back on) at any time.
// Owner only: the links live on the server (display_links, migration 0033); the owner's phone keeps what they show up to date.

import { h } from '../dom.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { qrSvg } from '../qr.js';

const KINDS = {
  reception: { title: 'Reception link', what: 'For the reception desk: today\'s and tomorrow\'s tours with every colour and its guests. They print it from there; a stamp on each page says which version it is. Their screen is told when the list changes.' },
  screen: { title: 'Lounge screen', what: 'For a TV in the lounge: the tours of the day in big letters, changing by itself a few seconds after you change anything.' },
};

export function displaysSettingsPage(ctx, trip) {
  const content = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  const root = h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'Guests', title: 'Reception & screens', subtitle: 'Live tour lists for the reception desk and the lounge TV' }),
    content);
  let links = null;
  const scopeName = (id) => (id ? trip.destinations.find((d) => d.id === id)?.name ?? 'one destination' : 'Whole trip');

  async function load() {
    try { links = await ctx.displays.list(trip.id); } catch { links = null; }
    draw();
  }

  function card(link) {
    const kind = KINDS[link.kind];
    const url = ctx.displays.address(link.token, link.kind);
    const copy = async () => { try { await navigator.clipboard.writeText(url); showToast('Link copied'); } catch { showToast('Could not copy: press and hold the link instead', true); } };
    const share = async () => { try { await navigator.share({ title: kind.title, url }); } catch { copy(); } };
    const set = async (fields, done) => { try { await ctx.displays.update(trip.id, link.token, fields); showToast(done); load(); } catch { showToast('Could not change it. Are you online?', true); } };
    return h('div', { class: `card${link.active ? '' : ' card--cancelled'}` },
      h('div', { class: 'card-row' }, h('div', { class: 'act-name' }, link.label || kind.title), h('div', { class: 'muted' }, link.active ? kind.title : 'Switched off')),
      h('div', { class: 'muted' }, `${scopeName(link.destination_id)} · ${link.show_names ? 'with guests\' names' : 'no names'}${link.changed_at ? ` · last change ${new Date(link.changed_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}`),
      link.active ? h('a', { class: 'display-url', href: url, target: '_blank', rel: 'noopener' }, url) : null,
      h('div', { class: 'card-actions' },
        link.active ? h('button', { class: 'btn btn--small', type: 'button', onclick: share }, 'Share the link') : null,
        link.active ? h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => qrSheet(link, url) }, 'QR code') : null,
        link.active && link.kind === 'screen' ? h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => tvHelp(url) }, 'How to set up the TV') : null,
        h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => set({ show_names: !link.show_names }, link.show_names ? 'Names hidden' : 'Names shown') }, link.show_names ? 'Hide names' : 'Show names'),
        h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => set({ active: !link.active }, link.active ? 'Switched off: the link no longer works' : 'Switched on again') }, link.active ? 'Switch off' : 'Switch on')));
  }

  function qrSheet(link, url) {
    const picture = h('div', { class: 'qr-box' });
    picture.innerHTML = qrSvg(url, { pixels: 260 }); // made by qr.js from the link itself
    openSheet({ eyebrow: KINDS[link.kind].title, title: link.label || KINDS[link.kind].title, subtitle: 'Scan it with the reception\'s phone or tablet, or print this page.', body: [picture], cancelLabel: 'Close' });
  }

  function tvHelp(url) {
    openSheet({
      eyebrow: 'Lounge screen', title: 'Set up the TV once',
      body: [
        h('ol', { class: 'steps' },
          h('li', {}, 'Plug an Amazon Fire TV Stick (or a Chromecast with Google TV) into the TV and connect it to the ship\'s wifi.'),
          h('li', {}, 'Install the app "Fully Kiosk Browser" (a few euros). It opens a page full screen, keeps the screen awake, and opens again by itself when the TV is switched on.'),
          h('li', {}, 'In Fully Kiosk, set the Start URL to this link:'),
          h('li', { class: 'steps-url' }, url),
          h('li', {}, 'That is all: when you change a tour or a colour in Tour Docs, the TV shows it a few seconds later.')),
        notice('No Fire TV? Any computer or tablet connected to the TV works: open the link in the browser and go full screen. An Apple TV has no browser, so it would need an iPad or a Mac mirroring the page.'),
      ],
      cancelLabel: 'Close',
    });
  }

  function newSheet(kind) {
    const label = h('input', { class: 'text-input', type: 'text', maxlength: '60', value: kind === 'reception' ? 'Reception' : 'Main lounge', 'aria-label': 'Name' });
    const scope = h('select', { class: 'text-input', 'aria-label': 'Which tours' },
      h('option', { value: '' }, 'Whole trip (a cruise: every port)'),
      trip.destinations.map((d) => h('option', { value: d.id }, `Only ${d.name}`)));
    const names = h('input', { type: 'checkbox', checked: kind === 'reception' ? true : null, 'aria-label': 'Show the guests\' names' });
    const create = h('button', { class: 'btn', type: 'button', onclick: async () => {
      create.disabled = true;
      try {
        await ctx.displays.create(trip.id, { kind, label: label.value.trim(), destinationId: scope.value || null, showNames: names.checked });
        closeSheet(); showToast(`${KINDS[kind].title} made`); load();
      } catch { create.disabled = false; showToast('Could not make it. Are you online, and is the database updated (Check this phone)?', true); }
    } }, 'Make the link');
    openSheet({
      eyebrow: 'Reception & screens', title: `New ${KINDS[kind].title.toLowerCase()}`, subtitle: KINDS[kind].what,
      body: [
        h('label', { class: 'form-label' }, 'Name'), label,
        h('label', { class: 'form-label' }, 'Which tours'), scope,
        h('label', { class: 'check-row' }, names, h('span', {}, kind === 'reception' ? 'Show the guests\' names (reception needs them to check people in)' : 'Show the guests\' names (a lounge screen is public: off is safer)')),
      ],
      footer: [create], cancelLabel: 'Cancel',
    });
  }

  function draw() {
    const owner = ctx.roleFor(trip.id) === 'owner';
    if (!owner) { content.replaceChildren(h('p', { class: 'muted' }, 'Only the owner of the trip makes these links.')); return; }
    if (links === null) {
      content.replaceChildren(notice('The links could not be loaded. You may be offline, or the database is not updated yet (Settings > Check this phone).'), h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: load }, 'Try again'));
      return;
    }
    const section = (kind) => {
      const mine = links.filter((l) => l.kind === kind);
      return [
        h('h2', { class: 'section-title' }, kind === 'reception' ? 'Reception' : 'Lounge screens'),
        h('p', { class: 'muted' }, KINDS[kind].what),
        ...mine.map(card),
        h('button', { class: `btn${mine.length ? ' btn--plain' : ''}`, type: 'button', disabled: Boolean(trip.archivedAt), onclick: () => newSheet(kind) }, kind === 'reception' ? '+ Reception link' : '+ Lounge screen'),
      ];
    };
    content.replaceChildren(
      notice('These pages show tours, times, meeting points and colours (and names when switched on). Never phone numbers, allergies or anything else about a guest.'),
      ...section('reception'), ...section('screen'));
  }

  load();
  return root;
}
