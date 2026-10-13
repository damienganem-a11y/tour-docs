// Passport Explorer game: Sequence (watch the order, repeat it, one more each round). Skins: flags (Bhutan), amok (Angkor), route (Washington, new: drawn in the same style).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { setHud, sfx, tone } from './common.js';

export const sequence = function(host, hud, onEnd, sk){
  const LENS = [3, 4, 5, 6, 7], box = document.createElement('div'); box.className = 'seq-game'; host.prepend(box);
  const FREQ = [392, 440, 523, 587, 659];
  box.innerHTML = `<div class="seq-msg" id="sqm">${sk.ready}</div><div class="seq-pads">${sk.pads.map((p, i) => `<button class="pad" data-i="${i}">${p.icon}<b>${p.name}</b><small>${p.sub}</small></button>`).join('')}</div>`;
  const pads = [...box.querySelectorAll('.pad')], msg = t => { document.getElementById('sqm').textContent = t; };
  let round = 0, seq = [], input = 0, showing = true, retries = 0, ended = false, timers = [];
  const later = (f, ms) => timers.push(setTimeout(f, ms));
  function light(i){ pads[i].classList.add('lit'); tone(FREQ[i], FREQ[i], .25, 'triangle', .06); later(() => pads[i].classList.remove('lit'), 380); }
  function paintHud(){ setHud(hud, `<span class="pill">Round ${Math.min(round + 1, LENS.length)} / ${LENS.length}</span><span class="pill">${LENS[Math.min(round, LENS.length - 1)]} in a row</span><span class="pill">Second chances ${1 - Math.min(retries, 1)}</span>`); }
  function next(){ input = 0; while (seq.length < LENS[round]) seq.push(Math.floor(Math.random() * pads.length)); paintHud(); show(); }
  function show(){ showing = true; msg(sk.show); const gap = 680 - round * 50;
    seq.forEach((p, i) => later(() => light(p), 700 + i * gap)); later(() => { showing = false; msg(sk.you); }, 700 + seq.length * gap); }
  pads.forEach((b, i) => b.onclick = () => {
    if (showing || ended) return;
    light(i);
    if (i === seq[input]) { input++; if (input === seq.length) { round++; showing = true; if (round >= LENS.length) later(() => finish(true), 500); else { msg('Well done!'); sfx('right'); later(next, 1000); } } }
    else { sfx('wrong'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); retries++;
      if (retries > 1) finish(false); else { showing = true; msg(sk.again); input = 0; paintHud(); later(show, 1300); } }
  });
  function finish(all){ ended = true; timers.forEach(clearTimeout); const reached = all ? LENS[LENS.length - 1] : (round ? LENS[round - 1] : 0), star = all && retries === 0;
    onEnd(all ? { star, ...sk.ok(reached, star) } : { star:false, ...sk.fail(reached) }); }
  paintHud();
  return { start(){ later(next, 300); }, stop(){ ended = true; timers.forEach(clearTimeout); }, move(){} };
};
const flagIcon = c => `<svg viewBox="0 0 48 48"><line x1="8" y1="4" x2="8" y2="46" stroke="#6b5a4a" stroke-width="3"/><path d="M9 6 H42 L38 18 L42 30 H9Z" fill="${c}" stroke="#bfb3a3" stroke-width="1"/><circle cx="24" cy="18" r="5" fill="none" stroke="${c === '#f4efe6' ? '#9a8e7e' : '#ffffff'}" stroke-width="1.5" opacity=".8"/></svg>`;
export const sequenceSkins = {
  flags: {
    ready:'Watch the monk…', show:'The monk hangs the flags…', you:'Your turn', again:'Not quite. The monk shows you again.',
    pads:[ { name:'Blue', sub:'Space', icon:flagIcon('#2f6db5') }, { name:'White', sub:'Air', icon:flagIcon('#f4efe6') }, { name:'Red', sub:'Fire', icon:flagIcon('#c8332b') }, { name:'Green', sub:'Water', icon:flagIcon('#2e8b57') }, { name:'Yellow', sub:'Earth', icon:flagIcon('#e9b40c') } ],
    ok:(n, star) => ({ title:'The flags fly', text:`You hung a sequence of ${n} flags perfectly. The wind will carry the prayers across the valley. ${star ? 'Not a single slip!' : 'Do it without a second chance for a star.'}` }),
    fail:n => ({ title:'Tangled lines', text:`You remembered ${n ? `a sequence of ${n}` : 'part of the order'} before the lines got tangled. The monk smiles: patience is part of the practice.` })
  },
  amok: {
    ready:'Watch the chef…', show:'The chef adds…', you:'Your turn', again:'Not quite. The chef shows you again.',
    pads:[
      { name:'Lemongrass', sub:'Bright, citrusy', icon:'<svg viewBox="0 0 48 48"><g stroke="#7aa33a" stroke-width="4" stroke-linecap="round"><line x1="16" y1="44" x2="20" y2="6"/><line x1="24" y1="44" x2="26" y2="4"/><line x1="32" y1="44" x2="30" y2="8"/></g><rect x="12" y="34" width="24" height="10" rx="4" fill="#e8e0b0"/></svg>' },
      { name:'Galangal', sub:'Peppery root', icon:'<svg viewBox="0 0 48 48"><g fill="#e3cfa4" stroke="#b89a64" stroke-width="2"><ellipse cx="18" cy="28" rx="12" ry="8"/><ellipse cx="32" cy="22" rx="10" ry="7"/><ellipse cx="30" cy="34" rx="8" ry="6"/></g><g stroke="#c4708a" stroke-width="2"><line x1="12" y1="26" x2="16" y2="30"/><line x1="30" y1="20" x2="34" y2="24"/></g></svg>' },
      { name:'Turmeric', sub:'Golden color', icon:'<svg viewBox="0 0 48 48"><g fill="#c9772a"><ellipse cx="20" cy="26" rx="12" ry="6" transform="rotate(-20 20 26)"/><ellipse cx="32" cy="30" rx="9" ry="5" transform="rotate(25 32 30)"/></g><circle cx="22" cy="26" r="4" fill="#f2a516"/></svg>' },
      { name:'Lime leaf', sub:'Fragrant', icon:'<svg viewBox="0 0 48 48"><g fill="#2f6b3a"><path d="M10 38 Q8 22 24 18 Q24 32 10 38Z"/><path d="M24 18 Q26 4 40 6 Q38 18 24 18Z"/></g><path d="M10 38 L24 18 L40 6" stroke="#a6c98a" stroke-width="1.5" fill="none"/></svg>' },
      { name:'Coconut milk', sub:'Rich and creamy', icon:'<svg viewBox="0 0 48 48"><path d="M6 24 A18 18 0 0 0 42 24Z" fill="#6b4a2e"/><ellipse cx="24" cy="24" rx="18" ry="5" fill="#fbf7ee"/><ellipse cx="24" cy="24" rx="14" ry="3" fill="#ffffff"/></svg>' } ],
    ok:(n, star) => ({ title:'Amok is ready', text:`You followed the chef through a sequence of ${n} ingredients. The kroeung smells wonderful. ${star ? 'She asks if you’ve cooked Khmer food before!' : 'Do it without a second chance for a star.'}` }),
    fail:n => ({ title:'The chef takes over', text:`You followed ${n ? `a sequence of ${n}` : 'the first steps'} before the order slipped. The chef laughs and finishes the paste with you.` })
  },
  // New in this app (Washington, the wrap-up): five stops of the journey, in the order they light up.
  route: {
    ready:'Watch the map…', show:'The route lights up…', you:'Your turn: retrace it', again:'Not quite. The map shows it again.',
    pads:[
      { name:'Andes', sub:'Cusco', icon:'<svg viewBox="0 0 48 48"><path d="M2 40 L16 14 L24 28 L32 10 L46 40Z" fill="#8a7a6a"/><path d="M32 10 L27 20 L32 18 L36 22Z" fill="#fff"/></svg>' },
      { name:'Moai', sub:'Easter Island', icon:'<svg viewBox="0 0 48 48"><path d="M14 44 V22 Q14 6 24 6 Q34 6 34 22 V44Z" fill="#5b544c"/><rect x="17" y="18" width="14" height="3" fill="#3a352f"/><rect x="21" y="22" width="6" height="10" fill="#4b453e"/></svg>' },
      { name:'Reef', sub:'Australia', icon:'<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#2aa6c4"/><path d="M8 34 Q16 22 24 32 T40 28" stroke="#fff" stroke-width="3" fill="none"/><path d="M14 38 V26 M14 32 L9 27 M14 30 L19 25" stroke="#f26b5b" stroke-width="3" fill="none" stroke-linecap="round"/></svg>' },
      { name:'Temples', sub:'Cambodia', icon:'<svg viewBox="0 0 48 48"><rect x="6" y="34" width="36" height="8" fill="#7a5f3e"/><path d="M12 34 V24 Q24 4 36 24 V34Z" fill="#8d6c49"/><path d="M20 34 V26 Q24 20 28 26 V34Z" fill="#4a3a28"/></svg>' },
      { name:'Souk', sub:'Marrakech', icon:'<svg viewBox="0 0 48 48"><rect x="16" y="14" width="16" height="30" fill="#9b5139"/><rect x="20" y="6" width="8" height="10" fill="#9b5139"/><circle cx="24" cy="4" r="2.4" fill="#e9b949"/><path d="M20 38 V32 Q24 27 28 32 V38Z" fill="#6e3526"/></svg>' } ],
    ok:(n, star) => ({ title:'Route retraced', text:`You retraced a chain of ${n} stops from memory. That is a journey worth remembering. ${star ? 'Not a single wrong turn!' : 'Do it without a second chance for a star.'}` }),
    fail:n => ({ title:'Lost on the map', text:`You followed ${n ? `a chain of ${n}` : 'the first stops'} before the route slipped away. Not to worry: you travelled it for real.` })
  }
};
