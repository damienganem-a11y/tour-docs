// The page a guide or driver opens from their reconfirmation message (v0.143.0, owner's request, 5 Nov 2026). No app, no account: the link carries a
// secret token (after the #, so it never reaches any server log). They see their tour and tap "I confirm" or "I can't make it", with an optional note.
// The answer goes to the server (contact_confirm_answer); the tour leader's app records it by itself and the team gets a notification.
// The page shows only what the staff app wrote for this link: the tour, day, time, meeting point, place, their colour group and the number of guests.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/supabase-config.js';
import { putIn } from '../js/put.js';

const app = document.getElementById('app');
const token = location.hash.replace(/^#/, '').trim();

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

async function rpc(name, args) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const clock = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function details(info) {
  const rows = [
    ['When', info.when],
    info.meeting ? ['Meeting point', info.meeting] : null,
    info.place ? ['Where', info.place] : null,
    info.group ? ['Your group', el('span', {}, info.colour ? el('span', { class: 'swatch', style: `background:${info.colour}` }) : null, `${info.group}${info.groupGuests !== null && info.groupGuests !== undefined ? ` · ${plural(info.groupGuests, 'guest')}` : ''}`)] : null,
    ['Guests', `${plural(info.guests ?? 0, 'guest')} on the whole tour`],
  ].filter(Boolean);
  return el('div', { class: 'card' }, el('div', { class: 'tour' }, info.tour), rows.map(([k, v]) => el('div', { class: 'row' }, el('b', {}, k), el('span', {}, v))));
}

function header(info) {
  const from = [info.sender, info.company].filter(Boolean).join(' · ');
  return [from ? el('div', { class: 'from' }, from) : null, el('h1', {}, `${info.name ? `Hello ${info.name}, ` : ''}can you confirm your tour?`)];
}

function show(state) {
  const { info } = state;
  if (state.answer && !state.changing) {
    const yes = state.answer === 'yes';
    putIn(app, ...header(info).slice(0, 1), details(info),
      el('div', { class: `card done ${yes ? 'is-yes' : 'is-no'}` },
        el('div', { class: 'big' }, yes ? '✓' : '✗'),
        el('h1', {}, yes ? 'Thank you, you are confirmed' : 'Thank you for telling us'),
        el('p', { class: 'muted' }, yes ? 'The tour leader has your answer.' : 'The tour leader has your answer and will be in touch.'),
        state.note ? el('p', {}, `“${state.note}”`) : null,
        state.answered_at ? el('p', { class: 'muted' }, `Answered ${clock(state.answered_at)}`) : null),
      el('button', { class: 'small', type: 'button', onclick: () => show({ ...state, changing: true }) }, 'Change my answer'));
    return;
  }
  const note = el('textarea', { id: 'note', maxlength: '300', placeholder: 'For example: I will be there 10 minutes early' });
  if (state.note) note.value = state.note;
  const problem = el('p', { class: 'error', role: 'alert' });
  const send = async (answer, button) => {
    for (const b of app.querySelectorAll('button')) b.disabled = true;
    button.textContent = 'Sending…';
    try {
      const result = await rpc('contact_confirm_answer', { p_token: token, p_answer: answer, p_note: note.value });
      if (!result.ok) throw new Error(result.error);
      show({ ...state, answer, note: note.value.trim(), answered_at: new Date().toISOString(), changing: false });
    } catch {
      for (const b of app.querySelectorAll('button')) b.disabled = false;
      button.textContent = answer === 'yes' ? '✓ I confirm' : "✗ I can't make it";
      problem.textContent = 'It could not be sent. Check your connection and try again.';
    }
  };
  const yes = el('button', { class: 'yes', type: 'button', onclick: () => send('yes', yes) }, '✓ I confirm');
  const no = el('button', { class: 'no', type: 'button', onclick: () => send('no', no) }, "✗ I can't make it");
  putIn(app, ...header(info), details(info), el('label', { for: 'note' }, 'A note for the tour leader (optional)'), note, yes, no, problem);
}

async function start() {
  if (!token) { putIn(app, el('h1', {}, 'This link is not complete'), el('p', { class: 'muted' }, 'Open it again from the message you received.')); return; }
  try {
    const state = await rpc('contact_confirm_view', { p_token: token });
    if (!state.ok) { putIn(app, el('h1', {}, 'This link no longer works'), el('p', { class: 'muted' }, 'The tour is over, or the link was replaced. If in doubt, please contact the tour leader.')); return; }
    show(state);
  } catch {
    putIn(app, el('h1', {}, 'No connection'), el('p', { class: 'muted' }, 'This page needs the internet. Please try again in a moment.'), el('button', { class: 'yes', type: 'button', onclick: start }, 'Try again'));
  }
}
start();
