// Special requests on the staff app (v0.155.0, owner's request of 20 Nov 2026). The rules and words are in services.js; every change goes through
// applyChange ('service'), so it is in the journal and can be undone.
//   - "New request" (a guest's page, the list, Menu): who, what, which stop, when (exact, after, before, a half-day, any time), how long, details, price.
//   - The Advance of the stop (or the owner) answers: Confirm (time, place, who, price), Propose another time, or Not possible.
//   - The list: what needs YOUR answer first, then what waits, what is confirmed; closed ones folded.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { displayNames, alphabetical } from '../rules.js';
import { pageHead, destinationSub } from './chrome.js';
import { undoButton } from './undo.js';
import { SERVICE_UNDO_SCOPE } from '../journal.js';
import { face } from './faceUi.js';
import { currentSlot } from './destination.js';
import { putIn } from '../put.js';
import { SERVICE_KINDS, WHEN_MODES, LENGTHS, CURRENCIES, kindLabel, serviceLine, whenText, fixedText, priceText, STATUS_WORDS, serviceSettings, servicesToAnswer, guestView } from '../services.js';

let stopFilter = 'all';

const stopDates = (trip, destinationId) => [...new Set(trip.slots.filter((x) => x.destinationId === destinationId).map((x) => x.date))].sort();
const guestsText = (trip, s) => { const names = displayNames(trip.guests); return s.guestIds.map((id) => names.get(id)).filter(Boolean).join(', '); };
const field = (label, ...control) => h('label', { class: 'form-field' }, h('span', { class: 'form-label' }, label), ...control);
const select = (options, value, attrs = {}) => h('select', { class: 'text-input', ...attrs }, options.map(([v, label]) => h('option', { value: String(v), selected: String(v) === String(value ?? '') ? '' : null }, label)));

async function act(ctx, trip, s, change, done) {
  const result = await applyChange(ctx, trip.id, { type: 'service', destinationId: s?.destinationId ?? change.destinationId, serviceId: s?.id, ...change });
  if (result.ok) { closeSheet(); ctx.refresh(); if (done) showToast(done); } else showToast(result.error, true);
  return result.ok;
}

