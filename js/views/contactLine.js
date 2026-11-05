// One person of the local team on a tour (a guide, a driver...): their colour group, job and name, then one tap to call, text or WhatsApp them, and the
// reconfirmation. Used on the tour's card in Use and in Settings > Local team.
//
// Reconfirm (owner's report of 5 Nov 2026): one tap opens a message already written with everything (the tour, date, time, meeting point, their colour
// group and the numbers), to send by WhatsApp or text, or to copy. Sending it is noted ("Message sent 14:32"); when they answer OK, the owner ticks
// "They confirmed" (with who and when).

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { showToast, openSheet, closeSheet } from '../ui.js';
import { colorOf } from '../rules.js';
import { phoneLinks, reconfirmText, messageLinks, confirmInfo } from '../contacts.js';

const shortWhen = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

export function contactLine(ctx, trip, line, { canConfirm = true } = {}) {
  const { contact, assignment, group } = line;
  const links = phoneLinks(contact.phone);
  const colour = colorOf(group?.color);
  const confirmed = Boolean(assignment.confirmedAt);
  const status = confirmed
    ? h('div', { class: 'contact-ok' }, assignment.confirmedVia === 'link' ? `✓ ${contact.name} confirmed by link, ${shortWhen(assignment.confirmedAt)}` : `✓ Reconfirmed${assignment.confirmedBy ? ` by ${assignment.confirmedBy}` : ''}, ${shortWhen(assignment.confirmedAt)}`,
        assignment.answerNote ? h('div', { class: 'muted' }, `"${assignment.answerNote}"`) : null)
    : assignment.declinedAt ? h('div', { class: 'contact-no' }, `✗ Can't make it (answered ${shortWhen(assignment.declinedAt)})${assignment.declineNote ? `: "${assignment.declineNote}"` : ''}`)
    : assignment.askedAt ? h('div', { class: 'contact-asked' }, `Message sent ${shortWhen(assignment.askedAt)}${assignment.askedBy ? ` by ${assignment.askedBy}` : ''} · waiting for their answer`) : null;
  return h('div', { class: 'contact-line' },
    h('div', { class: 'contact-who' },
      colour ? h('span', { class: 'swatch', style: `background:${colour.hex}`, role: 'img', 'aria-label': colour.name }) : null,
      h('div', {},
        h('b', {}, contact.name),
        h('div', { class: 'muted' }, [contact.job, group ? group.name : null, contact.languages || null, contact.company || null].filter(Boolean).join(' · ')),
        contact.notes ? h('div', { class: 'muted' }, contact.notes) : null,
        status)),
    h('div', { class: 'contact-actions' },
      links ? h('a', { class: 'contact-btn', href: links.tel, 'aria-label': `Call ${contact.name}` }, 'Call') : null,
      links ? h('a', { class: 'contact-btn', href: links.sms, 'aria-label': `Text ${contact.name}` }, 'Text') : null,
      links?.whatsapp && contact.whatsapp !== false ? h('a', { class: 'contact-btn contact-btn--wa', href: links.whatsapp, target: '_blank', rel: 'noopener', 'aria-label': `WhatsApp ${contact.name}` }, 'WhatsApp') : null,
      !links ? h('span', { class: 'muted' }, 'No phone number') : null,
      canConfirm && !trip.archivedAt ? h('button', { class: `contact-btn${confirmed ? ' contact-btn--on' : ''}`, type: 'button', 'aria-pressed': String(confirmed),
        onclick: () => (confirmed ? setConfirmed(ctx, trip, line, false) : reconfirmSheet(ctx, trip, line)) }, confirmed ? '✓ Reconfirmed' : 'Reconfirm') : null));
}

async function setConfirmed(ctx, trip, { contact, assignment }, on) {
  const result = await applyChange(ctx, trip.id, { type: 'confirm-contact', contactId: contact.id, activityId: assignment.activityId, confirmed: on });
  if (result.ok) { closeSheet(); ctx.refresh(); showToast(on ? `${contact.name} reconfirmed` : 'No longer marked reconfirmed'); } else showToast(result.error, true);
}

// The prepared message: can be changed before sending. Each way of sending notes "message sent" on the tour (best effort: the message itself is
// sent by WhatsApp or the Messages app, which the app cannot see).
function reconfirmSheet(ctx, trip, line) {
  const { contact, assignment } = line;
  const sender = String(ctx.owner?.name ?? '').trim().split(/\s+/)[0] || null;
  const company = trip.branding?.companyName || null;
  const text = h('textarea', { class: 'text-input', rows: '8', 'aria-label': 'Message' });
  text.value = reconfirmText(trip, line, { sender, company });
  // Their personal link (v0.143.0): they tap it to confirm or say they can't make it, and the app updates by itself. Made on the server as the sheet
  // opens; offline (or before the database update), the message goes without it and asks them to reply OK.
  const linkState = h('div', { class: 'muted', role: 'status' }, ctx.makeConfirmLink ? 'Adding their personal link…' : '');
  let typed = false;
  text.addEventListener('input', () => { typed = true; });
  const info = confirmInfo(trip, line, { sender, company });
  if (ctx.makeConfirmLink && info) {
    const { expiresAt, ...shown } = info;
    ctx.makeConfirmLink(trip.id, { activityId: assignment.activityId, contactId: contact.id, expiresAt, info: shown }).then((link) => {
      if (!link) { linkState.textContent = 'No link this time (offline?): they can reply OK, and you tick "They confirmed".'; return; }
      if (!typed) text.value = reconfirmText(trip, line, { sender, company, link });
      else text.value += `\nTap to confirm (or tell us you can't make it): ${link}`;
      linkState.textContent = '✓ Their personal link is in the message: when they tap "I confirm", the app updates by itself.';
    });
  }
  const noteSent = () => applyChange(ctx, trip.id, { type: 'confirm-contact', contactId: contact.id, activityId: assignment.activityId, asked: true }).then((r) => { if (r.ok) ctx.refresh(); }).catch(() => {});
  const open = (kind) => {
    const links = messageLinks(contact.phone, text.value);
    if (!links?.[kind]) return;
    noteSent();
    window.open(links[kind], kind === 'whatsapp' ? '_blank' : '_self');
  };
  const links = messageLinks(contact.phone, text.value);
  openSheet({
    eyebrow: 'Reconfirm', title: contact.name, subtitle: 'Everything is in the message. Change it if you like, then send it.',
    body: [
      text,
      linkState,
      links?.whatsapp && contact.whatsapp !== false ? h('button', { class: 'btn btn--wa', type: 'button', onclick: () => open('whatsapp') }, 'Send by WhatsApp') : null,
      links ? h('button', { class: `btn${links.whatsapp && contact.whatsapp !== false ? ' btn--plain' : ''}`, type: 'button', onclick: () => open('sms') }, 'Send by text message') : null,
      h('button', { class: 'btn btn--plain', type: 'button', onclick: async () => {
        try { await navigator.clipboard.writeText(text.value); noteSent(); showToast('Message copied: paste it where you like'); } catch { text.select(); showToast('Select the text and copy it', true); }
      } }, 'Copy the message'),
      h('div', { class: 'section-title' }, 'They answered?'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => setConfirmed(ctx, trip, line, true) }, '✓ They confirmed'),
    ].filter(Boolean),
    cancelLabel: 'Close',
  });
}
