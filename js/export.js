// Turning a destination (or one of its half-days) into a PDF or an Excel file, saving it as a
// version in the Exports archive (SPEC.md, "5. Export"), and handing it to the phone's share sheet
// so it can go straight to WhatsApp.
//
// The pieces:
//   - destinationExportDoc  reads the trip and builds the plain, printable content (see pdf.js's
//     `doc` shape, shared with xlsx.js): no file-format knowledge here, just "what goes on the page".
//   - nextVersion           a plain, testable rule: how a new export's version number is worked out.
//   - exportAndShare        builds the file (PDF or Excel), saves it as a version, then shares it.
//   - exportFinalTrip       the same, for the final export of the whole trip: every tour, and every
//     guest's own whole itinerary, in one file (its own content-building functions sit just above it).
//   - shareSavedExport      re-shares a version already in the archive (no rebuilding).
// (shareOrDownloadFile itself now lives in ui.js, shared with Settings > Backup.)

import { buildListsPdf, buildFinalTripPdf, buildCardsPdf, buildGroupsPdf, buildEveningPdf } from './pdf.js';
import { buildListsXlsx, buildFinalTripXlsx, buildGroupsXlsx, buildEveningXlsx } from './xlsx.js';
import { formatTime, formatFullMoment, formatWeekdayDate } from './time.js';
import { whoIsWhere, capacityInfo, byName, bySlotOrder, guestPlace, dinnerCountIn, dinnerGuests, plural } from './rules.js';
import { newId } from './ids.js';
import { showToast, shareOrDownloadFile } from './ui.js';

