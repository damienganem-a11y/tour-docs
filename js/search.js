// "Search everything" (v0.153.0, owner's request of 11 Nov 2026): one box finds a guest, a tour, a restaurant, a stop or a page of the app.
// Pure: it only reads the trip and returns what matches, in groups. The screen is views/searchUi.js.
//   Matching: every word typed must appear (accents and capitals ignored), at the start of a word or anywhere for 3 letters and more.

import { displayNames, plain, guestPlace } from './rules.js';

const words = (text) => plain(text).split(/\s+/).filter(Boolean);
// Every typed word is found in the text: at the start of one of its words, or anywhere once 3 letters or more are typed.
export function matches(text, query) {
  const hay = plain(text);
  const starts = hay.split(/[^a-z0-9]+/);
  return words(query).every((w) => (w.length >= 3 ? hay.includes(w) : starts.some((s) => s.startsWith(w))));
}

// [{ group, items: [{ kind, id, title, detail, href, guest? }] }], the groups in a fixed order, at most `limit` items each.
// pages: [{ title, detail, href }] (the app's settings pages, given by the caller).
export function searchTrip(trip, query, { pages = [], limit = 8, now = new Date() } = {}) {
  if (words(query).length === 0) return [];
  const names = displayNames(trip.guests);
  const base = `#/trip/${trip.id}`;
  const slotOf = (id) => trip.slots.find((s) => s.id === id);
  const destOf = (id) => trip.destinations.find((d) => d.id === id);
  // Today's half-day of a guest, in words ("Altitude walk"), to say where they are now.
  const todayIn = (zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const todaySlots = trip.slots.filter((s) => s.date && s.date === todayIn(destOf(s.destinationId)?.timeZone ?? 'UTC'));
  const nowOf = (g) => {
    const p = todaySlots.map((s) => guestPlace(trip, g, s)).find((x) => x.kind === 'activity' || x.kind === 'dinner');
    return p?.kind === 'activity' ? `Today: ${p.activity.name}` : p?.kind === 'dinner' ? `Today: dinner at ${p.restaurant.name}` : null;
  };

  const guests = trip.guests.filter((g) => !g.leftAt && matches(`${g.first} ${g.last} ${names.get(g.id)} ${g.seat ?? ''}`, query))
    .sort((a, b) => names.get(a.id).localeCompare(names.get(b.id)))
    .map((g) => ({ kind: 'guest', id: g.id, guest: g, title: names.get(g.id), detail: [g.seat ? `Seat ${g.seat}` : null, nowOf(g), g.dietary ? 'Dietary need' : null].filter(Boolean).join(' · '), href: `${base}/use/guest/${g.id}` }));

  const tours = trip.activities.filter((a) => matches(`${a.name} ${a.meeting ?? ''} ${destOf(slotOf(a.slotId)?.destinationId)?.name ?? ''}`, query))
    .map((a) => { const slot = slotOf(a.slotId); const d = destOf(slot?.destinationId);
      return { kind: 'tour', id: a.id, title: a.name, detail: [`Day ${slot?.day} ${slot?.half ?? ''}`.trim(), d?.name, a.cancelled ? 'Cancelled' : null].filter(Boolean).join(' · '), href: `${base}/use/destination/${d?.id}/${slot?.id}`, sort: `${slot?.date ?? ''}${slot?.half ?? ''}` }; })
    .sort((x, y) => x.sort.localeCompare(y.sort));

  const restaurants = (trip.restaurants ?? []).filter((r) => matches(`${r.name} ${destOf(r.destinationId)?.name ?? ''}`, query))
    .map((r) => ({ kind: 'restaurant', id: r.id, title: r.name, detail: destOf(r.destinationId)?.name ?? 'Restaurant', href: `${base}/use/dining/${r.destinationId ?? ''}` }));

  const stops = trip.destinations.filter((d) => matches(`${d.name} ${d.country ?? ''}`, query))
    .map((d) => { const days = trip.slots.filter((s) => s.destinationId === d.id).map((s) => s.day);
      return { kind: 'stop', id: d.id, title: d.name, detail: [days.length ? `Day ${Math.min(...days)}${Math.max(...days) > Math.min(...days) ? `–${Math.max(...days)}` : ''}` : null, d.country].filter(Boolean).join(' · '), href: `${base}/use/destination/${d.id}` }; });

  const found = pages.filter((p) => matches(`${p.title} ${p.detail ?? ''}`, query)).map((p) => ({ kind: 'page', id: p.href, ...p }));

  return [['Guests', guests], ['Tours', tours], ['Restaurants', restaurants], ['Stops', stops], ['In the app', found]]
    .filter(([, items]) => items.length > 0)
    .map(([group, items]) => ({ group, items: items.slice(0, limit), more: Math.max(0, items.length - limit) }));
}
