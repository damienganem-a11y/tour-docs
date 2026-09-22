// Turning a destination (or one of its half-days) into a PDF, saving it as a version in the Exports
// archive (SPEC.md, "5. Export"), and handing it to the phone's share sheet so it can go straight to
// WhatsApp.
//
// The pieces:
//   - destinationExportDoc  reads the trip and builds the plain, printable content (see pdf.js's
//     `doc` shape): no PDF knowledge here, just "what goes on the page".
//   - nextVersion           a plain, testable rule: how a new export's version number is worked out.
//   - exportAndShare        builds the PDF, saves it as a version, then shares it.
//   - shareSavedExport      re-shares a version already in the archive (no rebuilding).
//   - shareOrDownloadPdf    hands a finished PDF to the OS share sheet (Web Share API, the same
//     mechanism WhatsApp itself sits behind), or saves it as a download if that is not available.

import { buildListsPdf } from './pdf.js';
import { formatTime, formatFullMoment } from './time.js';
import { whoIsWhere, capacityInfo, byName, bySlotOrder } from './rules.js';
import { newId } from './ids.js';
import { showToast } from './ui.js';

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

// A plain file name from a title: "Kyoto — Day 6 · Morning" -> "kyoto-day-6-morning.pdf".
function fileNameFor(title) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
  return `${slug || 'export'}.pdf`;
}

// Versions are counted per title ("Lisbon", "Lisbon — Day 1 · Afternoon", ... each start at 1 and
// count up on their own), so "Kyoto tours, version 3" means the third time that exact list was
// exported, however many other things were exported in between.
export function nextVersion(records, title) {
  return records.filter((r) => r.title === title).length + 1;
}

// Builds the PDF, saves it as a new version in the Exports archive, and opens the share sheet (or,
// if the browser has no share sheet, downloads the file instead — still usable, just one extra tap
// to attach it in WhatsApp by hand).
export async function exportAndShare(ctx, trip, doc) {
  let blob;
  try {
    blob = buildListsPdf(doc);
  } catch {
    showToast('Could not build the PDF.', true);
    return;
  }
  const record = {
    id: newId(), tripId: trip.id, title: doc.title, version: nextVersion(ctx.exportsFor(trip.id), doc.title),
    updatedLine: doc.updatedLine, createdAt: new Date().toISOString(), blob,
  };
  try {
    await ctx.saveExport(trip.id, record);
  } catch {
    showToast('Could not save this export to the archive, but sharing it anyway.', true);
  }
  await shareOrDownloadPdf(blob, fileNameFor(doc.title));
}

// Re-shares a version already sitting in the archive: no rebuilding, just the same file again.
export async function shareSavedExport(record) {
  await shareOrDownloadPdf(record.blob, fileNameFor(`${record.title} v${record.version}`));
}

async function shareOrDownloadPdf(blob, filename) {
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return; // the owner backed out of the share sheet: nothing to say
      // any other error: fall through and offer a download instead
    }
  }
  downloadBlob(blob, filename);
  showToast('Your phone has no share sheet for files here, so the PDF was saved to your downloads instead.');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
