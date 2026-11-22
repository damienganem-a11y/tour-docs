// Special requests (v0.155.0, owner's request of 20 Nov 2026): a massage, a hair appointment, a private guide, a private driver... for one or more
// guests, asked by the staff and answered by the Advance of the stop. Pure: no screen, no network. Changed only through applyChange ('service').
//
// One request:  trip.services[] = {
//   id, guestIds: [..], destinationId, kind ('massage' | 'spa' | 'hair' | 'guide' | 'driver' | 'other'), title ('Massage'), details (free text),
//   when: { date: 'YYYY-MM-DD', mode: 'at' | 'after' | 'before' | 'morning' | 'afternoon' | 'evening' | 'day', time: 'HH:MM' | null },
//   minutes: 90 | null,
//   price: { amount: 120, currency: 'EUR' } | null,
//   guestSees: null | true | false   (null = the trip's setting),   guestSeesPrice: null | true | false (null = the trip's setting),
//   status: 'requested' | 'proposed' | 'confirmed' | 'declined' | 'cancelled',
//   confirmed: { date, time, place, provider } | null,    proposal: { date, time, note } | null,    answer: 'a line from the Advance' | '',
//   requestedBy: { id, name, email }, requestedAt, updatedBy: { id, name }, updatedAt }
// The trip's settings: trip.serviceSettings = { guestSeesPending: true, guestSeesPrice: false, currency: '' (empty = the stop's own) }.
// Allergies and medical details do not belong here (they have their own field); the form says so.

export const SERVICE_KINDS = [
  ['massage', 'Massage'], ['spa', 'Spa'], ['hair', 'Hair'], ['guide', 'Private guide'], ['driver', 'Private driver'], ['other', 'Other'],
];
export const WHEN_MODES = [
  ['at', 'At'], ['after', 'After'], ['before', 'Before'], ['morning', 'In the morning'], ['afternoon', 'In the afternoon'], ['evening', 'In the evening'], ['day', 'Any time that day'],
];
export const LENGTHS = [[30, '30 min'], [45, '45 min'], [60, '1 hour'], [75, '1 h 15'], [90, '1 h 30'], [120, '2 hours'], [180, '3 hours'], [240, 'Half a day'], [480, 'Full day']];
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'AUD', 'NZD', 'CAD', 'JPY', 'INR', 'NPR', 'BTN', 'KHR', 'PEN', 'CLP', 'WST', 'TZS', 'JOD', 'MAD', 'AED', 'ZAR'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const kindLabel = (kind) => SERVICE_KINDS.find(([k]) => k === kind)?.[1] ?? 'Other';
export const lengthLabel = (minutes) => LENGTHS.find(([m]) => m === minutes)?.[1] ?? (minutes ? `${minutes} min` : '');
export const serviceSettings = (trip) => ({ guestSeesPending: trip.serviceSettings?.guestSeesPending !== false, guestSeesPrice: trip.serviceSettings?.guestSeesPrice === true, currency: trip.serviceSettings?.currency ?? '' });

const dayText = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// "Tue 22 Nov after 16:00", "Tue 22 Nov, in the afternoon", "Tue 22 Nov, any time".
export function whenText(when) {
  if (!when?.date) return '';
  const day = dayText(when.date);
  if (when.mode === 'at' || when.mode === 'after' || when.mode === 'before') return `${day} ${when.mode === 'at' ? 'at' : when.mode} ${when.time}`;
  if (when.mode === 'day') return `${day}, any time`;
  return `${day}, in the ${when.mode}`;
}
// What is planned once confirmed (or proposed): "Tue 22 Nov at 16:30".
export const fixedText = (x) => (x?.date ? `${dayText(x.date)}${x.time ? ` at ${x.time}` : ''}` : '');
export const priceText = (price) => (price && Number.isFinite(price.amount) ? `${price.currency} ${price.amount.toLocaleString('en-GB', { maximumFractionDigits: 2 })}` : '');

// One line that says it all, for the staff: "Massage · 1 h 30 · Tue 22 Nov after 16:00".
export function serviceLine(s) {
  return [s.title || kindLabel(s.kind), lengthLabel(s.minutes), s.status === 'confirmed' ? fixedText(s.confirmed) : whenText(s.when)].filter(Boolean).join(' · ');
}

export const STATUS_WORDS = { requested: 'Waiting for an answer', proposed: 'Other time proposed', confirmed: 'Confirmed', declined: 'Not possible', cancelled: 'Cancelled' };

// The fields of a new or edited request. Returns a sentence when something is wrong, null when all is right.
export function serviceError(trip, s) {
  if (!s || typeof s !== 'object') return 'The request is empty.';
  if (!Array.isArray(s.guestIds) || s.guestIds.length === 0) return 'Choose who the request is for.';
  if (s.guestIds.some((id) => !trip.guests.some((g) => g.id === id && !g.leftAt))) return 'A guest of this request is not on the trip.';
  const stop = trip.destinations.find((d) => d.id === s.destinationId);
  if (!stop) return 'Choose the stop.';
  if (!SERVICE_KINDS.some(([k]) => k === s.kind)) return 'Choose what kind of service it is.';
  if (String(s.title ?? '').length > 60) return 'The name of the service: 60 letters at most.';
  if (String(s.details ?? '').length > 600) return 'The details: 600 letters at most.';
  if (!s.when || !DATE_RE.test(s.when.date ?? '')) return 'Choose the day.';
  if (!WHEN_MODES.some(([m]) => m === s.when.mode)) return 'Choose when in the day.';
  if (['at', 'after', 'before'].includes(s.when.mode) && !TIME_RE.test(s.when.time ?? '')) return 'Write the time, like 16:00.';
  if (s.minutes !== null && s.minutes !== undefined && !(Number.isInteger(s.minutes) && s.minutes > 0 && s.minutes <= 24 * 60)) return 'The length is in minutes.';
  if (s.price) {
    if (!(Number.isFinite(s.price.amount) && s.price.amount >= 0 && s.price.amount < 1e7)) return 'The price is a number.';
    if (!/^[A-Z]{3}$/.test(s.price.currency ?? '')) return 'Choose the currency.';
  }
  return null;
}

