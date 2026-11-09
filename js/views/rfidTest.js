// Test an RFID reader (v0.147.0, owner's plan, 9 Nov 2026), before building luggage tracking: a USB UHF reader in "keyboard" mode, plugged into the phone,
// "types" the code of each tag it reads, then Enter. This screen catches what it types and shows each read, how many different tags, the repeats, and
// how fast. Nothing is saved or sent: it is only to find out whether a reader is good enough (read on the move, through a pile of bags...).
// Settings > This phone > Check this phone > Test an RFID reader.

import { h } from '../dom.js';
import { showToast } from '../ui.js';

// A typed code, cleaned: letters and digits only, in capitals (readers type the EPC or TID in hexadecimal). Too short = not a tag.
export const cleanCode = (text) => { const c = String(text ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase(); return c.length >= 8 ? c : null; };

// The reads so far -> { total, unique, repeats, perTag: Map(code -> count), lastSecond }. Pure (tested).
export function tallyReads(reads, now = Date.now()) {
  const perTag = new Map();
  for (const r of reads) perTag.set(r.code, (perTag.get(r.code) ?? 0) + 1);
  return { total: reads.length, unique: perTag.size, repeats: reads.length - perTag.size, perTag, lastTen: reads.filter((r) => now - r.at <= 10000).length };
}

export function openRfidTest() {
  const reads = [];
  const input = h('input', { class: 'rfid-input', id: 'rfid-input', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'none', 'aria-label': 'Reader input' });
  const big = h('div', { class: 'rfid-last', 'aria-live': 'polite' }, 'Waiting for a tag…');
  const stats = h('div', { class: 'rfid-stats' });
  const list = h('ol', { class: 'rfid-list' });
  const hint = h('p', { class: 'muted' }, 'Plug the reader into the phone (USB-C, or Apple\'s Lightning to USB 3 Camera Adapter), tap the box below, then pass tags in front of the reader. With the reader plugged in, the phone\'s own keyboard should not appear.');

  function draw() {
    const t = tallyReads(reads);
    stats.replaceChildren(
      h('div', {}, h('b', {}, String(t.unique)), h('span', {}, 'different tags')),
      h('div', {}, h('b', {}, String(t.total)), h('span', {}, 'reads')),
      h('div', {}, h('b', {}, String(t.repeats)), h('span', {}, 'repeats')),
      h('div', {}, h('b', {}, String(t.lastTen)), h('span', {}, 'in the last 10 s')));
    list.replaceChildren(...[...t.perTag.entries()].reverse().slice(0, 80).map(([code, n], i) => h('li', { class: i === 0 ? 'is-new' : '' },
      h('code', {}, code.length > 16 ? `…${code.slice(-16)}` : code), h('span', {}, n > 1 ? `read ${n} times` : 'read once'))));
  }
  function take(text) {
    const code = cleanCode(text);
    if (!code) return;
    const seen = reads.some((r) => r.code === code);
    reads.push({ code, at: Date.now() });
    big.textContent = `${seen ? 'Again: ' : 'New: '}…${code.slice(-12)}`;
    big.className = `rfid-last ${seen ? 'is-again' : 'is-new'}`;
    try { navigator.vibrate?.(seen ? 20 : 60); } catch { /* no vibration */ }
    draw();
  }
  // The reader types the code then Enter (or Tab). Some send no end key at all: a code is also taken after a short pause in the typing.
  let pause = null;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); clearTimeout(pause); take(input.value); input.value = ''; } });
  input.addEventListener('input', () => { clearTimeout(pause); pause = setTimeout(() => { if (input.value) { take(input.value); input.value = ''; } }, 250); });

  const close = () => { overlay.remove(); document.body.classList.remove('sheet-open'); };
  const overlay = h('div', { class: 'rfid', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Test an RFID reader' },
    h('div', { class: 'rfid-top' }, h('b', {}, 'Test an RFID reader'), h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: close }, 'Done')),
    hint,
    h('label', { class: 'form-label', for: 'rfid-input' }, 'Tap here, then read tags'), input,
    big, stats,
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: async () => {
        const t = tallyReads(reads);
        const text = [`RFID test · ${t.unique} tags · ${t.total} reads`, ...[...t.perTag.entries()].map(([c, n]) => `${c}\t${n}`)].join('\n');
        try { await navigator.clipboard.writeText(text); showToast('Results copied: paste them in a message'); } catch { showToast('Could not copy here.', true); }
      } }, 'Copy the results'),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => { reads.length = 0; big.textContent = 'Waiting for a tag…'; big.className = 'rfid-last'; draw(); input.focus(); } }, 'Start again')),
    list);
  document.body.append(overlay);
  document.body.classList.add('sheet-open');
  draw();
  setTimeout(() => input.focus(), 50);
  overlay.addEventListener('click', (e) => { if (!e.target.closest('button, a')) input.focus(); }); // keep the reader's typing going into the box
  return { close, take };
}
