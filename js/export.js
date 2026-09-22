// Turning a destination (or one of its half-days) into a PDF and handing it to the phone's share
// sheet, so it can go straight to WhatsApp (SPEC.md, "5. Export").
//
// Two pieces:
//   - destinationExportDoc  reads the trip and builds the plain, printable content (see pdf.js's
//     `doc` shape): no PDF knowledge here, just "what goes on the page".
//   - shareOrDownloadPdf    hands a finished PDF to the OS share sheet (Web Share API, the same
//     mechanism WhatsApp itself sits behind), or saves it as a download if that is not available.

import { buildListsPdf } from './pdf.js';
import { formatTime, formatFullMoment } from './time.js';
import { whoIsWhere, displayNames, capacityInfo, alphabetical, bySlotOrder } from './rules.js';
import { showToast } from './ui.js';

// One activity (or "At leisure") of one half-day, ready for the page: its name, its time and meeting
// point, its count, and its guests' names in the order they are shown everywhere else in the app.
function activitySections(trip, slot, destination, names) {
  const activities = trip.activities.filter((a) => a.slotId === slot.id);
  const { byActivity, leisure, attention } = whoIsWhere(trip, slot);
  const order = alphabetical(names);

  const sections = activities.map((activity) => {
    const guests = [...(byActivity.get(activity.id) ?? [])].sort(order);
    const count = capacityInfo(guests.length, activity.capacity);
    const detail = [activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '', activity.meeting]
      .filter(Boolean).join(' · ');
    return {
      heading: activity.name,
      detail,
      count: activity.cancelled ? 'Cancelled' : count.text,
      names: guests.map((g) => names.get(g.id)),
    };
  });

  sections.push({
    heading: 'At leisure', detail: '', count: String(leisure.length),
    names: [...leisure].sort(order).map((g) => names.get(g.id)),
  });

  // Every guest is always counted somewhere (SPEC.md), so a guest with no valid booking still goes
  // on the printed list, not just on the (not yet built) Warnings screen: otherwise they would simply
  // be missing from a headcount the owner relies on.
  if (attention.length > 0) {
    sections.push({
      heading: 'Needs a look', detail: 'Nothing chosen yet, or an unknown activity', count: String(attention.length),
      names: [...attention].sort((a, b) => order(a.guest, b.guest)).map((a) => names.get(a.guest.id)),
    });
  }
  return sections;
}

// The printable content for a destination. Pass a slot to export just that one half-day; leave it
// out to export every half-day of the destination, one after another (SPEC.md: "a destination or a
// half-day"). `updatedBy` is the name that goes in the header ("Updated ..., by ...").
export function destinationExportDoc(trip, destination, slot, updatedBy) {
  const names = displayNames(trip.guests);
  const slots = slot ? [slot] : trip.slots.filter((s) => s.destinationId === destination.id).sort(bySlotOrder);
  const groups = slots.map((s) => ({
    heading: slots.length > 1 ? `Day ${s.day} · ${s.half}` : null,
    sections: activitySections(trip, s, destination, names),
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

// Builds the PDF and opens the share sheet (or, if the browser has no share sheet, downloads the
// file instead — still usable, just one extra tap to attach it in WhatsApp by hand).
export async function exportAndShare(title, doc) {
  let blob;
  try {
    blob = buildListsPdf(doc);
  } catch {
    showToast('Could not build the PDF.', true);
    return;
  }
  const filename = fileNameFor(title);
  await shareOrDownloadPdf(blob, filename);
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