// Is this request shown to its guests, and with its price? (each request can override the trip's setting)
export function guestView(trip, s) {
  const set = serviceSettings(trip);
  const pendingOk = s.guestSees ?? set.guestSeesPending;
  const visible = s.status === 'confirmed' ? s.guestSees !== false : (s.status === 'requested' || s.status === 'proposed') && pendingOk;
  return { visible, price: visible && (s.guestSeesPrice ?? set.guestSeesPrice) && Boolean(priceText(s.price)) };
}

// What the guest app shows to one guest: [{ title, minutes, status: 'pending' | 'confirmed', when, place, provider, price, date }] (the sheet; no
// details written by the staff, no names of other guests, no staff notes).
export function servicesForGuest(trip, guestId) {
  return (trip.services ?? []).filter((s) => s.guestIds.includes(guestId)).map((s) => ({ s, view: guestView(trip, s) })).filter(({ view }) => view.visible)
    .map(({ s, view }) => ({
      title: s.title || kindLabel(s.kind), minutes: s.minutes ?? null, status: s.status === 'confirmed' ? 'confirmed' : 'pending',
      date: s.status === 'confirmed' ? s.confirmed?.date ?? s.when.date : s.when.date,
      when: s.status === 'confirmed' ? fixedText(s.confirmed) : whenText(s.when),
      place: s.status === 'confirmed' ? s.confirmed?.place ?? '' : '', provider: s.status === 'confirmed' ? s.confirmed?.provider ?? '' : '',
      price: view.price ? priceText(s.price) : '',
      destination: trip.destinations.find((d) => d.id === s.destinationId)?.name ?? '',
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Who must act now, for the staff app: requests waiting for the Advance of their stop (or for the owner when the stop has no Advance), and the
// proposals waiting for the colleague who asked. user: { id, role, scope }.
export function servicesToAnswer(trip, user) {
  const list = (trip.services ?? []);
  if (user.role === 'viewer') return [];
  return list.filter((s) => (s.status === 'requested' && (user.role === 'owner' || (user.scope && user.scope === s.destinationId)))
    || (s.status === 'proposed' && (s.requestedBy?.id === user.id || user.role === 'owner')));
}

// The notifications these requests need, as automatic messages (the server robot sends them; scheduledMessages.js adds them to its list):
//   - a new request: to the Advance of its stop and the owner ('@advance:<stop>', '@owner': migration 0037);
//   - a proposal, a confirmation, a refusal: to the colleague who asked and the owner;
//   - a confirmed request the guest can see: to its guests.
// Each one is kept on the list for 30 minutes after the moment it is about (the robot passes every minute), with a key that never repeats.
const WINDOW = 30 * 60000;
export function serviceMessages(trip, now = new Date()) {
  const rows = [];
  for (const s of trip.services ?? []) {
    const at = Date.parse(s.updatedAt ?? s.requestedAt);
    if (!(now.getTime() - at < WINDOW && at <= now.getTime() + 60000)) continue;
    const stop = trip.destinations.find((d) => d.id === s.destinationId);
    const who = s.guestIds.map((id) => trip.guests.find((g) => g.id === id)).filter(Boolean).map((g) => `${g.first} ${g.last.slice(0, 1)}.`).join(', ');
    const base = { send_at: new Date(at + 20000).toISOString(), guest_ids: null, category: 'reminders', priority: 'info' };
    const asker = [s.requestedBy?.email].filter(Boolean);
    if (s.status === 'requested') {
      rows.push({ ...base, auto_key: `svc|new|${s.id}|${s.updatedAt ?? s.requestedAt}`, audience: 'staff', staff_emails: [`@advance:${s.destinationId}`, '@owner'],
        title: `New request in ${stop?.name ?? 'a stop'}: ${s.title || kindLabel(s.kind)}`.slice(0, 80), body: `${who} · ${serviceLine(s)}. From ${s.requestedBy?.name ?? 'the staff'}.`.slice(0, 200) });
    } else if (s.status === 'proposed' || s.status === 'confirmed' || s.status === 'declined') {
      const word = s.status === 'confirmed' ? 'Confirmed' : s.status === 'declined' ? 'Not possible' : 'Other time proposed';
      const detail = s.status === 'confirmed' ? [fixedText(s.confirmed), s.confirmed?.place].filter(Boolean).join(', ') : s.status === 'proposed' ? fixedText(s.proposal) : s.answer;
      rows.push({ ...base, auto_key: `svc|${s.status}|${s.id}|${s.updatedAt}`, audience: 'staff', staff_emails: [...asker, '@owner'],
        title: `${word}: ${s.title || kindLabel(s.kind)} for ${who}`.slice(0, 80), body: [detail, s.answer && s.status !== 'declined' ? s.answer : ''].filter(Boolean).join(' · ').slice(0, 200) || word });
      if (s.status === 'confirmed' && guestView(trip, s).visible) {
        rows.push({ ...base, auto_key: `svc|guest|${s.id}|${s.updatedAt}`, audience: 'guests', guest_ids: [...s.guestIds],
          title: `Confirmed: ${s.title || kindLabel(s.kind)}`.slice(0, 80), body: [fixedText(s.confirmed), s.confirmed?.place].filter(Boolean).join(', ').slice(0, 200) || 'See your day in the app.' });
      }
    }
  }
  return rows;
}
