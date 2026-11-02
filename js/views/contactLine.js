// One person of the local team on a tour (a guide, a driver...): their colour group, job and name, then one tap to call, text or WhatsApp them, and the
// "reconfirmed" tick (with who and when). Used on the tour's card in Use and in Settings > Local team.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { showToast } from '../ui.js';
import { colorOf } from '../rules.js';
import { phoneLinks } from '../contacts.js';

export function contactLine(ctx, trip, { contact, assignment, group }, { canConfirm = true } = {}) {
  const links = phoneLinks(contact.phone);
  const colour = colorOf(group?.color);
  const confirmed = Boolean(assignment.confirmedAt);
  const toggle = async () => {
    const result = await applyChange(ctx, trip.id, { type: 'confirm-contact', contactId: contact.id, activityId: assignment.activityId, confirmed: !confirmed });
    if (result.ok) { ctx.refresh(); showToast(confirmed ? 'No longer marked reconfirmed' : `${contact.name} reconfirmed`); } else showToast(result.error, true);
  };
  return h('div', { class: 'contact-line' },
    h('div', { class: 'contact-who' },
      colour ? h('span', { class: 'swatch', style: `background:${colour.hex}`, role: 'img', 'aria-label': colour.name }) : null,
      h('div', {},
        h('b', {}, contact.name),
        h('div', { class: 'muted' }, [contact.job, group ? group.name : null, contact.languages || null, contact.company || null].filter(Boolean).join(' · ')),
        contact.notes ? h('div', { class: 'muted' }, contact.notes) : null,
        confirmed ? h('div', { class: 'contact-ok' }, `✓ Reconfirmed${assignment.confirmedBy ? ` by ${assignment.confirmedBy}` : ''}, ${new Date(assignment.confirmedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`) : null)),
    h('div', { class: 'contact-actions' },
      links ? h('a', { class: 'contact-btn', href: links.tel, 'aria-label': `Call ${contact.name}` }, 'Call') : null,
      links ? h('a', { class: 'contact-btn', href: links.sms, 'aria-label': `Text ${contact.name}` }, 'Text') : null,
      links?.whatsapp && contact.whatsapp !== false ? h('a', { class: 'contact-btn contact-btn--wa', href: links.whatsapp, target: '_blank', rel: 'noopener', 'aria-label': `WhatsApp ${contact.name}` }, 'WhatsApp') : null,
      !links ? h('span', { class: 'muted' }, 'No phone number') : null,
      canConfirm && !trip.archivedAt ? h('button', { class: `contact-btn${confirmed ? ' contact-btn--on' : ''}`, type: 'button', 'aria-pressed': String(confirmed), onclick: toggle }, confirmed ? '✓ Reconfirmed' : 'Reconfirm') : null));
}