// ---------- The form: a new request, or changing one ----------
export function openServiceForm(ctx, tripId, { guestIds = [], service = null } = {}) {
  const trip = ctx.trip(tripId);
  const names = displayNames(trip.guests);
  const settings = serviceSettings(trip);
  const chosen = new Set(service?.guestIds ?? guestIds);
  let kind = service?.kind ?? 'massage';
  const stopNow = service?.destinationId ?? currentSlot(trip)?.destinationId ?? trip.destinations[0]?.id;

  // Who: the chosen guests (faces), their travel party in one tap, and anybody else from a list.
  const whoBox = h('div', { class: 'svc-who' });
  const drawWho = () => {
    const picked = trip.guests.filter((g) => chosen.has(g.id));
    const partyLeft = trip.guests.filter((g) => !g.leftAt && !chosen.has(g.id) && picked.some((p) => p.partyId && p.partyId === g.partyId));
    putIn(whoBox,
      ...picked.map((g) => h('button', { class: 'svc-person', type: 'button', 'aria-label': `Remove ${names.get(g.id)}`, onclick: () => { chosen.delete(g.id); drawWho(); } }, face(g, 32), h('span', {}, names.get(g.id)), h('span', { class: 'svc-x' }, '×'))),
      ...partyLeft.map((g) => h('button', { class: 'svc-person svc-person--add', type: 'button', onclick: () => { chosen.add(g.id); drawWho(); } }, h('span', {}, `+ ${names.get(g.id)}`))),
      h('select', { class: 'text-input', 'aria-label': 'Add a guest', onchange: (e) => { if (e.target.value) { chosen.add(e.target.value); drawWho(); } } },
        h('option', { value: '' }, picked.length ? 'Add another guest…' : 'Choose a guest…'),
        ...trip.guests.filter((g) => !g.leftAt && !chosen.has(g.id)).sort(alphabetical(names)).map((g) => h('option', { value: g.id }, `${g.first} ${g.last}`))));
  };
  drawWho();

  const kinds = h('div', { class: 'strip strip--small', role: 'group', 'aria-label': 'Kind of service' });
  const title = h('input', { class: 'text-input', type: 'text', maxlength: '60', value: service?.title ?? '', placeholder: 'Massage', 'aria-label': 'The service' });
  const drawKinds = () => { putIn(kinds, ...SERVICE_KINDS.map(([k, label]) => h('button', { class: `strip-item${kind === k ? ' is-active' : ''}`, type: 'button', 'aria-pressed': String(kind === k), onclick: () => { kind = k; title.placeholder = label; drawKinds(); } }, label))); title.placeholder = kindLabel(kind); };
  drawKinds();

  const stop = select(trip.destinations.map((d) => [d.id, `${d.name} · ${destinationSub(trip, d)}`]), stopNow, { 'aria-label': 'Stop', disabled: service ? '' : null });
  const date = h('input', { class: 'text-input', type: 'date', 'aria-label': 'Day' });
  const fitDates = () => { const dates = stopDates(trip, stop.value); date.min = dates[0] ?? ''; date.max = dates.at(-1) ?? ''; if (!date.value || date.value < date.min || date.value > date.max) date.value = service?.when?.date ?? dates[0] ?? ''; };
  stop.addEventListener('change', fitDates);
  date.value = service?.when?.date ?? ''; fitDates();
  const mode = select(WHEN_MODES, service?.when?.mode ?? 'after', { 'aria-label': 'When in the day' });
  const time = h('input', { class: 'text-input', type: 'time', value: service?.when?.time ?? '16:00', 'aria-label': 'Time' });
  const showTime = () => { time.hidden = !['at', 'after', 'before'].includes(mode.value); };
  mode.addEventListener('change', showTime); showTime();
  const length = select([['', 'No set length'], ...LENGTHS], service?.minutes ?? 90, { 'aria-label': 'Length' });
  const details = h('textarea', { class: 'text-input', rows: '3', maxlength: '600', placeholder: 'Any massage; English-speaking guide; a car for 4 with luggage…', 'aria-label': 'Details' }, service?.details ?? '');
  const amount = h('input', { class: 'text-input', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: service?.price ? String(service.price.amount) : '', placeholder: 'Price (optional)', 'aria-label': 'Price' });
  const currency = select(CURRENCIES.map((c) => [c, c]), service?.price?.currency ?? settings.currency ?? 'EUR', { 'aria-label': 'Currency' });
  const triple = (v) => (v === true ? 'yes' : v === false ? 'no' : 'trip');
  const seesPending = select([['trip', `As the trip (${settings.guestSeesPending ? 'shown' : 'not shown'})`], ['yes', 'Shown to the guest'], ['no', 'Not shown to the guest']], triple(service?.guestSees), { 'aria-label': 'The guest sees the request' });
  const seesPrice = select([['trip', `As the trip (${settings.guestSeesPrice ? 'shown' : 'not shown'})`], ['yes', 'Price shown to the guest'], ['no', 'Price not shown']], triple(service?.guestSeesPrice), { 'aria-label': 'The guest sees the price' });
  const back = (v) => (v === 'yes' ? true : v === 'no' ? false : null);

  const save = async () => {
    const draft = {
      guestIds: [...chosen], destinationId: stop.value, kind, title: title.value.trim() || kindLabel(kind), details: details.value,
      when: { date: date.value, mode: mode.value, time: ['at', 'after', 'before'].includes(mode.value) ? time.value : null },
      minutes: length.value ? Number(length.value) : null,
      price: amount.value.trim() === '' ? null : { amount: Number(amount.value), currency: currency.value },
      guestSees: back(seesPending.value), guestSeesPrice: back(seesPrice.value),
    };
    await act(ctx, trip, service, service ? { action: 'edit', service: draft } : { action: 'add', destinationId: draft.destinationId, service: draft, askerEmail: ctx.myEmail ?? '' },
      service ? 'Request changed' : 'Request sent to the Advance of the stop');
  };

  openSheet({
    eyebrow: 'Special request', title: service ? 'Change the request' : 'New request',
    body: [
      field('For', whoBox),
      field('What', kinds, title),
      field('Where', stop),
      field('When', date, h('div', { class: 'row-two' }, mode, time)),
      field('How long', length),
      field('Details', details, h('small', { class: 'muted' }, 'No allergies or medical details here: they have their own field.')),
      field('Price', h('div', { class: 'row-two' }, amount, currency)),
      h('details', { class: 'fold' }, h('summary', {}, 'What the guest sees'), seesPending, seesPrice),
    ],
    footer: h('button', { class: 'btn', type: 'button', onclick: save }, service ? 'Save' : 'Send the request'),
  });
}

