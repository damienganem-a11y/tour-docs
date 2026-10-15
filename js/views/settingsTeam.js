// Settings > Team: who else can see this trip (owner only). The owner invites people by e-mail address and gives each a role:
//   Team      works on the trip (in this first version: looks, cannot change yet)
//   View only looks only
// The person signs in with that address (the same e-mail code as everyone) and the trip appears on their device, with its documents,
// kept up to date. The owner can remove someone at any moment. Needs the trip to be on the server (signed in online).

import { h } from '../dom.js';
import { showToast, closeSheet } from '../ui.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { sendMagicLink, existingSession } from '../auth.js';
import { openSheet } from '../ui.js';
import { qrSvg } from '../qr.js';
import { listMembers, inviteMember, removeMember, cleanInviteEmail, MEMBER_ROLES } from '../sync.js';

const ROLE_LABEL = { team: 'Team', viewer: 'View only', owner: 'Owner (you)' };

// Sends the person the sign-in e-mail (the code and the link that opens the app) so that inviting is one tap for the owner and one
// tap for them. Returns a sentence saying how it went. (The e-mail is the usual sign-in one: Supabase limits how many it sends per hour.)
async function sendSignInEmail(address) {
  try {
    await sendMagicLink(address, address.split('@')[0]);
    return `${address} invited, and a sign-in e-mail is on its way.`;
  } catch (error) {
    return `${address} is invited, but the e-mail could not be sent (${error.message}). They can open the app and sign in with this address.`;
  }
}

// The address a test-access QR code opens: the app itself, with the person's e-mail (and a name) already in the sign-in form.
export function signInAddress(email, name) {
  const url = new URL('./', window.location.href);
  url.search = new URLSearchParams({ email, name }).toString();
  url.hash = '';
  return url.href;
}

// Shows the sign-in QR code for one team member. Best: a one-time code made by the server, so the colleague scans it and is signed in at once, with no
// e-mail (it works once, for about an hour, and only for this address). If the server cannot make one, the older QR code is shown: it only fills the
// sign-in form with the address, and the colleague asks for the e-mail code as usual.
async function accessSheet(ctx, trip, member) {
  const name = member.email.split('@')[0].slice(0, 20);
  const picture = h('div', { class: 'qr-box' }, h('p', { class: 'muted' }, 'Making the QR code…'));
  const note = h('p', { class: 'muted qr-url' }, '');
  openSheet({
    eyebrow: ROLE_LABEL[member.role] ?? member.role, title: member.email,
    subtitle: 'Scan it with the other device\'s camera: it signs them in at once. It works once, for about an hour. Keep the screen to yourself until they have scanned it.',
    body: [picture, note],
  });
  const draw = (address) => { picture.replaceChildren(); picture.innerHTML = qrSvg(address, { pixels: 260 }); }; // drawn by qr.js from the address
  try {
    const { token_hash: token, type } = await ctx.teamSignInToken(trip.id, member.email);
    const url = new URL('./', window.location.href);
    url.search = new URLSearchParams({ th: token, t: type === 'invite' ? 'i' : 'm', name }).toString();
    url.hash = '';
    draw(url.href);
    note.textContent = 'One-time sign-in. If it does not work, close this and make a new one.';
  } catch {
    const address = signInAddress(member.email, name);
    draw(address);
    note.textContent = 'A one-time sign-in could not be made (are you online and signed in, and is the push setup done?). This older code only fills in their address: on their device tap "Send me a sign-in link" and type the code from the e-mail.';
  }
}

// The two things the owner decides about a Team colleague besides the role: where they work directly, and how much control the owner keeps.
function controlFields(trip, current = {}) {
  const where = h('select', { class: 'text-input', 'aria-label': 'Where they work directly' }, h('option', { value: '' }, 'Everywhere on the trip'), [...trip.destinations].sort((a, b) => a.order - b.order).map((d) => h('option', { value: d.id, selected: current.destination_id === d.id }, `Directly in ${d.name} only`)));
  const approval = h('select', { class: 'text-input', 'aria-label': 'Control' },
    h('option', { value: 'direct', selected: current.approval !== 'review' }, 'Apply their requests as soon as they fit'),
    h('option', { value: 'review', selected: current.approval === 'review' }, 'I approve every request first'));
  const fields = [
    h('div', { class: 'form-field' }, h('label', { class: 'form-label' }, 'Where they work directly', where),
      h('div', { class: 'form-hint' }, 'They can ask for a change in any destination (a guest may talk to the person of the next stop). Outside this place, you approve first.')),
    h('div', { class: 'form-field' }, h('label', { class: 'form-label' }, 'Control', approval),
      h('div', { class: 'form-hint' }, 'Requests are applied by your device, so it must be open. A request that forces a move into a full tour always waits for you.')),
  ];
  return { where, approval, fields };
}

