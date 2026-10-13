// Passport Explorer game: Rhythm (tap left or right as the beats reach the line). Skins: moai (Easter Island), slap (Samoa), jump (Serengeti).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { canvasIn, circ, setHud, skyC, tone, glow, groundShadow } from './common.js';

export const rhythm = function(host, hud, onEnd, sk){
  const c = canvasIn(host, sk.label), ctx = c.getContext('2d');
  let W = 0, H = 0, SH = 0, raf = 0, t0 = 0, playing = false, ended = false;
  const notes = []; let t = 0;
  if (sk.pattern === 'alt') for (let i = 0; i < sk.n; i++) { notes.push({ t, lane:i % 2 }); t += sk.interval; }
  else if (sk.pattern === 'slap') { // short repeating figures (L L R, L R R…), a gentle speed-up, no half beats
    const FIG = [[0, 0, 1], [0, 1, 1], [0, 1, 0, 1], [1, 1, 0]]; let iv = sk.interval;
    while (notes.length < sk.n) { FIG[Math.floor(Math.random() * FIG.length)].forEach(lane => { if (notes.length < sk.n) { notes.push({ t, lane }); t += iv; } }); t += iv * 0.5; iv = Math.max(sk.interval * 0.85, iv * 0.97); } }
  else for (let i = 0; i < sk.n; i++) { notes.push({ t, lane:0 }); t += sk.interval * (Math.random() < .25 ? 1.5 : 1); }
  const LEAD = 2.2, TRAVEL = 1.5, END = notes[notes.length - 1].t + 0.8;
  let perfect = 0, good = 0, miss = 0;
  const st = { lastHit:-9, lane:0, grade:0, hits:0, n:notes.length, flash:'', flashT:-9 };
  const songT = () => (performance.now() - t0) / 1000 - LEAD;
  function size(){ const dpr = Math.min(3, window.devicePixelRatio || 1); W = host.clientWidth; H = Math.round(Math.max(420, Math.min(540, W * 1.15))); SH = Math.round(H * 0.44);
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(-LEAD); }
  const laneX = l => sk.lanes === 1 ? W / 2 : (l === 0 ? W * 0.3 : W * 0.7), hitY = () => H - 70;
  function hit(lane){
    if (!playing || ended) return;
    const tt = songT(); let best = null, bd = 9;
    for (const n of notes) { if (n.j || n.lane !== lane) continue; const d = Math.abs(n.t - tt); if (d < bd) { bd = d; best = n; } }
    if (!best || bd > 0.28) return;
    best.j = true;
    if (bd <= 0.11) { perfect++; st.flash = 'Perfect'; st.grade = 2; tone(880, 880, .08, 'triangle', .06); }
    else if (bd <= 0.21) { good++; st.flash = 'Good'; st.grade = 1; tone(660, 660, .08, 'triangle', .06); }
    else { miss++; st.flash = 'Off beat'; st.grade = 0; tone(220, 200, .08, 'triangle', .05); }
    st.lastHit = tt; st.lane = lane; st.hits = perfect + good; st.flashT = tt;
  }
  c.addEventListener('pointerdown', e => { e.preventDefault(); const b = c.getBoundingClientRect(); hit(sk.lanes === 1 ? 0 : (e.clientX - b.left < W / 2 ? 0 : 1)); });
  const onKey = e => { const k = e.code; if (sk.lanes === 1 && (k === 'Space' || k === 'ArrowUp')) { e.preventDefault(); if (!e.repeat) hit(0); }
    if (sk.lanes === 2 && (k === 'ArrowLeft' || k === 'KeyA')) { e.preventDefault(); if (!e.repeat) hit(0); } if (sk.lanes === 2 && (k === 'ArrowRight' || k === 'KeyD')) { e.preventDefault(); if (!e.repeat) hit(1); } };
  addEventListener('keydown', onKey); addEventListener('resize', size);
  function start(){ playing = true; t0 = performance.now(); raf = requestAnimationFrame(tick); }
  function stop(){ ended = true; cancelAnimationFrame(raf); removeEventListener('keydown', onKey); removeEventListener('resize', size); }
  function tick(){
    const tt = songT();
    for (const n of notes) if (!n.j && tt - n.t > 0.28) { n.j = true; miss++; st.flash = 'Miss'; st.flashT = tt; st.grade = -1; }
    const acc = (perfect + good * 0.75) / notes.length;
    setHud(hud, `<span class="pill">Perfect ${perfect}</span><span class="pill">Good ${good}</span><span class="pill">Miss ${miss}</span><span class="track"><span class="fill" style="width:${Math.max(0, Math.min(100, tt / END * 100)).toFixed(1)}%"></span></span>`);
    draw(tt);
    if (tt > END) { ended = true; playing = false; const star = acc >= 0.8; onEnd({ star, ...sk.ok(Math.round(acc * 100), star) }); return; }
    raf = requestAnimationFrame(tick);
  }
  function draw(tt){
    if (!W) return;
    sk.scene(ctx, W, SH, tt, st);
    ctx.fillStyle = sk.road; ctx.fillRect(0, SH, W, H - SH);
    const shade = ctx.createLinearGradient(0, SH, 0, H); shade.addColorStop(0, 'rgba(0,0,0,.28)'); shade.addColorStop(0.5, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(255,255,255,.06)'); ctx.fillStyle = shade; ctx.fillRect(0, SH, W, H - SH);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(0, SH, W, 2);
    for (let l = 0; l < sk.lanes; l++) { const lane = ctx.createLinearGradient(0, SH, 0, H); lane.addColorStop(0, 'rgba(255,255,255,.02)'); lane.addColorStop(1, 'rgba(255,255,255,.13)'); ctx.fillStyle = lane; ctx.fillRect(laneX(l) - 34, SH, 68, H - SH); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(laneX(l) - 34, SH, 1.5, H - SH); ctx.fillRect(laneX(l) + 32.5, SH, 1.5, H - SH); }
    const hy = hitY();
    for (let l = 0; l < sk.lanes; l++) { const lit = tt - st.lastHit < 0.15 && st.lane === l;
      if (lit) glow(ctx, laneX(l), hy, 62, '255,215,106', 0.75);
      ctx.beginPath(); ctx.arc(laneX(l), hy, 28, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill(); ctx.lineWidth = lit ? 6 : 3; ctx.strokeStyle = lit ? '#ffd76a' : 'rgba(255,255,255,.75)'; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '600 12px Outfit, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(sk.laneNames[l], laneX(l), H - 18); }
    for (const n of notes) { if (n.j) continue; const y = hy - (n.t - tt) / TRAVEL * (hy - SH - 10); if (y < SH - 24 || y > H + 24) continue;
      groundShadow(ctx, laneX(n.lane) + 2, y + 22, 20, 5, 0.3); glow(ctx, laneX(n.lane), y, 36, '255,255,255', 0.25);
      const nb = ctx.createRadialGradient(laneX(n.lane) - 7, y - 8, 2, laneX(n.lane), y, 24); nb.addColorStop(0, 'rgba(255,255,255,.85)'); nb.addColorStop(0.35, sk.noteColors[n.lane]); nb.addColorStop(1, sk.noteColors[n.lane]);
      ctx.beginPath(); ctx.arc(laneX(n.lane), y, 22, 0, Math.PI * 2); ctx.fillStyle = sk.noteColors[n.lane]; ctx.fill(); ctx.fillStyle = nb; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '800 15px Outfit, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(sk.noteLabel[n.lane], laneX(n.lane), y + 5); }
    ctx.textAlign = 'center';
    if (tt < 0 && tt > -3) { ctx.fillStyle = '#fff'; ctx.font = '800 54px Outfit, sans-serif'; ctx.fillText(String(Math.ceil(-tt)), W / 2, SH + (H - SH) * 0.45); }
    if (tt - st.flashT < 0.45) { ctx.fillStyle = st.grade === 2 ? '#ffd76a' : st.grade === 1 ? '#bfe9c8' : '#ffb3a6'; ctx.font = '800 24px Outfit, sans-serif'; ctx.fillText(st.flash, W / 2, hy - 50); }
  }
  size();
  setHud(hud, `<span class="pill">Perfect 0</span><span class="pill">Good 0</span><span class="pill">Miss 0</span>`);
  return { start, stop, move(){} };
};

function person(ctx, x, y, s, body, head){ ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.strokeStyle = body; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(0, -16); ctx.lineTo(4, 0); ctx.moveTo(0, -16); ctx.lineTo(0, -34); ctx.stroke(); circ(ctx, 0, -40, 6, head || body); ctx.restore(); }
export const rhythmSkins = {
  moai: {
    label:'Walk the moai: tap left or right on the beat', lanes:2, pattern:'alt', n:22, interval:0.62, road:'#22333d', noteColors:['#c4512b','#2f7f9c'], noteLabel:['L','R'], laneNames:['Left rope','Right rope'],
    scene(ctx, W, SH, t, st){
      skyC(ctx, W, SH, ['#5a6fa8','#f0a07a','#ffd9a8']); ctx.fillStyle = '#3d6f95'; ctx.fillRect(0, SH * 0.55, W, SH * 0.12);
      const gy = SH * 0.88; ctx.fillStyle = '#6f8f4f'; ctx.fillRect(0, SH * 0.66, W, SH * 0.34);
      ctx.fillStyle = '#6b6157'; ctx.fillRect(W * 0.8, gy - 8, W * 0.18, 10);
      const p = st.hits / st.n, mx = W * 0.14 + p * W * 0.62, mh = SH * 0.5;
      const tilt = (st.lane === 0 ? -1 : 1) * 0.13 * Math.exp(-Math.max(0, t - st.lastHit) * 4) * (t > st.lastHit ? 1 : 0);
      const hx = mx + Math.sin(tilt) * mh, hy = gy - Math.cos(tilt) * mh;
      ctx.strokeStyle = '#d9c7a0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, hy + 10); ctx.lineTo(mx - 60, gy - 20); ctx.moveTo(hx, hy + 10); ctx.lineTo(mx + 60, gy - 20); ctx.moveTo(mx, gy - 6); ctx.lineTo(mx - 30, gy + 4); ctx.stroke();
      person(ctx, mx - 64, gy, 0.9, '#5a3d2c'); person(ctx, mx - 76, gy + 2, 0.85, '#5a3d2c'); person(ctx, mx + 64, gy, 0.9, '#5a3d2c'); person(ctx, mx + 76, gy + 2, 0.85, '#5a3d2c');
      ctx.save(); ctx.translate(mx, gy); ctx.rotate(tilt);
      const w = mh * 0.36; ctx.fillStyle = '#4a433d'; ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -mh * 0.55); ctx.quadraticCurveTo(-w / 2, -mh, -w * 0.25, -mh); ctx.lineTo(w * 0.25, -mh); ctx.quadraticCurveTo(w / 2, -mh, w / 2, -mh * 0.55); ctx.lineTo(w / 2, 0); ctx.fill();
      ctx.fillStyle = '#2e2a26'; ctx.fillRect(-w * 0.42, -mh * 0.76, w * 0.84, 4); ctx.beginPath(); ctx.moveTo(0, -mh * 0.74); ctx.lineTo(w * 0.14, -mh * 0.5); ctx.lineTo(-w * 0.14, -mh * 0.5); ctx.fill(); ctx.fillRect(-w * 0.2, -mh * 0.42, w * 0.4, 3);
      ctx.restore();
    },
    ok:(a, star) => ({ title:star ? 'The moai walks!' : 'It reached the ahu', text:`You kept ${a}% of the rhythm, and the statue rocked its way to its platform. ${star ? 'A perfectly steady walk.' : 'Keep 80% of the rhythm for a star.'}` })
  },
  slap: {
    label:'Slap dance: tap left or right on the beat', lanes:2, pattern:'slap', n:24, interval:0.7, road:'#3a2618', noteColors:['#0f8b8d','#e0503c'], noteLabel:['L','R'], laneNames:['Slap thighs','Slap chest'],
    scene(ctx, W, SH, t, st){
      skyC(ctx, W, SH, ['#6cc6ea','#e4f6f7']); ctx.fillStyle = '#38bfc4'; ctx.fillRect(0, SH * 0.5, W, SH * 0.2); ctx.fillStyle = '#f3e3c3'; ctx.fillRect(0, SH * 0.7, W, SH * 0.3);
      ctx.fillStyle = '#8b6b45'; ctx.beginPath(); ctx.moveTo(W * 0.62, SH * 0.5); ctx.quadraticCurveTo(W * 0.8, SH * 0.1, W * 0.98, SH * 0.5); ctx.fill();
      const k = Math.exp(-Math.max(0, t - st.lastHit) * 9) * (t > st.lastHit ? 1 : 0), cx = W * 0.4, gy = SH * 0.95, s = SH / 220;
      ctx.save(); ctx.translate(cx, gy); ctx.scale(s, s);
      ctx.strokeStyle = '#7a5038'; ctx.lineWidth = 12; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-18, -60); ctx.moveTo(14, 0); ctx.lineTo(18, -60); ctx.stroke();
      ctx.fillStyle = '#1f1f1f'; ctx.fillRect(-26, -78, 52, 24);
      ctx.fillStyle = '#1f6f8b'; ctx.beginPath(); ctx.moveTo(-28, -80); ctx.lineTo(28, -80); ctx.lineTo(32, -52); ctx.lineTo(-32, -52); ctx.fill();
      ctx.fillStyle = '#7a5038'; ctx.fillRect(-22, -140, 44, 62); circ(ctx, 0, -158, 18, '#7a5038'); ctx.fillStyle = '#2b1d14'; ctx.fillRect(-18, -176, 36, 10);
      const pose = st.lane === 0 ? [[-34, -66], [34, -66]] : [[-12, -120], [12, -120]], idle = [[-46, -170], [46, -170]];
      ctx.strokeStyle = '#7a5038'; ctx.lineWidth = 10;
      [[-22, -132], [22, -132]].forEach(([sx, sy], i) => { const ex = idle[i][0] + (pose[i][0] - idle[i][0]) * k, ey = idle[i][1] + (pose[i][1] - idle[i][1]) * k; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        if (k > 0.5) { ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 3; for (let a = 0; a < 5; a++) { const an = a * 1.26; ctx.beginPath(); ctx.moveTo(ex + Math.cos(an) * 10, ey + Math.sin(an) * 10); ctx.lineTo(ex + Math.cos(an) * 20, ey + Math.sin(an) * 20); ctx.stroke(); } ctx.strokeStyle = '#7a5038'; ctx.lineWidth = 10; } });
      ctx.restore();
    },
    ok:(a, star) => ({ title:star ? 'The village cheers!' : 'Dance complete', text:`You kept ${a}% of the beat as the drum sped up. ${star ? 'The crowd joins in the clapping.' : 'Keep 80% of the beat for a star.'}` })
  },
  jump: {
    label:'The adumu: tap on the beat to jump', lanes:1, pattern:'single', n:18, interval:0.8, road:'#2b1d14', noteColors:['#c8332b'], noteLabel:['↑'], laneNames:['Jump'],
    scene(ctx, W, SH, t, st){
      skyC(ctx, W, SH, ['#e9845a','#f7b25a','#fbe0a6']); circ(ctx, W * 0.72, SH * 0.58, SH * 0.2, '#ffd27a');
      ctx.fillStyle = '#d6a14d'; ctx.fillRect(0, SH * 0.72, W, SH * 0.28);
      const gy = SH * 0.94, s = SH / 230;
      [0.1, 0.22, 0.78, 0.9].forEach((fx, i) => person(ctx, W * fx, gy - 4, s * 1.3, '#c8332b', '#4a2c1c'));
      const u = (t - st.lastHit) / 0.6, amp = [0.3, 0.65, 1][Math.max(0, st.grade)] * SH * 0.34, jy = (u >= 0 && u <= 1) ? Math.sin(Math.PI * u) * amp : 0;
      ctx.save(); ctx.translate(W * 0.5, gy - jy); ctx.scale(s, s);
      ctx.strokeStyle = '#4a2c1c'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-5, -56); ctx.moveTo(6, 0); ctx.lineTo(5, -56); ctx.stroke();
      ctx.fillStyle = '#c8332b'; ctx.beginPath(); ctx.moveTo(-16, -130); ctx.lineTo(16, -130); ctx.lineTo(20, -50); ctx.lineTo(-20, -50); ctx.fill();
      ctx.fillStyle = '#2b4f9a'; ctx.fillRect(-16, -100, 32, 4);
      ctx.strokeStyle = '#4a2c1c'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-14, -124); ctx.lineTo(-18, -76); ctx.moveTo(14, -124); ctx.lineTo(18, -76); ctx.stroke();
      ctx.lineWidth = 6; ['#f4efe6','#c8332b','#2b4f9a','#e9b40c'].forEach((col, i) => { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(0, -136, 14 - i * 2.5, 0.2, Math.PI - 0.2); ctx.stroke(); });
      circ(ctx, 0, -150, 12, '#4a2c1c'); ctx.restore();
    },
    ok:(a, star) => ({ title:star ? 'Highest in the circle!' : 'The song ends', text:`You jumped on ${a}% of the beat. ${star ? 'The warriors cheer your height.' : 'Keep 80% of the beat for a star.'}` })
  }
};
