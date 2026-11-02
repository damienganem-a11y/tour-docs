// The local team of a trip (v0.139.0, owner's idea, 2 Nov 2026): the guides, bus drivers and escorts the local agency provides, and which tour (and which
// colour group) each one works on. The team sees them on each tour with one tap to call, text or WhatsApp them, and the person in charge ticks
// "reconfirmed". Never shown to guests (the guest's sheet does not carry them).
//
// trip.contacts = [{ id, name, job, phone, whatsapp, languages, company, notes, assignments: [{ activityId, groupId | null, confirmedAt?, confirmedBy? }] }]
// The agency fills in an Excel file the app makes for them (xlsx.js buildContactsTemplateXlsx: one line per tour and colour group, the contact columns empty);
// the app reads it back here. Pure: no screen, no network.

import { colorOf } from './rules.js';

export const JOBS = ['Guide', 'Driver', 'Escort', 'Other'];
export const CONTACT_COLUMNS = ['Date', 'Day', 'Tour', 'Colour group', 'Job', 'Name', 'Phone', 'WhatsApp', 'Languages', 'Company', 'Notes'];

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());
const norm = (v) => clean(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

// A phone number as typed -> the three links: a call, a text, WhatsApp. WhatsApp needs the number with its country code (digits only).
export function phoneLinks(phone) {
  const typed = clean(phone);
  if (!typed) return null;
  const dial = typed.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  const international = dial.startsWith('+') ? dial.slice(1) : dial.startsWith('00') ? dial.slice(2) : null;
  return { tel: `tel:${dial}`, sms: `sms:${dial}`, whatsapp: international ? `https://wa.me/${international}` : null };
}

// An Excel date (a day number or text) -> 'YYYY-MM-DD', or ''.
function isoDate(v) {
  if (typeof v === 'number' && v > 20000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10); }
  const text = clean(v);
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const e = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/); // 05/06/2027 read as day/month (Europe)
  return e ? `${e[3]}-${e[2].padStart(2, '0')}-${e[1].padStart(2, '0')}` : '';
}

// The tour a line names: same date (when given) and the same name (or a name that contains the other). Returns the activity or null.
function findTour(trip, date, tourName) {
  const want = norm(tourName);
  if (!want) return null;
  const candidates = trip.activities.filter((a) => {
    if (a.cancelled) return false;
    const slot = trip.slots.find((x) => x.id === a.slotId);
    return slot && (!date || slot.date === date);
  });
  return candidates.find((a) => norm(a.name) === want) ?? candidates.find((a) => norm(a.name).includes(want) || want.includes(norm(a.name))) ?? null;
}
function findGroup(trip, activityId, text) {
  const want = norm(text);
  if (!want) return null;
  const split = (trip.splits ?? []).find((x) => x.activityId === activityId);
  return split?.groups.find((g) => norm(g.name) === want || norm(colorOf(g.color)?.name) === want) ?? null;
}

