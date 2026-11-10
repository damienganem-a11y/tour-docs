// Reception list and lounge screen (v0.144.0, owner's decisions, 5 Nov 2026). One page, two looks, chosen by the link:
//   reception  today's and tomorrow's tours, every colour with its guests. Print / Save as PDF with a stamp on each page ("Version of 5 Nov 14:32, by
//              Damien · Printed 5 Nov 14:40"). A red banner when the list changed after the last print made here. "Notify me when it changes".
//   screen     for a TV: the day's tours in big letters, the next one outlined, past ones faded; scrolls slowly when it does not fit; stays awake.
// The secret token is after the # (never sent to any server log). The page asks for the list every 30 seconds (15 on a screen).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/supabase-config.js';
import { urlBase64ToUint8Array, subscriptionFields } from '../js/pushUtil.js';
import { daysToShow } from './days.js';
import { putIn } from '../js/put.js';

const app = document.getElementById('app');
const stampBox = document.getElementById('stamp');
const token = location.hash.replace(/^#/, '').trim();
const PRINTED_KEY = `tourdocs.display.printed.${token}`;
let state = null;      // the last answer of the server
let lastKey = '';      // what is on the page (to redraw only when something changed)

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

async function rpc(name, args) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// Puts nodes on the page: lists inside lists are opened, empty spots (null) left out (replaceChildren would write "null").
const put = (box, ...nodes) => putIn(box, ...nodes.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const moment = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const isScreen = () => state?.kind === 'screen';

// ---------- Reception ----------

function versionText() {
  return `Version of ${state.changed_at ? moment(state.changed_at) : 'now'}${state.changed_by ? `, by ${state.changed_by}` : ''}`;
}

function receptionTour(t) {
  const cols = t.colours.map((c) => el('div', { class: 'r-col' },
    el('div', { class: 'r-col-head', style: `background:${c.hex};color:${c.ink}` }, el('span', {}, c.name), el('span', {}, String(c.count))),
    c.guests ? el('ol', {}, c.guests.map((n) => el('li', {}, n))) : el('div', { class: 'r-count-only' }, plural(c.count, 'guest'))));
  if (t.others.count > 0) {
    cols.push(el('div', { class: 'r-col' },
      el('div', { class: 'r-col-head', style: 'background:#e0ddd5;color:#1d1d1b' }, el('span', {}, t.final ? 'No colour yet' : 'Guests · colours not final'), el('span', {}, String(t.others.count))),
      t.others.guests ? el('ol', {}, t.others.guests.map((n) => el('li', {}, n))) : el('div', { class: 'r-count-only' }, plural(t.others.count, 'guest'))));
  }
  return el('section', { class: 'r-tour' },
    el('div', { class: 'r-tour-head' },
      el('div', {}, el('div', { class: 'r-tour-name' }, `${t.time ? `${t.time} · ` : ''}${t.name}`),
        el('div', { class: 'r-tour-meta' }, [t.half, t.meeting ? `Meeting point: ${t.meeting}` : null, t.place].filter(Boolean).join(' · '))),
      t.cancelled ? el('div', { class: 'r-cancelled' }, 'CANCELLED') : el('div', { class: 'r-tour-meta' }, `${plural(t.booked, 'guest')}${t.capacity ? ` / ${t.capacity}` : ''}`)),
    t.cancelled ? null : (cols.length ? el('div', { class: 'r-cols' }, cols) : el('div', { class: 'r-empty' }, 'Nobody booked.')));
}

function drawReception() {
  const sheet = state.sheet;
  const printed = store.get(PRINTED_KEY);
  const changedSincePrint = printed && state.changed_at && Date.parse(state.changed_at) > Date.parse(printed);
  const shown = daysToShow(sheet);
  const pushButton = notifyButton();
  app.dataset.mark = `Version ${state.changed_at ? moment(state.changed_at) : ''}`;
  put(app,
    el('div', { class: 'r-top' },
      el('div', {},
        el('div', { class: 'r-eyebrow' }, [sheet.company, state.label || 'Reception'].filter(Boolean).join(' · ')),
        el('div', { class: 'r-title' }, `${sheet.trip}: tour list`),
        el('div', { class: 'r-version' }, versionText())),
      el('div', { class: 'r-actions' }, el('button', { class: 'r-btn', type: 'button', onclick: printNow }, 'Print / Save as PDF'), pushButton)),
    changedSincePrint ? el('div', { class: 'r-banner', role: 'alert' }, el('span', {}, `The list changed ${moment(state.changed_at)}, after your last print (${moment(printed)}). Please print it again.`),
      el('button', { type: 'button', onclick: printNow }, 'Print again')) : null,
    el('p', { class: 'r-note' }, 'This page updates by itself. Each printed page carries its version and print time at the bottom.'),
    shown.length === 0 ? el('p', { class: 'r-empty' }, 'No tours today or tomorrow.') : shown.map(({ day, which }) => [
      el('h2', { class: 'r-day' }, `${which === day.label ? which : `${which} · ${day.label}`}${day.place ? ` · ${day.place}` : ''}`),
      day.tours.length ? day.tours.map(receptionTour) : el('p', { class: 'r-empty' }, 'No tours.'),
    ]));
}

function printNow() {
  const at = new Date().toISOString();
  stampBox.textContent = `Tour Docs · ${state.sheet.trip} · ${versionText()} · Printed ${moment(at)}`;
  store.set(PRINTED_KEY, at);
  window.print();
  lastKey = ''; render(); // the banner goes once printed
}

// "Notify me when it changes": Web Push on this computer or phone (on an iPhone: after Add to Home Screen).
function notifyButton() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return null;
  const on = store.get(`tourdocs.display.push.${token}`) === '1' && Notification.permission === 'granted';
  const button = el('button', { class: 'r-btn r-btn--plain', type: 'button', onclick: async () => {
    button.disabled = true; button.textContent = 'One moment…';
    try {
      const key = await rpc('get_push_public_key', {});
      if (!key) throw new Error('not ready');
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('not allowed');
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const f = subscriptionFields(subscription);
      const result = await rpc('save_display_push', { p_token: token, p_endpoint: f.endpoint, p_p256dh: f.p256dh, p_auth: f.auth });
      if (!result.ok) throw new Error('not saved');
      store.set(`tourdocs.display.push.${token}`, '1');
      button.textContent = '✓ You will be told when it changes';
    } catch {
      button.disabled = false;
      button.textContent = Notification.permission === 'denied' ? 'Notifications are blocked in this browser' : 'Could not switch it on: try again';
    }
  } }, on ? '✓ You will be told when it changes' : '🔔 Notify me when it changes');
  if (on) button.disabled = true;
  return button;
}

// ---------- Lounge screen ----------

function drawScreen() {
  const sheet = state.sheet;
  document.documentElement.style.setProperty('--accent', sheet.accent || '#1d5c57');
  const now = Date.now();
  const shown = daysToShow(sheet);
  const today = shown.find((s) => s.which === 'Today');
  // After the last tour of today has left (or from 18:00), tomorrow comes too; before the trip, the next two days.
  const todayDone = today && today.day.tours.every((t) => t.startsAt && Date.parse(t.startsAt) < now);
  const days = !today ? shown : (todayDone || new Date().getHours() >= 18 ? shown : [today]);
  const upcoming = days.flatMap((d) => d.day.tours).filter((t) => !t.cancelled && t.startsAt && Date.parse(t.startsAt) >= now);
  const next = upcoming[0];
  const tour = (t) => el('div', { class: `s-tour${t.startsAt && Date.parse(t.startsAt) < now - 15 * 60000 ? ' is-past' : ''}${t === next ? ' is-next' : ''}` },
    el('div', {}, el('div', { class: 's-time' }, t.time ?? '·'), el('div', { class: 's-half' }, t.half)),
    el('div', {},
      el('div', { class: 's-name' }, t.name, t === next ? el('span', { class: 's-badge' }, 'Next') : null, t.cancelled ? el('span', { class: 's-cancelled' }, ' · cancelled') : null),
      el('div', { class: 's-meta' }, [t.meeting ? `Meet: ${t.meeting}` : null, t.place, t.cancelled ? null : plural(t.booked, 'guest')].filter(Boolean).join(' · ')),
      t.cancelled || t.colours.length === 0 ? null : el('div', { class: 's-chips' }, t.colours.map((c) => el('div', { class: 's-col' },
        el('div', { class: 's-chip', style: `background:${c.hex};color:${c.ink}` }, `${c.name} · ${c.count}`),
        c.guests ? el('div', { class: 's-names' }, c.guests.join(', ')) : null)))));
  const inner = el('div', { class: 's-inner' }, days.length === 0 ? el('div', { class: 's-empty' }, 'No tours today.') : days.map(({ day, which }) => [
    el('div', { class: 's-day' }, `${which}${which === day.label ? '' : ` · ${day.label}`}${day.place ? ` · ${day.place}` : ''}`),
    day.tours.length ? day.tours.map(tour) : el('div', { class: 's-empty' }, 'No tours.'),
  ]));
  put(app,
    el('div', { class: 's-top' }, el('div', {}, el('div', { class: 's-trip' }, sheet.trip), el('div', { class: 's-sub' }, sheet.company || state.label || '')), el('div', { class: 's-clock', id: 'clock' }, clockText())),
    el('div', { class: 's-scroll' }, inner),
    el('div', { class: 's-foot' }, `Updated ${state.changed_at ? moment(state.changed_at) : ''}`));
  startScroll(inner);
}

const clockText = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// When the tours do not fit, the list moves up slowly, waits at the end, and starts again from the top.
let scrollTimer = null;
function startScroll(inner) {
  clearInterval(scrollTimer);
  const box = inner.parentElement;
  let offset = 0; let wait = 120; // ticks of 50 ms: 6 seconds at the top
  scrollTimer = setInterval(() => {
    const room = inner.scrollHeight - box.clientHeight;
    if (room <= 0) { inner.style.transform = ''; return; }
    if (wait > 0) { wait -= 1; return; }
    offset += 1;
    if (offset >= room) { wait = 160; setTimeout(() => { offset = 0; inner.style.transform = ''; }, 7000); }
    inner.style.transform = `translateY(${-Math.min(offset, room)}px)`;
  }, 50);
}

// ---------- Both ----------

function render() {
  if (!state) return;
  document.body.className = isScreen() ? 'is-screen' : 'is-reception';
  document.title = isScreen() ? `${state.sheet.trip}: tours` : `${state.sheet.trip}: tour list`;
  // A screen redraws every minute anyway (past tours fade, the next one moves on); the reception only when the list changed.
  const key = `${state.changed_at}|${state.show_names}|${isScreen() ? Math.floor(Date.now() / 60000) : ''}|${daysToShow(state.sheet).map((d) => d.day.date).join()}`;
  if (key === lastKey) return;
  lastKey = key;
  if (isScreen()) drawScreen(); else drawReception();
}

function problem(title, text) {
  document.body.className = 'is-reception';
  put(app, el('div', { class: 'pad' }, el('h1', {}, title), el('p', { class: 'muted' }, text)));
}

async function load() {
  if (!token) { problem('This link is not complete', 'Open it again from the link or QR code you were given.'); return; }
  try {
    const answer = await rpc('display_view', { p_token: token });
    if (!answer.ok) { state = null; lastKey = ''; problem('This link is switched off', 'Ask the tour leader for a new one.'); return; }
    state = answer;
    store.set(`tourdocs.display.last.${token}`, JSON.stringify(answer));
    render();
  } catch {
    // No connection: keep showing the last list received (a TV must never go blank because the wifi dropped for a moment).
    if (!state) { try { state = JSON.parse(store.get(`tourdocs.display.last.${token}`)); } catch { state = null; } }
    if (state) render(); else problem('No connection', 'This page needs the internet. It will try again by itself.');
  }
}

load();
setInterval(load, location.search.includes('screen') ? 15000 : 30000);
setInterval(() => { const c = document.getElementById('clock'); if (c) c.textContent = clockText(); if (isScreen()) render(); }, 10000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
window.addEventListener('hashchange', () => location.reload());
// A TV stays on for days: reload twice a day to pick up a new version of this page, and keep the screen awake.
setTimeout(() => location.reload(), 12 * 3600000);
async function stayAwake() { try { await navigator.wakeLock?.request('screen'); } catch { /* not supported: the kiosk app keeps it awake */ } }
stayAwake();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') stayAwake(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
