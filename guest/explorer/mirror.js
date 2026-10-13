// Passport Explorer game: Mirror (complete the right half of a symmetric design). Skins: taj (Agra), siapo (Samoa), mandala (Kathmandu, new).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { setHud, sfx, tone } from './common.js';

export const mirror = function(host, hud, onEnd, sk){
  const R = 6, C = 8, HALF = 4, box = document.createElement('div'); box.className = 'mir-game'; host.prepend(box);
  let round = 0, t0 = 0, timer = 0, ended = false, L = [], Rt = [], busy = false;
  const colorOf = v => v === 0 ? sk.empty : sk.colors[v - 1];
  function makeLeft(){ let n; do { n = 0; L = Array.from({ length:R }, () => Array.from({ length:HALF }, () => { const v = Math.random() < sk.dens[round] ? 1 + Math.floor(Math.random() * sk.colors.length) : 0; if (v) n++; return v; })); } while (n < 5); Rt = Array.from({ length:R }, () => Array(HALF).fill(0)); }
  const solved = () => L.every((row, r) => row.every((v, q) => Rt[r][HALF - 1 - q] === v));
  function paintHud(){ const s = Math.floor((performance.now() - t0) / 1000); setHud(hud, `<span class="pill">Design ${Math.min(round + 1, 3)} / 3</span><span class="pill">${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span><span class="muted" style="font-size:13px">${sk.hint}</span>`); }
  function render(){
    let cells = '';
    for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
      if (q < HALF) cells += `<div class="mcell" style="background:${colorOf(L[r][q])}"></div>`;
      else { const j = q - HALF; cells += `<button class="mcell" data-r="${r}" data-j="${j}" style="background:${colorOf(Rt[r][j])}" aria-label="Row ${r + 1}, column ${q + 1}"></button>`; }
    }
    box.innerHTML = `<p class="muted" style="font-size:14px;text-align:center">Make the right half a mirror image of the left.</p>
      <div class="mgrid" id="mg" style="grid-template-columns:repeat(${C},1fr);background:${sk.board}">${cells}<span class="maxis" style="background:${sk.axis}"></span></div>
      <div class="row" style="justify-content:center">${sk.colors.map((c, i) => `<span class="pill" style="background:${c};color:#fff">${sk.names[i]}</span>`).join('')}</div>`;
    box.querySelectorAll('button.mcell').forEach(b => b.onclick = () => {
      if (busy || ended) return;
      const r = +b.dataset.r, j = +b.dataset.j; Rt[r][j] = (Rt[r][j] + 1) % (sk.colors.length + 1);
      b.style.background = colorOf(Rt[r][j]); tone(500 + Rt[r][j] * 120, 520 + Rt[r][j] * 120, .05, 'triangle', .04);
      if (solved()) { busy = true; sfx('right'); document.getElementById('mg').classList.add('win'); setTimeout(() => { round++; if (round >= 3) finish(); else { makeLeft(); busy = false; render(); paintHud(); } }, 700); }
    });
  }
  function finish(){ ended = true; clearInterval(timer); const s = Math.round((performance.now() - t0) / 1000), star = s <= sk.starTime; onEnd({ star, ...sk.ok(s, star) }); }
  makeLeft(); render(); box.querySelectorAll('button.mcell').forEach(b => b.disabled = true);
  setHud(hud, `<span class="pill">Design 1 / 3</span><span class="pill">0:00</span>`);
  return { start(){ t0 = performance.now(); timer = setInterval(paintHud, 500); render(); paintHud(); }, stop(){ ended = true; clearInterval(timer); }, move(){} };
};
export const mirrorSkins = {
  taj: { colors:['#1f6f5f','#2d4d9a','#b5432e'], names:['Jade','Lapis','Carnelian'], empty:'#f7f3ec', board:'#e4dccd', axis:'#c9a85c', dens:[.32, .45, .58], starTime:120, hint:'Tap a square to change its stone',
    ok:(s, star) => ({ title:star ? 'Perfect symmetry' : 'Symmetry restored', text:`Three designs mirrored in ${s} seconds. ${star ? 'Shah Jahan’s architects would approve.' : 'Finish all three in under 2 minutes for a star.'}` }) },
  siapo: { colors:['#3b2316','#111111','#a4522c'], names:['Brown','Black','Rust'], empty:'#ead8b8', board:'#cdb48a', axis:'#7a4a2a', dens:[.32, .45, .58], starTime:120, hint:'Tap a square to change its color',
    ok:(s, star) => ({ title:star ? 'A master of siapo' : 'The siapo is finished', text:`Three designs completed in ${s} seconds. ${star ? 'A gift fit for a ceremony.' : 'Finish all three in under 2 minutes for a star.'}` }) },
  // New in this app (Kathmandu): same game, Newar mandala colors.
  mandala: { colors:['#c8102e','#e9a800','#1b4f8a'], names:['Crimson','Saffron','Blue'], empty:'#fbf3e4', board:'#e9dcc4', axis:'#c98a3d', dens:[.32, .45, .58], starTime:120, hint:'Tap a square to change its color',
    ok:(s, star) => ({ title:star ? 'A balanced mandala' : 'The mandala is complete', text:`Three mandalas mirrored in ${s} seconds. ${star ? 'The painters of Patan would smile.' : 'Finish all three in under 2 minutes for a star.'}` }) }
};