// The two export formats: how to build each one's file, its extension and its MIME type (the
// "kind of file" tag the share sheet and downloads use to recognise it).
const FORMATS = {
  pdf: { build: buildListsPdf, buildEvening: buildEveningPdf, extension: 'pdf', mimeType: 'application/pdf', label: 'PDF' },
  xlsx: { build: buildListsXlsx, buildEvening: buildEveningXlsx, extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel' },
};

// The row for one guest in an exported table: their ID (the code from the file they were loaded
// from, e.g. "806" — kept as `ref`, see loader.js) and their full name, "Last, First" as it is
// written on the paper lists the team already uses, so the two match.
const rowFor = (guest) => ({ id: guest.ref, name: `${guest.last}, ${guest.first}` });

// One activity (or "At leisure") of one half-day, ready for the page: its name, its time and
// meeting point, its count, and its guests as ID + name rows, sorted by last name.
function activityTables(trip, slot, destination) {
  const activities = trip.activities.filter((a) => a.slotId === slot.id);
  const { byActivity, leisure, attention } = whoIsWhere(trip, slot);

  const tables = activities.map((activity) => {
    const guests = [...(byActivity.get(activity.id) ?? [])].sort(byName);
    const count = capacityInfo(guests.length, activity.capacity);
    const detail = [activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '', activity.meeting]
      .filter(Boolean).join(' · ');
    return {
      heading: activity.name,
      detail,
      count: activity.cancelled ? 'Cancelled' : count.text,
      rows: guests.map(rowFor),
    };
  });

  tables.push({
    heading: 'At leisure', detail: '', count: String(leisure.length),
    rows: [...leisure].sort(byName).map(rowFor),
  });

  // Every guest is always counted somewhere (SPEC.md), so a guest with no valid booking still goes
  // on the printed list, not just on the (not yet built) Warnings screen: otherwise they would simply
  // be missing from a headcount the owner relies on.
  if (attention.length > 0) {
    tables.push({
      heading: 'Needs a look', detail: 'Nothing chosen yet, or an unknown activity', count: String(attention.length),
      rows: [...attention].sort((a, b) => byName(a.guest, b.guest)).map((a) => rowFor(a.guest)),
    });
  }
  return tables;
}

// The printable content for a destination. Pass a slot to export just that one half-day; leave it
// out to export every half-day of the destination, one after another (SPEC.md: "a destination or a
// half-day"). `updatedBy` is the name that goes in the header ("Updated ..., by ...").
export function destinationExportDoc(trip, destination, slot, updatedBy) {
  const slots = slot ? [slot] : trip.slots.filter((s) => s.destinationId === destination.id).sort(bySlotOrder);
  const groups = slots.map((s) => ({
    heading: slots.length > 1 ? `Day ${s.day} · ${s.half}` : null,
    tables: activityTables(trip, s, destination),
  }));

  return {
    title: slot ? `${destination.name} — Day ${slot.day} · ${slot.half}` : destination.name,
    updatedLine: `Updated ${formatFullMoment(new Date().toISOString(), destination.timeZone)} (${destination.name} time), by ${updatedBy}`,
    groups,
  };
}

// The reservation sheet for one WHOLE evening of a destination: every restaurant with a table that evening, one block per
// TABLE (restaurant name, time, that table's number of people, then each guest's ID and name). Restaurants are never
// exported one by one. Special requests are marked; blocks are sorted by restaurant, then time.
// includeDietary (Phase 3, 30 Sep 2026, owner's decision): the ONE place dietary needs may leave the app.
// Off by default and chosen again at every export. Off = no dietary text and not even a marker, so the
// sheet gives no hint that anybody has a need. On = an asterisk after each affected guest plus their need written out
// under the block, and the header says the file is for the restaurants only.
// (The file is never saved in the Exports archive when it carries dietary needs: see exportEveningReservations.)
export function eveningReservationDoc(trip, destination, slot, updatedBy, { includeDietary = false } = {}) {
  const blocks = [];
  const restaurants = trip.restaurants.filter((r) => r.destinationId === destination.id).sort((a, b) => a.name.localeCompare(b.name));
  for (const restaurant of restaurants) {
    for (const seating of [...restaurant.seatings].sort()) {
      const bookings = trip.dinnerBookings
        .filter((b) => b.restaurantId === restaurant.id && b.slotId === slot.id && b.seating === seating && dinnerCountIn(trip, b) > 0)
        .sort((a, b) => (a.status === 'special-request' ? 0 : 1) - (b.status === 'special-request' ? 0 : 1));
      // ONE BLOCK PER TABLE (owner, 1 Oct 2026): a table of 2 and a table of 4 at 18:45 must never be read as "6 people at
      // 18:45", so each booking gets its own heading (restaurant, time, its own number of people) and its own names.
      for (const booking of bookings) {
        const guests = dinnerGuests(trip, booking).sort(byName);
        const needs = [];
        const rows = guests.map((guest) => {
          const hasNeed = includeDietary && Boolean(guest.dietary);
          if (hasNeed) needs.push({ id: guest.ref, name: `${guest.last}, ${guest.first}`, text: guest.dietary });
          return { id: guest.ref, name: `${guest.last}, ${guest.first}${hasNeed ? ' *' : ''}` };
        });
        blocks.push({
          restaurant: restaurant.name, seating, count: guests.length,
          tables: [{ special: booking.status === 'special-request', rows }],
          ...(needs.length > 0 ? { needs } : {}),
        });
      }
    }
  }
  const stamp = `Updated ${formatFullMoment(new Date().toISOString(), destination.timeZone)} (${destination.name} time), by ${updatedBy}`;
  return {
    title: `${destination.name} — Day ${slot.day} · ${slot.half}, restaurant reservations`,
    updatedLine: includeDietary ? `${stamp} · Contains dietary information: for the restaurants only` : stamp,
    blocks,
  };
}

// ---------- Confirmation cards ----------
// One card per travel party per table, for one evening. The data is filled in from the bookings, so
// the owner never types a restaurant, a name or a time: they are already in the app. A party that is
// split across two tables gets one card per table, naming only the members seated there.
// Never reads guest.dietary: cards are handed to guests, and dietary needs never go on them (CLAUDE.md).

const fullName = (guest) => `${guest.first} ${guest.last}`;
// "Ada Example & Ben Sample", or "Ada Example, Ben Sample & Cleo Demo" for three or more.
const joinNames = (guests) => (guests.length <= 2
  ? guests.map(fullName).join(' & ')
  : `${guests.slice(0, -1).map(fullName).join(', ')} & ${fullName(guests.at(-1))}`);

// Guests split into their travel parties (a guest with no party is a party of one), in the order given.
const partiesOf = (guests) => {
  const parties = new Map();
  for (const guest of guests) parties.set(guest.partyId ?? guest.id, [...(parties.get(guest.partyId ?? guest.id) ?? []), guest]);
  return [...parties.values()];
};

export function confirmationCards(trip, destination, slot) {
  const bookings = trip.dinnerBookings
    .filter((b) => b.slotId === slot.id && dinnerCountIn(trip, b) > 0)
    .map((booking) => ({ booking, restaurant: trip.restaurants.find((r) => r.id === booking.restaurantId), guests: dinnerGuests(trip, booking).sort(byName) }))
    .filter((entry) => entry.restaurant)
    .sort((a, b) => a.restaurant.name.localeCompare(b.restaurant.name) || a.booking.seating.localeCompare(b.booking.seating) || byName(a.guests[0], b.guests[0]));

  const eyebrow = `${destination.name} · ${formatWeekdayDate(slot.date)}`;
  const cards = [];
  for (const { booking, restaurant, guests } of bookings) {
    const groups = partiesOf(guests);
    groups.forEach((group, i) => cards.push({
      eyebrow, names: joinNames(group), title: restaurant.name, subtitle: booking.seating,
      mates: groups.filter((_, j) => j !== i).map(joinNames), matesLabel: 'At your table',
    }));
  }
  return cards;
}

// One tap after choosing the evening: builds the cards PDF, saves it in the Exports archive (it holds no
// dietary information, so it is safe to keep), and shares it.
export async function exportConfirmationCards(ctx, trip, destination, slot) {
  const cards = confirmationCards(trip, destination, slot);
  if (cards.length === 0) { showToast('No tables are booked that evening yet.', true); return; }
  let blob;
  try {
    blob = buildCardsPdf(cards, trip.branding ?? {});
  } catch {
    showToast('Could not build the cards file.', true);
    return;
  }
  const title = `Confirmation cards — ${destination.name} · Day ${slot.day}`;
  const updatedLine = `Updated ${formatFullMoment(new Date().toISOString(), destination.timeZone)} (${destination.name} time), by ${ctx.owner?.name ?? 'the owner'}`;
  await saveAndShare(ctx, trip, { title, updatedLine, format: 'pdf', blob });
}

// Keeps a finished file as a new version in the Exports archive, then hands it to the share sheet. Only for
// files that hold no dietary information (see exportAndShare's `archive` option for the one that may).
async function saveAndShare(ctx, trip, { title, updatedLine, format, blob }) {
  const record = { id: newId(), tripId: trip.id, title, version: nextVersion(ctx.exportsFor(trip.id), title), updatedLine, createdAt: new Date().toISOString(), format, blob };
  try {
    await ctx.saveExport(trip.id, record);
  } catch {
    showToast('Could not save this export to the archive, but sharing it anyway.', true);
  }
  await shareOrDownloadFile(blob, fileNameFor(title, FORMATS[format].extension), FORMATS[format].mimeType);
}

// ---------- Groups (Settings > Groups) ----------
// A split's groups as printable lists, an editable Excel file, and cards telling each travel party which
// group they are in. None of them ever carries dietary information.

const activeGuestsOf = (trip) => trip.guests.filter((g) => !g.leftAt);

// Everything the printable list and the Excel file need, from one split.
export function groupsExportData(trip, split, updatedBy) {
  const rowOf = (guest) => ({ id: guest.ref, name: `${guest.last}, ${guest.first}` });
  const membersOf = (groupId) => activeGuestsOf(trip).filter((g) => split.assignments[g.id] === groupId).sort(byName);
  return {
    title: split.name, details: split.details,
    updatedLine: `Updated ${formatFullMoment(new Date().toISOString(), localTimeZone())} (local time), by ${updatedBy}`,
    groups: split.groups.map((group) => {
      const members = membersOf(group.id);
      return { name: group.name, countText: group.capacity === null ? plural(members.length, 'guest') : capacityInfo(members.length, group.capacity).text, rows: members.map(rowOf) };
    }),
    unplaced: activeGuestsOf(trip).filter((g) => split.assignments[g.id] === undefined).sort(byName).map(rowOf),
  };
}

// One card per travel party per group (a party split across two groups gets one card in each, naming only
// who is in that group). Ordered by group, then by the party's first name.
export function groupCards(trip, split) {
  const cards = [];
  for (const group of split.groups) {
    const members = activeGuestsOf(trip).filter((g) => split.assignments[g.id] === group.id).sort(byName);
    for (const party of partiesOf(members)) {
      cards.push({ eyebrow: split.name, names: joinNames(party), title: group.name, titleSize: 30, subtitle: split.details, mates: [], matesLabel: '' }); // the group is what guests look for: big
    }
  }
  return cards;
}

const nobodyPlaced = (trip, split) => !activeGuestsOf(trip).some((g) => split.assignments[g.id] !== undefined);
const stampLine = (ctx) => `Updated ${formatFullMoment(new Date().toISOString(), localTimeZone())} (local time), by ${ctx.owner?.name ?? 'the owner'}`;

export async function exportGroupsPdf(ctx, trip, split) {
  if (nobodyPlaced(trip, split)) { showToast('Nobody is in a group yet.', true); return; }
  const data = groupsExportData(trip, split, ctx.owner?.name ?? 'the owner');
  await saveAndShare(ctx, trip, { title: `${split.name} — Groups`, updatedLine: data.updatedLine, format: 'pdf', blob: buildGroupsPdf(data, trip.branding ?? {}) });
}

export async function exportGroupsXlsx(ctx, trip, split) {
  if (nobodyPlaced(trip, split)) { showToast('Nobody is in a group yet.', true); return; }
  const data = groupsExportData(trip, split, ctx.owner?.name ?? 'the owner');
  const groupName = (guest) => split.groups.find((g) => g.id === split.assignments[guest.id])?.name ?? '';
  const order = new Map(split.groups.map((g, i) => [g.name, i]));
  const rows = activeGuestsOf(trip).sort(byName)
    .sort((a, b) => (order.get(groupName(a)) ?? 999) - (order.get(groupName(b)) ?? 999)) // by group, names within it
    .map((guest) => ({
      group: groupName(guest), id: guest.ref, last: guest.last, first: guest.first,
      with: activeGuestsOf(trip).filter((o) => o.partyId && o.partyId === guest.partyId && o.id !== guest.id).map(fullName).join(', '),
    }));
  const doc = {
    title: split.name, updatedLine: data.updatedLine,
    groups: data.groups.map((g) => ({ heading: g.name, tables: [{ heading: g.name, detail: '', count: g.countText, rows: g.rows }] })),
  };
  await saveAndShare(ctx, trip, { title: `${split.name} — Groups`, updatedLine: data.updatedLine, format: 'xlsx', blob: buildGroupsXlsx(doc, rows) });
}

export async function exportGroupCards(ctx, trip, split) {
  const cards = groupCards(trip, split);
  if (cards.length === 0) { showToast('Nobody is in a group yet.', true); return; }
  await saveAndShare(ctx, trip, { title: `${split.name} — Group cards`, updatedLine: stampLine(ctx), format: 'pdf', blob: buildCardsPdf(cards, trip.branding ?? {}) });
}

// The local time of the phone doing the exporting: used only for the final trip export's header,
// since — unlike a single destination — the whole trip has no one time zone to show the moment in.
const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Every half-day's tours, across every destination, in trip order — the same shape
// destinationExportDoc builds, just spanning the whole trip instead of one destination.
export function finalTripToursDoc(trip, updatedBy) {
  const slots = [...trip.slots].sort(bySlotOrder);
  const groups = slots.map((slot) => {
    const destination = trip.destinations.find((d) => d.id === slot.destinationId);
    return { heading: `Day ${slot.day} · ${slot.half} · ${destination.name}`, tables: activityTables(trip, slot, destination) };
  });
  return {
    title: `${trip.name} — Every tour`,
    updatedLine: `Updated ${formatFullMoment(new Date().toISOString(), localTimeZone())} (local time), by ${updatedBy}`,
    groups,
  };
}

// Every guest's own day-by-day itinerary, in trip order: the same rule the By guest screen itself
// uses (guestPlace) to say where someone is in a half-day. Shared by the PDF and Excel builders
// below, which each lay the same information out differently.
function guestItineraries(trip) {
  const slots = [...trip.slots].sort(bySlotOrder);
  return trip.guests.filter((g) => !g.leftAt).sort(byName).map((guest) => ({
    guest,
    entries: slots.map((slot) => {
      const destination = trip.destinations.find((d) => d.id === slot.destinationId);
      const place = guestPlace(trip, guest, slot);
      const what = place.kind === 'activity' ? place.activity.name
        : place.kind === 'leisure' ? 'At leisure'
        : place.kind === 'dinner' ? `Dining: ${place.restaurant.name} (${place.booking.seating})`
        : place.kind === 'waitlist' ? `Waitlist: ${place.activity.name}`
        : place.kind === 'unknown' ? `Unknown: "${place.raw}"`
        : 'Nothing chosen yet';
      return { when: `Day ${slot.day} · ${slot.half}`, destination: destination.name, what };
    }),
  }));
}

// PDF: one small tile per guest (their name as its heading, their ID underneath, one row per
// half-day). `id`/`name` here just mean "when" and "where · what" — the tile only draws two data
// columns and does not care what they mean (pdf.js's GUEST_TILE names them properly on the page).
export function finalTripGuestsDocForPdf(trip, updatedBy) {
  return {
    title: `${trip.name} — Every guest's trip`,
    updatedLine: `Updated ${formatFullMoment(new Date().toISOString(), localTimeZone())} (local time), by ${updatedBy}`,
    groups: [{
      heading: null,
      tables: guestItineraries(trip).map(({ guest, entries }) => ({
        heading: `${guest.last}, ${guest.first}`, detail: `ID ${guest.ref}`, count: null,
        rows: entries.map((e) => ({ id: e.when, name: `${e.destination} · ${e.what}` })),
      })),
    }],
  };
}

// Excel: one flat row per (guest, half-day) pair, the shape Excel itself is for (sortable, filterable).
export function finalTripGuestsRowsForXlsx(trip) {
  return guestItineraries(trip).flatMap(({ guest, entries }) =>
    entries.map((e) => ({ id: guest.ref, name: `${guest.last}, ${guest.first}`, when: e.when, destination: e.destination, what: e.what })));
}

// A plain file name from a title: "Kyoto — Day 6 · Morning" -> "kyoto-day-6-morning.pdf".
function fileNameFor(title, extension) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
  return `${slug || 'export'}.${extension}`;
}

