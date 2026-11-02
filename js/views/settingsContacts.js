// Settings > Local team (v0.139.0, owner's idea, 2 Nov 2026): the guides, bus drivers and escorts of the local agency, tour by tour.
//   1. "File for the agency": an Excel file with one line per tour (and colour group), the date and tour already written. The agency fills in who works
//      on it (job, name, phone, WhatsApp, languages) and sends it back (by e-mail, WhatsApp...).
//   2. "Import the agency's file": the app reads it, says what it found (and any line it could not place), and adds it to the list or replaces it.
//   3. Every tour lists its people with one tap to call, text or WhatsApp them, and "Reconfirm" (who and when). The same list is on the tour's card in Use.
// Staff only: guests never see these numbers. Changes go through the one change function (journaled, Undo).

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast, shareOrDownloadFile } from '../ui.js';
import { plural, slotLabel, colorOf } from '../rules.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { undoButton } from './undo.js';
import { CONTACTS_UNDO_SCOPE } from '../journal.js';
import { readXlsx } from '../xlsxImport.js';
import { buildContactsTemplateXlsx } from '../xlsx.js';
import { contactsFromRows, mergeContacts, contactsForTour, JOBS } from '../contacts.js';
import { contactLine } from './contactLine.js';
import { newId } from '../ids.js';

const peopleWord = (n) => (n === 1 ? '1 person' : `${n} people`);
const toursInOrder = (trip) => trip.activities.filter((a) => !a.cancelled).map((a) => ({ a, slot: trip.slots.find((x) => x.id === a.slotId) })).filter((t) => t.slot)
  .sort((x, y) => x.slot.date.localeCompare(y.slot.date) || ['Morning', 'Full day', 'Afternoon', 'Evening'].indexOf(x.slot.half) - ['Morning', 'Full day', 'Afternoon', 'Evening'].indexOf(y.slot.half) || x.a.name.localeCompare(y.a.name));