// The rows of the agency's sheet -> { contacts, problems }. One person on several lines (same phone, or same name without a phone) becomes ONE contact with
// several tours. A line with no name is skipped silently (the template has one line per tour, some left empty). Problems are plain sentences.
export function contactsFromRows(trip, rows, newId) {
  const header = (rows[0] ?? []).map(norm);
  const col = (name) => header.indexOf(norm(name));
  const at = Object.fromEntries(CONTACT_COLUMNS.map((c) => [c, col(c)]));
  if (at.Name < 0 || at.Tour < 0) return { contacts: [], problems: ['The sheet needs at least the columns "Tour" and "Name" in its first row (use the template).'] };
  const get = (row, c) => (at[c] >= 0 ? row[at[c]] : null);
  const people = new Map();
  const problems = [];
  rows.slice(1).forEach((row, i) => {
    const name = clean(get(row, 'Name'));
    if (!name) return;
    const line = i + 2;
    const tourName = clean(get(row, 'Tour'));
    const date = isoDate(get(row, 'Date'));
    const activity = findTour(trip, date, tourName);
    if (tourName && !activity) problems.push(`Line ${line}: no tour "${tourName}"${date ? ` on ${date}` : ''} in this trip.`);
    const groupText = clean(get(row, 'Colour group'));
    const group = activity && groupText ? findGroup(trip, activity.id, groupText) : null;
    if (activity && groupText && !group) problems.push(`Line ${line}: "${activity.name}" has no colour group "${groupText}" yet (the contact is put on the tour).`);
    const phone = clean(get(row, 'Phone'));
    const key = phone ? phone.replace(/[^\d]/g, '') : `name:${norm(name)}`;
    const jobText = clean(get(row, 'Job'));
    const job = JOBS.find((j) => norm(j) === norm(jobText)) ?? (jobText ? 'Other' : 'Guide');
    const whatsappText = norm(get(row, 'WhatsApp'));
    if (!people.has(key)) {
      people.set(key, { id: newId(), name, job, phone, whatsapp: !['no', 'n', 'non', 'false', '0'].includes(whatsappText), languages: clean(get(row, 'Languages')), company: clean(get(row, 'Company')), notes: clean(get(row, 'Notes')), assignments: [] });
    }
    const person = people.get(key);
    if (activity && !person.assignments.some((a) => a.activityId === activity.id)) person.assignments.push({ activityId: activity.id, groupId: group?.id ?? null });
  });
  return { contacts: [...people.values()], problems };
}

// Joining an imported list to the one the trip has: a person already known (same phone, or same name without a phone) keeps their id and their
// "reconfirmed" ticks, and gains the new tours. mode 'replace' starts from the imported list only.
export function mergeContacts(existing, imported, mode) {
  if (mode === 'replace') return imported;
  const keyOf = (c) => (c.phone ? c.phone.replace(/[^\d]/g, '') : `name:${norm(c.name)}`);
  const out = existing.map((c) => structuredClone(c));
  for (const c of imported) {
    const same = out.find((o) => keyOf(o) === keyOf(c));
    if (!same) { out.push(c); continue; }
    for (const field of ['name', 'job', 'phone', 'languages', 'company', 'notes']) if (c[field]) same[field] = c[field];
    same.whatsapp = c.whatsapp;
    for (const a of c.assignments) {
      const old = same.assignments.find((x) => x.activityId === a.activityId);
      if (old) old.groupId = a.groupId ?? old.groupId; else same.assignments.push(a);
    }
  }
  return out;
}

// The people working on a tour, with their colour group: [{ contact, assignment, group }], guides first, then by colour group order, then by name.
export function contactsForTour(trip, activityId) {
  const split = (trip.splits ?? []).find((x) => x.activityId === activityId);
  const order = (g) => (g ? split.groups.indexOf(g) : 999);
  return (trip.contacts ?? []).flatMap((contact) => contact.assignments.filter((a) => a.activityId === activityId)
    .map((assignment) => ({ contact, assignment, group: split?.groups.find((g) => g.id === assignment.groupId) ?? null })))
    .sort((a, b) => JOBS.indexOf(a.contact.job) - JOBS.indexOf(b.contact.job) || order(a.group) - order(b.group) || a.contact.name.localeCompare(b.contact.name));
}

// A sentence for a list of contacts the change function is given: null when it is fine.
export function contactsError(trip, list) {
  if (!Array.isArray(list) || list.length > 500) return 'The list of contacts is not valid.';
  for (const c of list) {
    if (!c || typeof c.id !== 'string' || !clean(c.name) || clean(c.name).length > 80) return 'Every contact needs a name of 80 letters or fewer.';
    if (!JOBS.includes(c.job)) return `"${c.job}" is not a job (Guide, Driver, Escort or Other).`;
    if (clean(c.phone).length > 30) return `The phone number of ${c.name} is too long.`;
    if (!Array.isArray(c.assignments) || c.assignments.some((a) => !trip.activities.some((x) => x.id === a.activityId))) return `A tour of ${c.name} is not in this trip.`;
  }
  return null;
}
