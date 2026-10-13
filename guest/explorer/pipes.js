// Passport Explorer game: Pipes (rotate channel stones to make water flow). Skin: water (Petra).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { setHud, sfx, shuffle, tone } from './common.js';

export const pipes = function(host, hud, onEnd, sk){
  const SIZES = [[4, 4], [5, 5], [6, 5]], box = document.createElement('div'); box.className = 'fit-game'; host.prepend(box);
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0], BIT = [1, 2, 4, 8], rotM = m => ((m << 1) | (m >> 3)) & 15;
  let round = 0, R = 0, C = 0, tiles = [], r0 = 0, r1 = 0, t0 = 0, timer = 0, ended = false, busy = false, taps = 0;
  function makePuzzle(){
    [R, C] = SIZES[round];
    let path = null;
    for (let tries = 0; !path && tries < 200; tries++) {
      r0 = Math.floor(Math.random() * R); const seen = new Set([r0 * C]), p = [[r0, 0]];
      const walk = () => { const [r, c] = p[p.length - 1]; if (c === C - 1 && p.length >= C + 2) return true;
        for (const d of shuffle([0, 1, 1, 2, 3])) { const nr = r + DY[d], nc = c + DX[d]; if (nr < 0 || nr >= R || nc < 0 || nc >= C || seen.has(nr * C + nc)) continue;
          seen.add(nr * C + nc); p.push([nr, nc]); if (walk()) return true; p.pop(); seen.delete(nr * C + nc); }
        return false; };
      if (walk()) path = p;
    }
    r1 = path[path.length - 1][0];
    tiles = Array.from({ length:R * C }, () => { const straight = Math.random() < .45; let m = straight ? 5 : 3; const k = Math.floor(Math.random() * 4); for (let i = 0; i < k; i++) m = rotM(m); return { m }; });
    const dirTo = (a, b) => b[0] < a[0] ? 0 : b[1] > a[1] ? 1 : b[0] > a[0] ? 2 : 3;
    path.forEach((cell, i) => {
      const inD = i === 0 ? 3 : (dirTo(cell, path[i - 1])), outD = i === path.length - 1 ? 1 : dirTo(cell, path[i + 1]);
      let m = BIT[inD] | BIT[outD]; const k = 1 + Math.floor(Math.random() * 3); for (let j = 0; j < k; j++) m = rotM(m);
      tiles[cell[0] * C + cell[1]].m = m;
    });
    if (flood().done) makePuzzle();
  }
  function flood(){
    const wet = new Set(), q = [];
    if (tiles[r0 * C].m & 8) { wet.add(r0 * C); q.push([r0, 0]); }
    while (q.length) { const [r, c] = q.shift(), m = tiles[r * C + c].m;
      for (let d = 0; d < 4; d++) { if (!(m & BIT[d])) continue; const nr = r + DY[d], nc = c + DX[d]; if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
        const k = nr * C + nc; if (wet.has(k) || !(tiles[k].m & BIT[(d + 2) % 4])) continue; wet.add(k); q.push([nr, nc]); } }
    const done = wet.has(r1 * C + C - 1) && (tiles[r1 * C + C - 1].m & 2);
    return { wet, done:!!done };
  }
  function tileSVG(m, wet){
    const col = wet ? '#3d8fd1' : '#9a5a44', ends = [[50, 0], [100, 50], [50, 100], [0, 50]];
    let s = `<svg viewBox="0 0 100 100"><rect x="2" y="2" width="96" height="96" rx="12" fill="${wet ? '#f3d9c4' : '#e9c4a6'}"/>`;
    for (let d = 0; d < 4; d++) if (m & BIT[d]) s += `<line x1="50" y1="50" x2="${ends[d][0]}" y2="${ends[d][1]}" stroke="#7a3830" stroke-width="30" stroke-linecap="${d % 2 ? 'butt' : 'butt'}"/><line x1="50" y1="50" x2="${ends[d][0]}" y2="${ends[d][1]}" stroke="${col}" stroke-width="18"/>`;
    return s + `<circle cx="50" cy="50" r="15" fill="#7a3830"/><circle cx="50" cy="50" r="9" fill="${col}"/></svg>`;
  }
  function paintHud(){ const s = Math.floor((performance.now() - t0) / 1000); setHud(hud, `<span class="pill">Channel ${Math.min(round + 1, 3)} / 3</span><span class="pill">${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span><span class="muted" style="font-size:13px">Tap a stone to turn it</span>`); }
  function render(){
    const { wet, done } = flood();
    let cells = '';
    for (let r = 0; r < R; r++) {
      cells += `<div class="pend">${r === r0 ? sk.srcIcon : ''}</div>`;
      for (let c = 0; c < C; c++) cells += `<button class="ptile" data-k="${r * C + c}" aria-label="Channel stone, row ${r + 1}, column ${c + 1}">${tileSVG(tiles[r * C + c].m, wet.has(r * C + c))}</button>`;
      cells += `<div class="pend">${r === r1 ? (done ? sk.dstFull : sk.dstIcon) : ''}</div>`;
    }
    box.innerHTML = `<p class="muted" style="font-size:14px;text-align:center">${sk.ask}</p>
      <div class="pgrid" style="grid-template-columns:32px repeat(${C},1fr) 32px">${cells}</div>
      <div class="row" style="justify-content:space-between;font-size:13px" class="muted"><span>${sk.srcName}</span><span>${sk.dstName}</span></div>`;
    box.querySelectorAll('.ptile').forEach(b => b.onclick = () => {
      if (busy || ended) return; const k = +b.dataset.k; tiles[k].m = rotM(tiles[k].m); taps++; tone(420, 380, .06, 'triangle', .05); render();
    });
    if (done && !busy) { busy = true; sfx('right'); setTimeout(() => { round++; if (round >= SIZES.length) finish(); else { makePuzzle(); busy = false; render(); paintHud(); } }, 900); }
  }
  function finish(){ ended = true; clearInterval(timer); const s = Math.round((performance.now() - t0) / 1000), star = s <= sk.starTime; onEnd({ star, ...sk.ok(s, star) }); }
  makePuzzle(); render(); box.querySelectorAll('.ptile').forEach(b => b.disabled = true);
  setHud(hud, `<span class="pill">Channel 1 / 3</span><span class="pill">0:00</span>`);
  return { start(){ t0 = performance.now(); timer = setInterval(paintHud, 500); render(); paintHud(); }, stop(){ ended = true; clearInterval(timer); }, move(){} };
};
export const pipesSkins = {
  water: {
    ask:'Turn the stones so the rainwater flows from the dam to the cistern.', srcName:'← Dam', dstName:'Cistern →', starTime:120,
    srcIcon:'<svg viewBox="0 0 32 40"><rect x="2" y="4" width="14" height="32" rx="3" fill="#7a3830"/><path d="M16 20 H32" stroke="#3d8fd1" stroke-width="10"/><path d="M8 10 q3 4 0 8 q-3 -4 0 -8z" fill="#3d8fd1"/></svg>',
    dstIcon:'<svg viewBox="0 0 32 40"><path d="M0 20 H10" stroke="#9a5a44" stroke-width="10"/><rect x="10" y="6" width="20" height="28" rx="4" fill="#7a3830"/><rect x="14" y="10" width="12" height="20" rx="2" fill="#e9c4a6"/></svg>',
    dstFull:'<svg viewBox="0 0 32 40"><path d="M0 20 H10" stroke="#3d8fd1" stroke-width="10"/><rect x="10" y="6" width="20" height="28" rx="4" fill="#7a3830"/><rect x="14" y="10" width="12" height="20" rx="2" fill="#3d8fd1"/></svg>',
    ok:(s, star) => ({ title:'Water for Petra', text:`All three channels flow, in ${s} seconds. The city will have water through the dry season. ${star ? 'A true Nabataean engineer!' : 'Finish within 2 minutes for a star.'}` })
  }
};