export function contactsSettingsPage(ctx, trip) {
  const viewer = ctx.roleFor(trip.id) === 'viewer';
  const locked = Boolean(trip.archivedAt) || viewer;
  const contacts = trip.contacts ?? [];
  const head = pageHead({ back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'People', title: 'Local team',
    subtitle: 'Guides, drivers and escorts of the local agency, tour by tour', action: undoButton(ctx, trip, { scope: CONTACTS_UNDO_SCOPE }) });

  async function save(contactsList, what, done) {
    const result = await applyChange(ctx, trip.id, { type: 'set-contacts', contacts: contactsList, what });
    if (result.ok) { closeSheet(); ctx.refresh(); showToast(done ?? what); return true; }
    showToast(result.error, true); return false;
  }

  // 1. The file for the agency: every tour (one line per colour group when it has them), with what is already known.
  function agencyFile() {
    const tours = toursInOrder(trip).flatMap(({ a, slot }) => {
      const split = (trip.splits ?? []).find((x) => x.activityId === a.id);
      const base = { date: slot.date, day: slot.day, tour: a.name };
      return split ? split.groups.map((g) => ({ ...base, group: colorOf(g.color)?.name ?? g.name })) : [base];
    });
    const existing = contacts.flatMap((c) => c.assignments.map((as) => {
      const t = toursInOrder(trip).find((x) => x.a.id === as.activityId);
      const split = (trip.splits ?? []).find((x) => x.activityId === as.activityId);
      const g = split?.groups.find((x) => x.id === as.groupId);
      return t ? { date: t.slot.date, day: t.slot.day, tour: t.a.name, group: g ? (colorOf(g.color)?.name ?? g.name) : '', job: c.job, name: c.name, phone: c.phone, whatsapp: c.whatsapp, languages: c.languages, company: c.company, notes: c.notes } : null;
    })).filter(Boolean);
    const slug = trip.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'trip';
    shareOrDownloadFile(buildContactsTemplateXlsx(trip.name, tours, existing), `${slug}-local-team.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  // 2. Reading the agency's file back.
  const picker = h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hidden: '' });
  picker.addEventListener('change', async () => {
    const file = picker.files[0]; picker.value = '';
    if (!file) return;
    let found;
    try {
      const sheets = await readXlsx(await file.arrayBuffer());
      const rows = sheets.Contacts ?? Object.values(sheets).find((r) => (r[0] ?? []).some((c) => String(c ?? '').trim().toLowerCase() === 'name')) ?? [];
      found = contactsFromRows(trip, rows, newId);
    } catch { showToast('This file could not be read. Is it the Excel file (.xlsx) made by the app?', true); return; }
    const tours = new Set(found.contacts.flatMap((c) => c.assignments.map((a) => a.activityId)));
    openSheet({ eyebrow: 'Local team', title: `${peopleWord(found.contacts.length)} found`, subtitle: `On ${plural(tours.size, 'tour')}.`,
      body: [
        found.problems.length ? h('div', { class: 'card card--warn' }, h('div', { class: 'act-name' }, `${plural(found.problems.length, 'line')} to look at`), ...found.problems.slice(0, 12).map((p) => h('div', { class: 'muted' }, p))) : null,
        found.contacts.length === 0 ? h('p', { class: 'empty' }, 'Nobody in this file: the Name column is empty.') : null,
      ].filter(Boolean),
      footer: found.contacts.length ? [
        h('button', { class: 'btn', type: 'button', onclick: () => save(mergeContacts(contacts, found.contacts, 'merge'), `Imported the agency's file (${peopleWord(found.contacts.length)})`) }, contacts.length ? 'Add to the local team' : 'Import'),
        contacts.length ? h('button', { class: 'btn btn--plain', type: 'button', onclick: () => save(found.contacts, `Replaced the local team with the agency's file (${peopleWord(found.contacts.length)})`) }, 'Replace the whole list') : null,
      ].filter(Boolean) : null,
      cancelLabel: 'Cancel' });
  });

  // 3. Adding or changing one person by hand.
  function editSheet(contact) {
    const field = (label, input) => h('label', { class: 'form-label' }, label, input);
    const name = h('input', { class: 'text-input', type: 'text', maxlength: '80', value: contact?.name ?? '', 'aria-label': 'Name' });
    const job = h('select', { class: 'text-input', 'aria-label': 'Job' }, JOBS.map((j) => h('option', { value: j, selected: j === (contact?.job ?? 'Guide') ? '' : null }, j)));
    const phone = h('input', { class: 'text-input', type: 'tel', maxlength: '30', value: contact?.phone ?? '', placeholder: '+33 6 12 34 56 78', 'aria-label': 'Phone' });
    const whatsapp = h('input', { type: 'checkbox', checked: contact ? contact.whatsapp !== false : true, 'aria-label': 'On WhatsApp' });
    const languages = h('input', { class: 'text-input', type: 'text', maxlength: '60', value: contact?.languages ?? '', 'aria-label': 'Languages' });
    const company = h('input', { class: 'text-input', type: 'text', maxlength: '60', value: contact?.company ?? '', 'aria-label': 'Company' });
    const tourBoxes = toursInOrder(trip).map(({ a, slot }) => {
      const on = contact?.assignments.some((x) => x.activityId === a.id) ?? false;
      const split = (trip.splits ?? []).find((x) => x.activityId === a.id);
      const box = h('input', { type: 'checkbox', checked: on, 'aria-label': a.name });
      const groupSel = split ? h('select', { class: 'text-input', 'aria-label': `Colour group on ${a.name}` }, h('option', { value: '' }, 'No colour group'), split.groups.map((g) => h('option', { value: g.id, selected: contact?.assignments.find((x) => x.activityId === a.id)?.groupId === g.id ? '' : null }, g.name))) : null;
      return { a, box, groupSel, row: h('div', {}, h('label', { class: 'tick-row' }, box, h('span', {}, `${slotLabel(trip, slot)} · ${a.name}`)), groupSel) };
    });
    openSheet({ eyebrow: 'Local team', title: contact ? contact.name : 'Add a person',
      body: [field('Name', name), field('Job', job), field('Phone (with the country code)', phone), h('label', { class: 'tick-row' }, whatsapp, h('span', {}, 'On WhatsApp')), field('Languages', languages), field('Company', company),
        h('div', { class: 'form-label' }, 'Works on'), ...tourBoxes.map((t) => t.row)],
      footer: [
        h('button', { class: 'btn', type: 'button', onclick: () => {
          const assignments = tourBoxes.filter((t) => t.box.checked).map((t) => {
            const old = contact?.assignments.find((x) => x.activityId === t.a.id);
            return { ...(old ?? {}), activityId: t.a.id, groupId: t.groupSel?.value || null };
          });
          const person = { ...(contact ?? { id: newId(), notes: '' }), name: name.value.trim(), job: job.value, phone: phone.value.trim(), whatsapp: whatsapp.checked, languages: languages.value.trim(), company: company.value.trim(), assignments };
          const list = contact ? contacts.map((c) => (c.id === contact.id ? person : c)) : [...contacts, person];
          save(list, contact ? `Changed ${person.name} in the local team` : `Added ${person.name} to the local team`, 'Saved');
        } }, 'Save'),
        contact ? h('button', { class: 'btn btn--danger', type: 'button', onclick: () => save(contacts.filter((c) => c.id !== contact.id), `Removed ${contact.name} from the local team`) }, 'Remove') : null,
      ].filter(Boolean), cancelLabel: 'Cancel' });
  }

  // The list, tour by tour; then the people not on any tour yet.
  const byTour = toursInOrder(trip).map(({ a, slot }) => ({ a, slot, items: contactsForTour(trip, a.id) })).filter((t) => t.items.length);
  const loose = contacts.filter((c) => c.assignments.length === 0);
  const toConfirm = byTour.flatMap((t) => t.items).filter((i) => !i.assignment.confirmedAt).length;

  return h('div', {}, head,
    notice('Only the team sees these numbers, never the guests. Tap Call, Text or WhatsApp on a person; tick Reconfirm once you have spoken to them.'),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--small', type: 'button', disabled: locked, onclick: agencyFile }, 'File for the agency (Excel)'),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', disabled: locked, onclick: () => picker.click() }, 'Import the agency\'s file'),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', disabled: locked, onclick: () => editSheet(null) }, '+ Add a person'), picker),
    contacts.length === 0
      ? h('p', { class: 'empty' }, 'Nobody yet. Send the agency the Excel file: each tour is already written, they add who works on it. Then import it here.')
      : h('p', { class: 'muted' }, `${peopleWord(contacts.length)} on ${plural(byTour.length, 'tour')}${toConfirm ? ` · ${toConfirm} still to reconfirm` : ' · all reconfirmed'}.`),
    ...byTour.map(({ a, slot, items }) => h('section', { class: 'team-tour' },
      h('h3', {}, a.name), h('div', { class: 'muted' }, slotLabel(trip, slot)),
      ...items.map((item) => h('div', {}, contactLine(ctx, trip, item, { canConfirm: !locked }), locked ? null : h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => editSheet(item.contact) }, 'Edit'))))),
    loose.length ? h('section', { class: 'team-tour' }, h('h3', {}, 'Not on a tour yet'),
      ...loose.map((c) => h('button', { class: 'row', type: 'button', disabled: locked, onclick: () => editSheet(c) }, h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, c.name), h('div', { class: 'row-sub' }, [c.job, c.phone].filter(Boolean).join(' · ')))))) : null);
}
