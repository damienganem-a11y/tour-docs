// Passport Explorer game: Fit (pick the piece that fits the hollow exactly). PORTED unchanged in logic and tuning from the owner's prototype; only the
// imports and the exports are new. Skins here: wall (Inca masonry, Peru), inlay (marble inlay, Agra).
import { setHud, shuffle, sfx } from './common.js';

export const fit = function(host, hud, onEnd, sk){
  const ROUNDS = 5, box = document.createElement('div'); box.className = 'fit-game'; host.prepend(box);
  let round = 0, firstTry = 0, tries = 0, busy = false, ended = false, t0 = 0, timer = 0, cur = null, timeout = 0;
  const BW = 300, BH = 200, board = sk.board(BW, BH);
  const makePoly = n => { const base = Math.random() * Math.PI * 2, st = Math.PI * 2 / n; return Array.from({ length:n }, (_, i) => [base + i * st + (Math.random() - .5) * st * 0.6, 30 + Math.random() * 16]); };
  const xy = p => p.map(([a, r]) => (Math.cos(a) * r).toFixed(1) + ',' + (Math.sin(a) * r).toFixed(1)).join(' ');
  function decoy(p, k){ const d = p.map(v => v.slice()), n = d.length, i = Math.floor(Math.random() * n), amt = [1.34, 1.28, 1.24, 1.2, 1.17][round];
    d[i][1] *= k === 0 ? amt : 1 / amt; d[(i + 2) % n][1] *= k === 0 ? 0.92 : 1.12; return d; }
  function paintHud(){ const s = Math.floor((performance.now() - t0) / 1000); setHud(hud, `<span class="pill">${sk.unit} ${Math.min(round + 1, ROUNDS)} / ${ROUNDS}</span><span class="pill">Perfect fits ${firstTry}</span><span class="pill">${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span>`); }
  function show(){
    const p = makePoly(5 + Math.floor(Math.random() * 3)), col = sk.piece(round);
    cur = shuffle([{ p, ok:true }, { p:decoy(p, 0), ok:false }, { p:decoy(p, 1), ok:false }]); tries = 0; busy = false;
    box.innerHTML = `<svg class="board" viewBox="0 0 ${BW} ${BH}" aria-label="${sk.boardLabel}">${sk.defs ?? ''}${board}<g transform="translate(150 100)"><polygon id="gap" points="${xy(p)}" fill="${sk.gap[0]}" stroke="${sk.gap[1]}" stroke-width="1.5" stroke-linejoin="round"/></g></svg>
      <p class="muted" style="font-size:14px;text-align:center">${sk.ask}</p>
      <div class="cands">${cur.map((o, k) => `<button class="cand" data-k="${k}" aria-label="Piece ${k + 1}"><svg viewBox="-64 -64 128 128">${sk.defs ?? ''}<polygon points="${xy(o.p)}" fill="${col[0]}" stroke="${col[1]}" stroke-width="2.5" stroke-linejoin="round" filter="${sk.pieceFilter ?? ''}"/></svg></button>`).join('')}</div>`;
    box.querySelectorAll('.cand').forEach(b => b.onclick = () => pick(+b.dataset.k, b, col));
    paintHud();
  }
  function pick(k, btn, col){
    if (busy || ended) return;
    if (cur[k].ok) {
      busy = true; if (tries === 0) firstTry++; sfx('right');
      const g = document.getElementById('gap'); g.setAttribute('fill', col[0]); g.setAttribute('stroke', col[1]); btn.disabled = true;
      timeout = setTimeout(() => { round++; if (round >= ROUNDS) finish(); else show(); }, 750);
    } else { tries++; sfx('wrong'); btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake'); btn.disabled = true; }
  }
  function finish(){ ended = true; clearInterval(timer); const s = Math.round((performance.now() - t0) / 1000), star = firstTry >= 4; onEnd({ star, ...sk.ok(firstTry, s, star) }); }
  box.innerHTML = `<svg class="board" viewBox="0 0 ${BW} ${BH}" aria-hidden="true">${sk.defs ?? ''}${board}</svg>`;
  setHud(hud, `<span class="pill">${sk.unit} 1 / ${ROUNDS}</span><span class="pill">Perfect fits 0</span><span class="pill">0:00</span>`);
  return { start(){ t0 = performance.now(); timer = setInterval(paintHud, 500); show(); }, stop(){ ended = true; clearInterval(timer); clearTimeout(timeout); }, move(){} };
};

export const fitSkins = {
  wall: {
    unit:'Gap', boardLabel:'A stone wall with one gap', ask:'Which stone fits the gap exactly?', gap:['url(#wallGap)','#1d1713'],
    piece:() => ['url(#wallStone)','#8f8270'], pieceFilter:'url(#wallDrop)',
    // Gradients for the stones, a deep shadow for the gap, a soft drop shadow for the pieces, and a fine rock grain over the wall.
    defs:`<defs><linearGradient id="wallStone" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#f1e8d6"/><stop offset="1" stop-color="#c2b399"/></linearGradient>
      <radialGradient id="wallGap" cx="0.5" cy="0.4" r="0.75"><stop offset="0" stop-color="#4a3f35"/><stop offset="1" stop-color="#17110d"/></radialGradient>
      <filter id="wallDrop" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2.5" stdDeviation="2" flood-color="#2a1f14" flood-opacity=".45"/></filter>
      <filter id="wallGrain"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="4" result="n"/><feColorMatrix type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0 0.12  0 0 0 0.35 -0.08"/></filter></defs>`,
    board(BW, BH){   // a wall of mortarless stones: a jittered grid, each cell one stone, lit from the top left
      const GC = 7, GR = 5, TONES = ['#f1e8d6','#e8dcc4','#f6eedd','#e0d2b7','#ece1cb'], pts = []; let s = '';
      for (let r = 0; r <= GR; r++) { pts.push([]); for (let q = 0; q <= GC; q++) { const ex = q === 0 || q === GC, ey = r === 0 || r === GR;
        pts[r].push([q * BW / GC + (ex ? 0 : (Math.random() - .5) * 22), r * BH / GR + (ey ? 0 : (Math.random() - .5) * 18)]); } }
      for (let r = 0; r < GR; r++) for (let q = 0; q < GC; q++) {
        const c = [pts[r][q], pts[r][q + 1], pts[r + 1][q + 1], pts[r + 1][q]], list = c.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
        s += `<polygon points="${list}" fill="${TONES[(r * 3 + q) % 5]}" stroke="#a89b84" stroke-width="1.4" stroke-linejoin="round"/>`;
        s += `<polygon points="${list}" fill="url(#wallStone)" opacity=".45" stroke="none"/>`;
        s += `<polyline points="${[c[0], c[1]].map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#fffaf0" stroke-width="1.6" opacity=".7" stroke-linecap="round"/>`;
        s += `<polyline points="${[c[2], c[3]].map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#6b5f4b" stroke-width="1.8" opacity=".35" stroke-linecap="round"/>`;
      }
      s += `<rect width="${BW}" height="${BH}" filter="url(#wallGrain)" opacity=".6"/>`;
      return s; },
    ok:(n, s, star) => ({ title:star ? 'A true Inca mason' : 'The wall stands', text:`${n} of 5 stones fitted at the first try, in ${s} seconds. ${star ? 'Not even a knife blade would slip between them.' : 'Get 4 right first time for a star.'}` })
  },
  inlay: {
    unit:'Stone', boardLabel:'A marble panel with one hollow', ask:'Which gemstone fits the hollow exactly?', gap:['#d6cdbd','#a89d8a'],
    piece:r => [['#2d4d9a','#1d3570'], ['#b5432e','#86301f'], ['#2f7d5c','#1f5a41'], ['#3b3b44','#1f1f26'], ['#2aa6a0','#1c7a75']][r % 5],
    board(BW, BH){
      let s = `<rect width="${BW}" height="${BH}" fill="#f7f3ec"/>`;
      for (let i = 0; i < 6; i++) s += `<path d="M${-20 + i * 60} 0 Q${20 + i * 50} ${80 + i * 10} ${-10 + i * 64} ${BH}" stroke="#e2dacd" stroke-width="1.2" fill="none"/>`;
      s += `<rect x="10" y="10" width="${BW - 20}" height="${BH - 20}" rx="6" fill="none" stroke="#c9a85c" stroke-width="3"/><rect x="18" y="18" width="${BW - 36}" height="${BH - 36}" rx="4" fill="none" stroke="#c9a85c" stroke-width="1"/>`;
      [[40, 40], [260, 40], [40, 160], [260, 160]].forEach(([x, y]) => { s += `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map(a => `<ellipse rx="4" ry="9" cy="-8" fill="#b5432e" transform="rotate(${a})"/>`).join('')}<circle r="4" fill="#e9a800"/></g>`; });
      s += `<path d="M60 100 Q80 70 100 100 T140 100 M160 100 Q180 130 200 100 T240 100" stroke="#2f7d5c" stroke-width="2.5" fill="none"/>`;
      return s; },
    ok:(n, s, star) => ({ title:star ? 'Worthy of the Taj' : 'The panel is finished', text:`${n} of 5 gemstones set at the first try, in ${s} seconds. ${star ? 'The joins are invisible to the eye.' : 'Get 4 right first time for a star.'}` })
  }
};