// ---------- One request: what it says, and the answers ----------
export function openService(ctx, tripId, serviceId) {
  const trip = ctx.trip(tripId);
  const s = (trip.services ?? []).find((x) => x.id === serviceId);
  if (!s) { showToast('That request is no longer in the trip.', true); return; }
  const me = ctx.userFor?.(trip.id) ?? { role: 'owner' };
  const role = ctx.roleFor(trip.id);
  const answerer = role === 'owner' || (me.scope && me.scope === s.destinationId);
  const asker = role === 'owner' || s.requestedBy?.id === me.id;
  const open = s.status === 'requested' || s.status === 'proposed';
  const stop = trip.destinations.find((d) => d.id === s.destinationId);
  const view = guestView(trip, s);
  const fact = (label, value) => (value ? h('div', { class: 'svc-fact' }, h('span', {}, label), h('b', {}, value)) : null);

  const confirmSheet = () => {
    const from = s.proposal ?? { date: s.when.date, time: s.when.time };
    const date = h('input', { class: 'text-input', type: 'date', value: s.confirmed?.date ?? from.date ?? '', 'aria-label': 'Day' });
    const time = h('input', { class: 'text-input', type: 'time', value: s.confirmed?.time ?? from.time ?? '', 'aria-label': 'Time' });
    const place = h('input', { class: 'text-input', type: 'text', maxlength: '80', value: s.confirmed?.place ?? '', placeholder: 'Where (hotel spa, lobby…)', 'aria-label': 'Where' });
    const provider = h('input', { class: 'text-input', type: 'text', maxlength: '80', value: s.confirmed?.provider ?? '', placeholder: 'Who (therapist, guide, driver)', 'aria-label': 'Who' });
    const amount = h('input', { class: 'text-input', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: s.price ? String(s.price.amount) : '', placeholder: 'Price', 'aria-label': 'Price' });
    const currency = select(CURRENCIES.map((c) => [c, c]), s.price?.currency ?? serviceSettings(trip).currency ?? 'EUR', { 'aria-label': 'Currency' });
    const note = h('input', { class: 'text-input', type: 'text', maxlength: '200', placeholder: 'A note for the colleague (optional)', 'aria-label': 'Note' });
    openSheet({ eyebrow: 'Confirm', title: s.title || kindLabel(s.kind), subtitle: `${guestsText(trip, s)} · asked: ${whenText(s.when)}`,
      body: [field('Booked for', h('div', { class: 'row-two' }, date, time)), field('Where', place), field('Who', provider), field('Price', h('div', { class: 'row-two' }, amount, currency)), note],
      footer: h('button', { class: 'btn', type: 'button', onclick: () => act(ctx, trip, s, { action: 'confirm', confirmed: { date: date.value, time: time.value, place: place.value, provider: provider.value },
        price: amount.value.trim() === '' ? null : { amount: Number(amount.value), currency: currency.value }, answer: note.value }, 'Confirmed: the colleague is told') }, 'Confirm') });
  };
  const proposeSheet = () => {
    const date = h('input', { class: 'text-input', type: 'date', value: s.when.date, 'aria-label': 'Day' });
    const time = h('input', { class: 'text-input', type: 'time', value: s.when.time ?? '', 'aria-label': 'Time' });
    const note = h('input', { class: 'text-input', type: 'text', maxlength: '200', placeholder: 'Why, or other choices (optional)', 'aria-label': 'Note' });
    openSheet({ eyebrow: 'Another time', title: s.title || kindLabel(s.kind), subtitle: `Asked: ${whenText(s.when)}`, body: [h('div', { class: 'row-two' }, date, time), note],
      footer: h('button', { class: 'btn', type: 'button', onclick: () => act(ctx, trip, s, { action: 'propose', proposal: { date: date.value, time: time.value, note: note.value } }, 'Proposal sent') }, 'Propose this time') });
  };
  const declineSheet = () => {
    const why = h('textarea', { class: 'text-input', rows: '3', maxlength: '200', placeholder: 'Fully booked that day; no English-speaking guide…', 'aria-label': 'Why' });
    openSheet({ eyebrow: 'Not possible', title: s.title || kindLabel(s.kind), body: [why],
      footer: h('button', { class: 'btn btn--danger', type: 'button', onclick: () => act(ctx, trip, s, { action: 'decline', answer: why.value }, 'Sent: not possible') }, 'Say it is not possible') });
  };

  const buttons = [];
  if (role !== 'viewer' && !trip.archivedAt) {
    if (open && answerer) buttons.push(['Confirm', confirmSheet, 'btn'], ['Propose another time', proposeSheet, 'btn btn--plain'], ['Not possible', declineSheet, 'btn btn--plain']);
    if (s.status === 'proposed' && asker && !answerer) buttons.push([`Accept ${fixedText(s.proposal)}`, () => act(ctx, trip, s, { action: 'confirm', confirmed: { date: s.proposal.date, time: s.proposal.time, place: '', provider: '' } }, 'Accepted: confirmed'), 'btn']);
    if (s.status === 'confirmed' && answerer) buttons.push(['Change the booking', confirmSheet, 'btn btn--plain']);
    if (asker && s.status !== 'cancelled') buttons.push(['Change the request', () => { closeSheet(); openServiceForm(ctx, trip.id, { service: s }); }, 'btn btn--plain']);
    if ((s.status === 'declined' || s.status === 'cancelled') && asker) buttons.push(['Ask again', () => act(ctx, trip, s, { action: 'reopen' }, 'Asked again'), 'btn btn--plain']);
  }
  const cancel = role !== 'viewer' && !trip.archivedAt && asker && s.status !== 'cancelled'
    ? h('details', { class: 'fold' }, h('summary', {}, 'More actions'), h('button', { class: 'btn btn--small btn--danger', type: 'button', onclick: () => act(ctx, trip, s, { action: 'cancel' }, 'Request cancelled') }, 'Cancel this request')) : null;

  openSheet({
    eyebrow: `${STATUS_WORDS[s.status]} · ${stop?.name ?? ''}`, title: s.title || kindLabel(s.kind), cancelLabel: 'Close',
    body: [
      h('div', { class: 'svc-faces' }, s.guestIds.map((id) => trip.guests.find((g) => g.id === id)).filter(Boolean).map((g) => h('span', { class: 'svc-person' }, face(g, 32), h('span', {}, `${g.first} ${g.last}`)))),
      fact('Asked for', [whenText(s.when), s.minutes ? `${s.minutes} min` : null].filter(Boolean).join(' · ')),
      s.status === 'proposed' ? fact('Proposed', [fixedText(s.proposal), s.proposal?.note].filter(Boolean).join(' · ')) : null,
      s.status === 'confirmed' ? fact('Booked', [fixedText(s.confirmed), s.confirmed?.place, s.confirmed?.provider ? `with ${s.confirmed.provider}` : null].filter(Boolean).join(' · ')) : null,
      fact('Price', priceText(s.price)),
      fact('Details', s.details),
      s.answer ? fact(s.status === 'declined' ? 'Why' : 'Note', s.answer) : null,
      fact('The guest sees', view.visible ? `Yes${view.price ? ', with the price' : ', without the price'}` : s.status === 'confirmed' ? 'No' : 'Nothing yet'),
      fact('Asked by', `${s.requestedBy?.name ?? '?'} · ${new Date(s.requestedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`),
      ...buttons.map(([label, run, cls]) => h('button', { class: cls, type: 'button', onclick: run }, label)),
      cancel,
    ],
  });
}