// Changes a person's role, place and control without deleting and re-inviting them (same e-mail, no new sign-in e-mail).
function editAccessSheet(ctx, trip, member, reload) {
  const role = h('select', { class: 'text-input', 'aria-label': 'Role' }, MEMBER_ROLES.map((r) => h('option', { value: r, selected: member.role === r }, ROLE_LABEL[r])));
  const control = controlFields(trip, member);
  const team = h('div', {}, ...control.fields);
  const sync = () => { team.hidden = role.value !== 'team'; };
  sync(); role.addEventListener('change', sync);
  openSheet({
    eyebrow: 'Access', title: member.email, subtitle: 'The change applies the next time they open the app.',
    body: [h('div', { class: 'form-field' }, h('label', { class: 'form-label' }, 'Role', role)), team],
    footer: h('button', { class: 'btn', type: 'button', onclick: async () => {
      try {
        await inviteMember(trip.id, member.email, role.value, role.value === 'team' && control.where.value ? control.where.value : null, control.approval.value);
        closeSheet(); showToast('Access updated'); reload();
      } catch { showToast('Could not save. Are you online? (The "approval" choice needs the latest server update.)', true); }
    } }, 'Save'),
  });
}

// One person of the team: the e-mail address (wraps, however long) with the role under it, then the two buttons side by side.
export function memberCard(member, { resend, remove, access, scopeName, edit }) {
  return h('div', { class: 'card team-member' },
    h('div', { class: 'act-name team-email' }, member.email),
    h('div', { class: 'muted' }, `${ROLE_LABEL[member.role] ?? member.role}${scopeName ? ` · works directly in ${scopeName}` : ''}${member.role === 'team' ? ` · ${member.approval === 'review' ? 'you approve every request' : 'requests applied when they fit'}` : ''}`),
    h('div', { class: 'card-actions' },
      edit ? h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: edit }, 'Access') : null,
      h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: access }, 'QR code'),
      resend ? h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: resend }, 'Re-send email') : null,
      remove ? h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: remove }, 'Remove') : null));
}

export function teamSettingsPage(ctx, trip) {
  const head = pageHead({
    back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
    eyebrow: 'Team', title: 'Team', subtitle: 'Who else can see this trip.',
  });
  if (ctx.roleFor(trip.id) !== 'owner') {
    return h('div', {}, head, notice('Only the owner of a trip manages its team.'));
  }

  const list = h('div', {}, h('p', { class: 'muted count-line' }, 'Loading…'));
  // The owner's own line, with its own QR code, to sign in on a second phone or tablet of the same account (like every colleague's line).
  const mine = h('div', {});
  existingSession().then((me) => { if (me?.email) mine.replaceChildren(memberCard({ email: me.email, role: 'owner' }, { access: () => accessSheet(ctx, trip, { email: me.email, role: 'owner' }) })); }).catch(() => {});
  const message = h('div', { class: 'message', role: 'alert', hidden: true });
  const say = (text) => { message.textContent = text; message.hidden = !text; };

  async function load() {
    try {
      const members = await listMembers(trip.id);
      list.replaceChildren(...(members.length === 0
        ? [h('p', { class: 'empty' }, 'Nobody else yet. Invite a colleague below.')]
        : members.map((m) => memberCard(m, {
            scopeName: m.destination_id ? (trip.destinations.find((d) => d.id === m.destination_id)?.name ?? 'one destination') : null,
            access: () => accessSheet(ctx, trip, m),
            edit: () => editAccessSheet(ctx, trip, m, load),
            resend: async () => showToast(await sendSignInEmail(m.email)),
            remove: async () => { try { await removeMember(trip.id, m.email); showToast(`${m.email} removed`); load(); } catch { showToast('Could not remove them. Are you online?', true); } },
          }))));
    } catch {
      list.replaceChildren(h('p', { class: 'empty' }, 'The team cannot be shown: sign in online first (the sync light at the top), and the trip must have reached the server.'));
    }
  }

  const email = h('input', { class: 'text-input', type: 'email', inputmode: 'email', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'E-mail address of the person' });
  const role = h('select', { class: 'text-input', 'aria-label': 'Role' }, MEMBER_ROLES.map((r) => h('option', { value: r }, ROLE_LABEL[r])));
  // A Team colleague can be tied to ONE destination (where they work directly) and given a control level; only shown for the Team role.
  const control = controlFields(trip);
  const whereField = h('div', {}, ...control.fields);
  const syncWhere = () => { whereField.hidden = role.value !== 'team'; };
  syncWhere();
  role.addEventListener('change', syncWhere);
  const invite = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      say('');
      const address = cleanInviteEmail(email.value);
      if (!address) { say('That does not look like an e-mail address.'); return; }
      try {
        await inviteMember(trip.id, address, role.value, role.value === 'team' && control.where.value ? control.where.value : null, control.approval.value);
        email.value = '';
        load();
        showToast(await sendSignInEmail(address)); // one tap: invited AND e-mailed
      } catch {
        say('Could not invite them. Are you signed in online, and is this trip on the server (see the sync light)?');
      }
    },
  }, 'Invite');

  load();
  return h('div', {},
    head,
    notice('In this first version, the people you invite can look at the trip and its documents, kept up to date, but cannot change anything yet.'),
    mine,
    list,
    h('h2', { class: 'section-title' }, 'Invite someone'),
    h('div', { class: 'form-field' }, h('label', { class: 'form-label' }, 'E-mail address', email), h('div', { class: 'form-hint' }, 'They receive the usual sign-in e-mail (a code, and a link that opens the app). One tap to invite, one tap for them.')),
    h('div', { class: 'form-field' }, h('label', { class: 'form-label' }, 'Role', role)),
    whereField,
    invite, message);
}
