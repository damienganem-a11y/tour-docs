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

import { buildListsPdf, buildFinalTripPdf } from './pdf.js';
import { buildListsXlsx, buildFinalTripXlsx } from './xlsx.js';
import { formatTime, formatFullMoment } from './time.js';
import { whoIsWhere, capacityInfo, byName, bySlotOrder, guestPlace } from './rules.js';
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
export async function exportAndShare(ctx, trip, doc, format) {
  const spec = FORMATS[format];
  let blob;
  try {
    blob = spec.build(doc);
  } catch {
    showToast(`Could not build the ${spec.label} file.`, true);
    return;
  }
  const record = {
    id: newId(), tripId: trip.id, title: doc.title, version: nextVersion(ctx.exportsFor(trip.id), doc.title),
    updatedLine: doc.updatedLine, createdAt: new Date().toISOString(), format, blob,
  };
  try {
    await ctx.saveExport(trip.id, record);
  } catch {
    showToast('Could not save this export to the archive, but sharing it anyway.', true);
  }
  await shareOrDownloadFile(blob, fileNameFor(doc.title, spec.extension), spec.mimeType);
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