// Versions are counted per title ("Lisbon", "Lisbon — Day 1 · Afternoon", ... each start at 1 and
// count up on their own), so "Kyoto tours, version 3" means the third time that exact list was
// exported, however many other things were exported in between — PDF and Excel share the same count,
// since they are the same export, just in a different file.
export function nextVersion(records, title) {
  return records.filter((r) => r.title === title).length + 1;
}

// Builds the file (format: 'pdf' or 'xlsx'), saves it as a new version in the Exports archive, and
// opens the share sheet (or, if the browser has no share sheet, downloads the file instead — still
// usable, just one extra tap to attach it in WhatsApp by hand).
// archive: false shares the file without keeping a copy in the Exports archive (used for a file that
// carries dietary needs: the app cannot erase a file it already handed out, but it need not keep one).
export async function exportAndShare(ctx, trip, doc, format, { archive = true } = {}) {
  const spec = FORMATS[format];
  let blob;
  try {
    blob = doc.blocks ? spec.buildEvening(doc) : spec.build(doc); // an evening sheet has its own layout
  } catch {
    showToast(`Could not build the ${spec.label} file.`, true);
    return;
  }
  if (archive) {
    const record = {
      id: newId(), tripId: trip.id, title: doc.title, version: nextVersion(ctx.exportsFor(trip.id), doc.title),
      updatedLine: doc.updatedLine, createdAt: new Date().toISOString(), format, blob,
    };
    try {
      await ctx.saveExport(trip.id, record);
    } catch {
      showToast('Could not save this export to the archive, but sharing it anyway.', true);
    }
  }
  await shareOrDownloadFile(blob, fileNameFor(doc.title, spec.extension), spec.mimeType);
  if (!archive) showToast('Shared, not kept in the Exports archive: it contains dietary needs.');
}