// ---------- The list ----------
export function servicesPage(ctx, trip, serviceId) {
  const me = ctx.userFor?.(trip.id) ?? { role: 'owner' };
  const role = ctx.roleFor(trip.id);
  const all = (trip.services ?? []).filter((s) => stopFilter === 'all' || s.destinationId === stopFilter);
  const mine = new Set(servicesToAnswer(trip, me).map((s) => s.id));
  const byDate = (a, b) => (a.confirmed?.date ?? a.when.date).localeCompare(b.confirmed?.date ?? b.when.date) || (a.confirmed?.time ?? a.when.time ?? '').localeCompare(b.confirmed?.time ?? b.when.time ?? '');
  const groups = [
    ['Needs your answer', all.filter((s) => mine.has(s.id))],
    ['Waiting', all.filter((s) => !mine.has(s.id) && (s.status === 'requested' || s.status === 'proposed'))],
    ['Confirmed', all.filter((s) => s.status === 'confirmed')],
  ];
  const closed = all.filter((s) => s.status === 'declined' || s.status === 'cancelled');
  const row = (s) => { const first = trip.guests.find((g) => g.id === s.guestIds[0]);
    return h('button', { class: 'menu-row svc-row', type: 'button', onclick: () => openService(ctx, trip.id, s.id) },
      first ? face(first, 40) : null,
      h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, `${s.title || kindLabel(s.kind)} · ${guestsText(trip, s)}`), h('span', { class: 'menu-hint' }, [serviceLine(s).split(' · ').slice(1).join(' · '), trip.destinations.find((d) => d.id === s.destinationId)?.name, priceText(s.price)].filter(Boolean).join(' · '))),
      h('span', { class: `svc-status svc-status--${s.status}` }, STATUS_WORDS[s.status])); };

  // The owner's setting: what guests see by default.
  const st = serviceSettings(trip);
  const settingsFold = role === 'owner' && !trip.archivedAt ? h('details', { class: 'fold' }, h('summary', {}, 'What guests see (this trip)'),
    h('label', { class: 'tick-row' }, h('input', { type: 'checkbox', checked: st.guestSeesPending, onchange: (e) => act(ctx, trip, null, { action: 'settings', settings: { ...st, guestSeesPending: e.target.checked } }, 'Saved') }), h('span', {}, 'Guests see their requests while they are being arranged')),
    h('label', { class: 'tick-row' }, h('input', { type: 'checkbox', checked: st.guestSeesPrice, onchange: (e) => act(ctx, trip, null, { action: 'settings', settings: { ...st, guestSeesPrice: e.target.checked } }, 'Saved') }), h('span', {}, 'Guests see the price')),
    field('Usual currency', select([['', 'None'], ...CURRENCIES.map((c) => [c, c])], st.currency, { onchange: (e) => act(ctx, trip, null, { action: 'settings', settings: { ...st, currency: e.target.value } }, 'Saved') })),
    h('p', { class: 'muted' }, 'Each request can say otherwise (New request › What the guest sees). A confirmed request is always shown unless it says not to.')) : null;

  if (serviceId) setTimeout(() => { if (!document.querySelector('.sheet')) openService(ctx, trip.id, serviceId); }, 80);
  return h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/use/guest`, label: 'Guests' }, title: 'Special requests', subtitle: 'Spa, hair, private guides, drivers…', action: role !== 'viewer' ? undoButton(ctx, trip, { scope: SERVICE_UNDO_SCOPE }) : null }),
    role !== 'viewer' && !trip.archivedAt ? h('button', { class: 'btn', type: 'button', onclick: () => openServiceForm(ctx, trip.id) }, '+ New request') : null,
    h('select', { class: 'text-input', 'aria-label': 'Which stop', onchange: (e) => { stopFilter = e.target.value; ctx.refresh(); } },
      h('option', { value: 'all', selected: stopFilter === 'all' ? '' : null }, 'Every stop'),
      trip.destinations.map((d) => h('option', { value: d.id, selected: stopFilter === d.id ? '' : null }, d.name))),
    all.length === 0 ? h('p', { class: 'empty' }, 'No request yet. A massage, a hair appointment, a private guide or driver: "New request", or from a guest\'s page.') : null,
    ...groups.filter(([, list]) => list.length).flatMap(([label, list]) => [h('h3', { class: `section-title${label === 'Needs your answer' ? ' section-title--alert' : ''}` }, `${label} (${list.length})`), h('div', { class: 'menu' }, list.sort(byDate).map(row))]),
    closed.length ? h('details', { class: 'fold' }, h('summary', {}, `Not possible or cancelled (${closed.length})`), h('div', { class: 'menu' }, closed.sort(byDate).map(row))) : null,
    settingsFold);
}

// A guest's own requests, on their page.
export function guestServicesBlock(ctx, trip, guest) {
  const list = (trip.services ?? []).filter((s) => s.guestIds.includes(guest.id) && s.status !== 'cancelled');
  const canAsk = ctx.roleFor(trip.id) !== 'viewer' && !trip.archivedAt && !guest.leftAt;
  if (!list.length && !canAsk) return null;
  return h('section', {},
    h('h3', { class: 'section-title' }, `Special requests${list.length ? ` (${list.length})` : ''}`),
    list.length ? h('div', { class: 'menu' }, list.map((s) => h('button', { class: 'menu-row', type: 'button', onclick: () => openService(ctx, trip.id, s.id) },
      h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, s.title || kindLabel(s.kind)), h('span', { class: 'menu-hint' }, serviceLine(s).split(' · ').slice(1).join(' · '))),
      h('span', { class: `svc-status svc-status--${s.status}` }, STATUS_WORDS[s.status])))) : null,
    canAsk ? h('button', { class: 'btn btn--plain', type: 'button', onclick: () => openServiceForm(ctx, trip.id, { guestIds: [guest.id] }) }, '+ New request for this guest') : null);
}

export const servicesWaitingCount = (trip, me) => servicesToAnswer(trip, me).length;
