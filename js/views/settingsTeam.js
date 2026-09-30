// Settings > Team: who else can see this trip (owner only). The owner invites people by e-mail address and gives each a role:
//   Team      works on the trip (in this first version: looks, cannot change yet)
//   View only looks only
// The person signs in with that address (the same e-mail code as everyone) and the trip appears on their device, with its documents,
// kept up to date. The owner can remove someone at any moment. Needs the trip to be on the server (signed in online).

import { h } from '../dom.js';
import { showToast } from '../ui.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { listMembers, inviteMember, removeMember, cleanInviteEmail, MEMBER_ROLES } from '../sync.js';

const ROLE_LABEL = { team: 'Team', viewer: 'View only' };

export function teamSettingsPage(ctx, trip) {
  const head = pageHead({
    back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
    eyebrow: 'Team', title: 'Team', subtitle: 'Who else can see this trip.',
  });
  if (ctx.roleFor(trip.id) !== 'owner') {
    return h('div', {}, head, notice('Only the owner of a trip manages its team.'));
  }

  const list = h('div', {}, h('p', { class: 'muted count-line' }, 'Loading…'));
  const message = h('div', { class: 'message', role: 'alert', hidden: true });
  const say = (text) => { message.textContent = text; message.hidden = !text; };

  async function load() {
    try {
      const members = await listMembers(trip.id);
      list.replaceChildren(...(members.length === 0
        ? [h('p', { class: 'empty' }, 'Nobody else yet. Invite a colleague below.')]
        : members.map((m) => h('div', { class: 'card' },
            h('div', { class: 'card-row' },
              h('div', {}, h('div', { class: 'act-name' }, m.email), h('div', { class: 'muted' }, ROLE_LABEL[m.role] ?? m.role)),
              h('button', {
                class: 'btn btn--small btn--plain', type: 'button',
                onclick: async () => { try { await removeMember(trip.id, m.email); showToast(`${m.email} removed`); load(); } catch { showToast('Could not remove them. Are you online?', true); } },
              }, 'Remove'))))));
    } catch {
      list.replaceChildren(h('p', { class: 'empty' }, 'The team cannot be shown: sign in online first (the sync light at the top), and the trip must have reached the server.'));
    }
  }

  const email = h('input', { class: 'text-input', type: 'email', inputmode: 'email', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'E-mail address of the person' });
  const role = h('select', { class: 'text-input', 'aria-label': 'Role' }, MEMBER_ROLES.map((r) => h('option', { value: r }, ROLE_LABEL[r])));
  const invite = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      say('');
      const address = cleanInviteEmail(email.value);
      if (!address) { say('That does not look like an e-mail address.'); return; }
      try {
        await inviteMember(trip.id, address, role.value);
        email.value = '';
        showToast(`${address} invited`);
        load();
      } catch {
        say('Could not invite them. Are you signed in online, and is this trip on the server (see the sync light)?');
      }
    },
  }, 'Invite');

  load();
  return h('div', {},
    head,
    notice('In this first version, the people you invite can look at the trip and its documents, kept up to date, but cannot change anything yet.'),
    list,
    h('h2', { class: 'section-title' }, 'Invite someone'),
    h('div', { class: 'form-field' }, h('label', { class: 'form-label' }, 'E-mail address', email), h('div', { class: 'form-hint' }, 'They sign in with this address, using the code sent by e-mail.')),
    h('div', { class: 'form-field' }, h('label', { class: 'form-label' }, 'Role', role)),
    invite, message);
}