// The reservation sheet of one whole evening, every restaurant at once (see eveningReservationDoc).
export async function exportEveningReservations(ctx, trip, destination, slot, format, { includeDietary = false } = {}) {
  const doc = eveningReservationDoc(trip, destination, slot, ctx.owner?.name ?? 'the owner', { includeDietary });
  if (doc.blocks.length === 0) { showToast('No tables are booked that evening yet.', true); return; }
  await exportAndShare(ctx, trip, doc, format, { archive: !includeDietary });
}

// The final export of the whole trip (SPEC.md, "5. Export"): every tour's guest list, and every
// guest's own whole trip, in one file. Available any time (and later offered when archiving a trip —
// step 9). No dietary info in it, same as every other export: activityTables never reads it.
export async function exportFinalTrip(ctx, trip, format) {
  const updatedBy = ctx.owner?.name ?? 'the owner';
  let blob;
  try {
    blob = format === 'pdf'
      ? buildFinalTripPdf(finalTripToursDoc(trip, updatedBy), finalTripGuestsDocForPdf(trip, updatedBy))
      : buildFinalTripXlsx(finalTripToursDoc(trip, updatedBy), finalTripGuestsRowsForXlsx(trip));
  } catch {
    showToast(`Could not build the ${FORMATS[format].label} file.`, true);
    return;
  }
  const title = `${trip.name} — Final export`;
  const updatedLine = `Updated ${formatFullMoment(new Date().toISOString(), localTimeZone())} (local time), by ${updatedBy}`;
  const record = {
    id: newId(), tripId: trip.id, title, version: nextVersion(ctx.exportsFor(trip.id), title),
    updatedLine, createdAt: new Date().toISOString(), format, blob,
  };
  try {
    await ctx.saveExport(trip.id, record);
  } catch {
    showToast('Could not save this export to the archive, but sharing it anyway.', true);
  }
  await shareOrDownloadFile(blob, fileNameFor(title, FORMATS[format].extension), FORMATS[format].mimeType);
}

// Re-shares a version already sitting in the archive: no rebuilding, just the same file again.
// `format` defaults to 'pdf' for a version saved before Excel export existed.
export async function shareSavedExport(record) {
  const spec = FORMATS[record.format ?? 'pdf'];
  await shareOrDownloadFile(record.blob, fileNameFor(`${record.title} v${record.version}`, spec.extension), spec.mimeType);
}
