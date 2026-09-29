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

import { buildListsPdf, buildFinalTripPdf, buildCardsPdf } from './pdf.js';
import { buildListsXlsx, buildFinalTripXlsx } from './xlsx.js';
import { formatTime, formatFullMoment, formatWeekdayDate } from './time.js';
import { whoIsWhere, capacityInfo, byName, bySlotOrder, guestPlace, dinnerCountIn, dinnerGuests } from './rules.js';
import { newId } from './ids.js';
import { showToast, shareOrDownloadFile } from './ui.js';

// The two export formats: how to build each one's file, its extension and its MIME type (the
// "kind of file" tag the share sheet and downloads use to recognise it).
const FORMATS = {
  pdf: { build: buildListsPdf, extension: 'pdf', mimeType: 'application/pdf', label: 'PDF' },
  xlsx: { build: buildListsXlsx, extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel' },
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

// The reservation sheet the local team of ONE restaurant gets for ONE evening: per seating, one table per
// booking, Special requests first (they are the ones the team has to act on).
// includeDietary (Phase 3, 30 Sep 2026, owner's decision): the ONE place dietary needs may leave the app.
// Off by default and chosen again at every export. Off = no dietary text and not even a marker, so the
// sheet gives no hint that anybody has a need. On = an asterisk after each affected guest plus a small
// "Dietary needs" table naming them, and the header says the file is for the restaurant only.
// (The file is never saved in the Exports archive when it carries dietary needs: see exportReservations.)
export function reservationExportDoc(trip, restaurant, slot, updatedBy, { includeDietary = false } = {}) {
  const destination = trip.destinations.find((d) => d.id === restaurant.destinationId);
  const groups = [...restaurant.seatings].sort().map((seating) => {
    const bookings = trip.dinnerBookings
      .filter((b) => b.restaurantId === restaurant.id && b.slotId === slot.id && b.seating === seating && dinnerCountIn(trip, b) > 0)
      .sort((a, b) => (a.status === 'special-request' ? 0 : 1) - (b.status === 'special-request' ? 0 : 1));
    const withNeeds = [];
    const tables = bookings.map((booking) => {
      const guests = dinnerGuests(trip, booking).sort(byName);
      const size = restaurant.mode === 'strict' && booking.tableIds.length > 0
        ? restaurant.tables.find((t) => t.id === booking.tableIds[0])?.size ?? null : null;
      const rows = guests.map((guest) => {
        const hasNeed = includeDietary && Boolean(guest.dietary);
        if (hasNeed) withNeeds.push(guest);
        return { id: guest.ref, name: `${guest.last}, ${guest.first}${hasNeed ? ' *' : ''}` };
      });
      return {
        heading: size ? `Table for ${size}` : 'Table',
        detail: booking.status === 'special-request' ? 'Special request' : 'Confirmed',
        count: size ? capacityInfo(guests.length, size).text : String(guests.length),
        rows,
      };
    });
    if (withNeeds.length > 0) {
      tables.push({
        heading: 'Dietary needs (*)', detail: 'For the restaurant only', count: String(withNeeds.length), wrap: true,
        rows: withNeeds.map((g) => ({ id: g.ref, name: `${g.last}, ${g.first}: ${g.dietary}` })),
      });
    }
    return { heading: `${seating} seating`, tables };
  }).filter((group) => group.tables.length > 0);

  const stamp = `Updated ${formatFullMoment(new Date().toISOString(), destination.timeZone)} (${destination.name} time), by ${updatedBy}`;
  return {
    title: `${restaurant.name} — Day ${slot.day} · ${slot.half}`,
    updatedLine: includeDietary ? `${stamp} · Contains dietary information: for the restaurant only` : stamp,
    groups,
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

export function confirmationCards(trip, destination, slot) {
  const bookings = trip.dinnerBookings
    .filter((b) => b.slotId === slot.id && dinnerCountIn(trip, b) > 0)
    .map((booking) => ({ booking, restaurant: trip.restaurants.find((r) => r.id === booking.restaurantId), guests: dinnerGuests(trip, booking).sort(byName) }))
    .filter((entry) => entry.restaurant)
    .sort((a, b) => a.restaurant.name.localeCompare(b.restaurant.name) || a.booking.seating.localeCompare(b.booking.seating) || byName(a.guests[0], b.guests[0]));

  const eyebrow = `${destination.name} · ${formatWeekdayDate(slot.date)}`;
  const cards = [];
  for (const { booking, restaurant, guests } of bookings) {
    const parties = new Map(); // a guest with no travel party is a party of one
    for (const guest of guests) parties.set(guest.partyId ?? guest.id, [...(parties.get(guest.partyId ?? guest.id) ?? []), guest]);
    const groups = [...parties.values()];
    groups.forEach((group, i) => cards.push({
      eyebrow, names: joinNames(group), restaurant: restaurant.name, time: booking.seating,
      tablemates: groups.filter((_, j) => j !== i).map(joinNames),
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
  const record = { id: newId(), tripId: trip.id, title, version: nextVersion(ctx.exportsFor(trip.id), title), updatedLine, createdAt: new Date().toISOString(), format: 'pdf', blob };
  try {
    await ctx.saveExport(trip.id, record);
  } catch {
    showToast('Could not save this export to the archive, but sharing it anyway.', true);
  }
  await shareOrDownloadFile(blob, fileNameFor(title, 'pdf'), 'application/pdf');
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
    blob = spec.build(doc);
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

// The reservation sheet of one restaurant for one evening (see reservationExportDoc).
export async function exportReservations(ctx, trip, restaurant, slot, format, { includeDietary = false } = {}) {
  const doc = reservationExportDoc(trip, restaurant, slot, ctx.owner?.name ?? 'the owner', { includeDietary });
  if (doc.groups.length === 0) { showToast('No tables are booked at this restaurant that evening yet.', true); return; }
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
