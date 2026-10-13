// Passport Explorer game: Hidden (find camouflaged things in a picture, with hints). Skins: reef (Great Barrier Reef), angkor (Angkor).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { canvasIn, circ, ell, mulberry32, plural, setHud, sfx } from './common.js';

export const hidden = function(host, hud, onEnd, sk){
  const c = canvasIn(host, sk.label), ctx = c.getContext('2d'), bgC = document.createElement('canvas'), bctx = bgC.getContext('2d');
  const seed = Math.floor(Math.random() * 1e9), pr = mulberry32(seed ^ 77), N = sk.n, spots = [];
  for (let tries = 0; spots.length < N + sk.decoys && tries < 4000; tries++) { const x = 0.08 + pr() * 0.84, y = 0.08 + pr() * 0.84; if (spots.every(s => Math.hypot(s.x - x, (s.y - y) * 1.1) > 0.13)) spots.push({ x, y }); }
  const targets = spots.slice(0, N).map((s, i) => ({ ...s, i, found:false })), decoys = spots.slice(N);
  let W = 0, H = 0, S = 1, timer = 0, raf = 0, t0 = 0, playing = false, ended = false, found = 0, miss = 0, hints = 0, marks = [], hintAt = null, msg = '', msgT = 0;
  function size(){ const dpr = Math.min(3, window.devicePixelRatio || 1); W = host.clientWidth; H = Math.round(Math.max(380, Math.min(540, W * 1.05))); S = Math.min(W, H) / 420;
    [c, bgC].forEach(cv => { cv.width = W * dpr; cv.height = H * dpr; }); c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = mulberry32(seed); sk.bg(bctx, W, H, rnd, S);
    decoys.forEach(d => sk.decoy(bctx, d.x * W, d.y * H, S, rnd)); targets.forEach(t => sk.target(bctx, t.x * W, t.y * H, S, rnd, t.i)); draw(); }
  const now = () => (performance.now() - t0) / 1000;
  c.addEventListener('pointerdown', e => {
    if (!playing || ended) return;
    const b = c.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const t = targets.find(t => !t.found && Math.hypot(t.x * W - x, t.y * H - y) < sk.r * S * 1.25);
    if (t) { t.found = true; found++; sfx('right'); msg = sk.names[t.i % sk.names.length] + ' found!'; msgT = now(); if (found >= N) end(true); }
    else { miss++; sfx('wrong'); marks.push({ x, y, t:now() }); }
  });
  hud.addEventListener('click', e => { if (!e.target.closest('[data-hint]') || !playing || ended) return; const t = targets.find(t => !t.found); if (t) { hints++; hintAt = { x:t.x * W + (Math.random() - .5) * 60 * S, y:t.y * H + (Math.random() - .5) * 60 * S, t:now() }; } });
  function paintHud(){ const left = Math.max(0, Math.ceil(sk.time - now())); setHud(hud, `<span class="pill gold">Found ${found} / ${N}</span><span class="pill">${left} s</span><span class="pill">Misses ${miss}</span><button class="pill" data-hint>Hint</button>`); if (left <= 0 && !ended) end(false); }
  function start(){ playing = true; t0 = performance.now(); timer = setInterval(paintHud, 250); paintHud(); raf = requestAnimationFrame(loop); }
  function loop(){ draw(); if (!ended) raf = requestAnimationFrame(loop); }
  function stop(){ ended = true; clearInterval(timer); cancelAnimationFrame(raf); removeEventListener('resize', size); }
  function end(all){ ended = true; playing = false; clearInterval(timer); cancelAnimationFrame(raf); targets.forEach(t => t.found = true); draw();
    const star = all && miss <= 2 && hints === 0; onEnd(all ? { star, ...sk.ok(found, miss, hints, star) } : { star:false, ...sk.fail(found) }); }
  function draw(){
    if (!W) return;
    ctx.clearRect(0, 0, W, H); ctx.drawImage(bgC, 0, 0, W, H);
    const tt = playing ? now() : 0;
    targets.forEach(t => { if (!t.found) return; ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(t.x * W, t.y * H, sk.r * S * 1.15, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.5; ctx.stroke(); });
    marks = marks.filter(m => tt - m.t < 0.8); marks.forEach(m => { const a = 1 - (tt - m.t) / 0.8; ctx.strokeStyle = `rgba(209,81,59,${a})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(m.x - 8, m.y - 8); ctx.lineTo(m.x + 8, m.y + 8); ctx.moveTo(m.x + 8, m.y - 8); ctx.lineTo(m.x - 8, m.y + 8); ctx.stroke(); });
    if (hintAt && tt - hintAt.t < 1.8) { const k = (tt - hintAt.t) / 1.8; ctx.strokeStyle = `rgba(255,215,106,${1 - k})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hintAt.x, hintAt.y, 80 * S * (1 - k * 0.3), 0, Math.PI * 2); ctx.stroke(); }
    if (msg && tt - msgT < 1.2) { ctx.font = '700 18px Outfit, sans-serif'; ctx.textAlign = 'center'; const tw = ctx.measureText(msg).width + 28;
      ctx.fillStyle = 'rgba(23,23,26,.8)'; ctx.beginPath(); ctx.roundRect(W / 2 - tw / 2, 14, tw, 34, 17); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(msg, W / 2, 37); }
  }
  size(); addEventListener('resize', size);
  setHud(hud, `<span class="pill">Find ${N}</span><span class="pill">${sk.time} s</span>`);
  return { start, stop, move(){} };
};

const eyes = (ctx, x, y, s, gap) => { [-1, 1].forEach(k => { circ(ctx, x + k * gap * s, y, 3.2 * s, '#f6f0dc'); circ(ctx, x + k * gap * s, y, 1.6 * s, '#111'); }); };
const REEF_TONES = ['#a8916c','#8f7a5a','#b9a27c','#7c6a50','#c2ab84','#9d8763'];
function relief(ctx, s, drawShape){ ctx.save(); ctx.translate(1.6 * s, 1.6 * s); ctx.fillStyle = '#6f5538'; drawShape(); ctx.restore(); ctx.fillStyle = '#c9aa80'; drawShape(); ctx.save(); ctx.globalAlpha = .35; ctx.translate(-1 * s, -1 * s); ctx.fillStyle = '#efdcb8'; ctx.beginPath(); drawShape(true); ctx.restore(); }
export const hiddenSkins = {
  reef: {
    label:'Find the camouflaged creatures: tap each one', n:5, decoys:0, r:22, time:90, names:['Octopus','Stonefish','Cuttlefish','Decorator crab','Flounder'],
    bg(ctx, W, H, rnd, s){ const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#b9a681'); g.addColorStop(1, '#9e8a66'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 340; i++) { ell(ctx, rnd() * W, rnd() * H, (6 + rnd() * 22) * s, (5 + rnd() * 14) * s, REEF_TONES[Math.floor(rnd() * 6)], rnd() * 3); }
      for (let i = 0; i < 40; i++) { const x = rnd() * W, y = rnd() * H; ctx.strokeStyle = rnd() < .5 ? '#c98f86' : '#8f9a5f'; ctx.lineWidth = 3 * s; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - .5) * 20 * s, y - 16 * s); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - .5) * 26 * s, y - 10 * s); ctx.stroke(); }
      for (let i = 0; i < 90; i++) circ(ctx, rnd() * W, rnd() * H, (1 + rnd() * 2) * s, rnd() < .5 ? '#6f5f45' : '#d4c19a'); },
    decoy(){},
    target(ctx, x, y, s, rnd, i){ const tone = REEF_TONES[Math.floor(rnd() * 6)], k = i % 5;
      if (k === 0) { ctx.strokeStyle = tone; ctx.lineWidth = 4 * s; ctx.lineCap = 'round'; for (let a = 0; a < 6; a++) { const an = Math.PI * 0.15 + a * 0.55; ctx.beginPath(); ctx.moveTo(x, y + 4 * s); ctx.quadraticCurveTo(x + Math.cos(an) * 18 * s, y + Math.sin(an) * 12 * s + 8 * s, x + Math.cos(an) * 24 * s, y + Math.sin(an) * 20 * s); ctx.stroke(); } ell(ctx, x, y - 4 * s, 13 * s, 11 * s, tone); eyes(ctx, x, y + 2 * s, s, 5); }
      else if (k === 1) { [[-8, 2, 9], [6, 0, 10], [0, -6, 9], [-2, 6, 8], [10, 6, 6]].forEach(([dx, dy, r]) => circ(ctx, x + dx * s, y + dy * s, r * s, tone)); eyes(ctx, x + 2 * s, y - 8 * s, s, 4); }
      else if (k === 2) { ell(ctx, x, y, 22 * s, 11 * s, '#cbb38b'); ell(ctx, x, y, 18 * s, 8 * s, tone); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5 * s; circ(ctx, x + 12 * s, y - 3 * s, 3.5 * s, '#f6f0dc'); ctx.beginPath(); ctx.moveTo(x + 10 * s, y - 4 * s); ctx.lineTo(x + 12 * s, y - 2 * s); ctx.lineTo(x + 14 * s, y - 4 * s); ctx.stroke(); }
      else if (k === 3) { ctx.strokeStyle = tone; ctx.lineWidth = 3 * s; [-1, 1].forEach(sd => { for (let l = 0; l < 3; l++) { ctx.beginPath(); ctx.moveTo(x + sd * 8 * s, y + (l * 5 - 4) * s); ctx.lineTo(x + sd * 20 * s, y + (l * 7 - 2) * s); ctx.stroke(); } }); circ(ctx, x, y, 11 * s, tone); circ(ctx, x - 4 * s, y - 4 * s, 4 * s, '#c98f86'); ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(x - 4 * s, y - 9 * s); ctx.lineTo(x - 5 * s, y - 15 * s); ctx.moveTo(x + 4 * s, y - 9 * s); ctx.lineTo(x + 5 * s, y - 15 * s); ctx.stroke(); eyes(ctx, x, y - 15 * s, s, 5); }
      else { ell(ctx, x, y, 20 * s, 12 * s, tone); for (let d = 0; d < 8; d++) circ(ctx, x + (rnd() - .5) * 28 * s, y + (rnd() - .5) * 14 * s, 1.8 * s, '#7fb3c9'); eyes(ctx, x + 6 * s, y - 4 * s, s, 3); } },
    ok:(n, m, h, star) => ({ title:star ? 'Eagle-eyed!' : 'All found', text:`You found all ${n} creatures with ${plural(m, 'miss')}${h ? ` and ${plural(h, 'hint')}` : ''}. ${star ? 'A trained diver couldn’t do better.' : 'No hints and at most two misses for a star.'}` }),
    fail:n => ({ title:'Masters of disguise win', text:`You found ${n} of 5 before your air ran low. That’s exactly why camouflage works!` })
  },
  angkor: {
    label:'Find the five dancing apsaras in the carved wall', n:5, decoys:15, r:20, time:90, names:['Apsara'],
    bg(ctx, W, H, rnd, s){ const tones = ['#b8986f','#ad8d65','#c2a37a','#a68560']; const bh = 46 * s;
      for (let r = 0, y = 0; y < H; r++, y += bh) { let x = r % 2 ? -bh * 0.6 : 0; while (x < W) { const bw = bh * (1.4 + rnd() * 1.2); ctx.fillStyle = tones[Math.floor(rnd() * 4)]; ctx.fillRect(x, y, bw, bh); ctx.strokeStyle = '#8a6c4a'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, bw, bh); x += bw; } }
      for (let i = 0; i < 26; i++) { const x = rnd() * W, y = rnd() * H, r = (6 + rnd() * 6) * s; ctx.strokeStyle = '#8f714d'; ctx.lineWidth = 2 * s; for (let p = 0; p < 8; p++) { const a = p * Math.PI / 4; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.45, r * 0.2, a, 0, Math.PI * 2); ctx.stroke(); } }
      for (let i = 0; i < 20; i++) { const x = rnd() * W, y = rnd() * H; ctx.strokeStyle = '#94764f'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.arc(x, y, 8 * s, 0, Math.PI * 1.6); ctx.arc(x + 8 * s, y, 4 * s, Math.PI, Math.PI * 2.6); ctx.stroke(); }
      for (let i = 0; i < 60; i++) { ctx.fillStyle = rnd() < .5 ? 'rgba(80,90,60,.18)' : 'rgba(40,30,20,.15)'; ctx.beginPath(); ctx.ellipse(rnd() * W, rnd() * H, (4 + rnd() * 12) * s, (3 + rnd() * 8) * s, rnd() * 3, 0, Math.PI * 2); ctx.fill(); } },
    decoy(ctx, x, y, s){ relief(ctx, s, () => { ctx.beginPath(); ctx.arc(x, y - 18 * s, 5 * s, 0, Math.PI * 2); ctx.rect(x - 3 * s, y - 28 * s, 6 * s, 6 * s); ctx.rect(x - 5 * s, y - 13 * s, 10 * s, 13 * s); ctx.moveTo(x - 6 * s, y); ctx.lineTo(x + 6 * s, y); ctx.lineTo(x + 5 * s, y + 18 * s); ctx.lineTo(x - 5 * s, y + 18 * s); ctx.closePath(); ctx.rect(x - 9 * s, y - 12 * s, 3 * s, 14 * s); ctx.rect(x + 6 * s, y - 12 * s, 3 * s, 14 * s); ctx.fill(); }); },
    target(ctx, x, y, s){ relief(ctx, s, () => { ctx.beginPath(); ctx.arc(x - 2 * s, y - 18 * s, 5 * s, 0, Math.PI * 2);
        ctx.moveTo(x - 7 * s, y - 22 * s); ctx.lineTo(x - 6 * s, y - 34 * s); ctx.lineTo(x - 3 * s, y - 25 * s); ctx.lineTo(x - 2 * s, y - 37 * s); ctx.lineTo(x + 1 * s, y - 25 * s); ctx.lineTo(x + 4 * s, y - 34 * s); ctx.lineTo(x + 3 * s, y - 22 * s); ctx.closePath();
        ctx.moveTo(x - 6 * s, y - 13 * s); ctx.lineTo(x + 5 * s, y - 13 * s); ctx.lineTo(x + 3 * s, y); ctx.lineTo(x - 6 * s, y); ctx.closePath();
        ctx.moveTo(x - 9 * s, y); ctx.lineTo(x + 8 * s, y); ctx.lineTo(x + 12 * s, y + 8 * s); ctx.lineTo(x - 12 * s, y + 8 * s); ctx.closePath();
        ctx.moveTo(x - 6 * s, y + 8 * s); ctx.lineTo(x - 14 * s, y + 14 * s); ctx.lineTo(x - 8 * s, y + 20 * s); ctx.lineTo(x - 11 * s, y + 13 * s); ctx.closePath();
        ctx.moveTo(x + 4 * s, y + 8 * s); ctx.lineTo(x + 13 * s, y + 13 * s); ctx.lineTo(x + 6 * s, y + 20 * s); ctx.lineTo(x + 9 * s, y + 13 * s); ctx.closePath();
        ctx.moveTo(x - 6 * s, y - 12 * s); ctx.lineTo(x - 16 * s, y - 20 * s); ctx.lineTo(x - 15 * s, y - 24 * s); ctx.lineTo(x - 5 * s, y - 15 * s); ctx.closePath();
        ctx.moveTo(x + 5 * s, y - 12 * s); ctx.lineTo(x + 16 * s, y - 8 * s); ctx.lineTo(x + 18 * s, y - 13 * s); ctx.lineTo(x + 6 * s, y - 15 * s); ctx.closePath(); ctx.fill(); }); },
    ok:(n, m, h, star) => ({ title:star ? 'Eyes of a temple guide' : 'All five found', text:`You found all ${n} apsaras with ${plural(m, 'miss')}${h ? ` and ${plural(h, 'hint')}` : ''}. ${star ? 'Not even a hint needed.' : 'No hints and at most two misses for a star.'}` }),
    fail:n => ({ title:'The light changes', text:`You found ${n} of 5 apsaras before the sun moved on. Locals say you see new ones on every visit.` })
  }
};
