// Passport Explorer game: Flap (tap to swim up through gaps). Skin: fish (Great Barrier Reef).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { canvasIn, circ, plural, setHud, sfx, skyC } from './common.js';

export const flap = function(host, hud, onEnd, sk){
  const c = canvasIn(host, sk.label), ctx = c.getContext('2d');
  const GOAL = 15, SPACING = 240, SPEED = 135, PW = 54;
  let W = 0, H = 0, raf = 0, last = 0, playing = false, ended = false, started = false, clock = 0;
  let fy = 0, vy = 0, hurt = 0, lives = 3, passed = 0, gates = [], spawnX = 0, bubbles = [];
  const fx = () => W * 0.28, floor = () => H - 34;
  function size(){ const dpr = Math.min(2, window.devicePixelRatio || 1); W = host.clientWidth; H = Math.round(Math.max(380, Math.min(500, W * 1.1)));
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); if (!started) fy = H * 0.45; draw(); }
  function gapH(){ return Math.max(140, H * (0.42 - Math.min(passed, GOAL) / GOAL * 0.08)); }
  function addGate(x){ const g = gapH(), m = 50; gates.push({ x, top:m + Math.random() * (floor() - g - m * 2), g, done:false, k:Math.random() }); }
  function swim(){ if (!playing || ended) return; if (!started) { started = true; } vy = -285; sfx('jump'); for (let i = 0; i < 2; i++) bubbles.push({ x:fx() - 14, y:fy, r:2 + Math.random() * 3, t:0 }); }
  c.addEventListener('pointerdown', e => { e.preventDefault(); swim(); });
  const onKey = e => { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); swim(); } };
  addEventListener('keydown', onKey); addEventListener('resize', size);
  function start(){ playing = true; fy = H * 0.45; gates = []; for (let i = 0; i < 3; i++) addGate(W + 60 + i * SPACING); spawnX = W + 60 + 3 * SPACING; last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop(){ ended = true; cancelAnimationFrame(raf); removeEventListener('keydown', onKey); removeEventListener('resize', size); }
  function end(ok){ ended = true; playing = false; cancelAnimationFrame(raf); draw(); const hits = 3 - lives, star = ok && hits <= 1;
    onEnd(ok ? { star, ...sk.ok(hits, star) } : { star:false, ...sk.fail(passed) }); }
  function tick(now){
    const dt = Math.min(0.033, (now - last) / 1000); last = now; clock += dt;
    if (!started) { fy = H * 0.45 + Math.sin(clock * 3) * 8; }
    else {
      vy = Math.min(420, vy + 820 * dt); fy += vy * dt;
      if (fy < 18) { fy = 18; vy = Math.max(vy, 0); }
      if (fy > floor() - 14) { fy = floor() - 14; vy = Math.min(vy, 0); }
      const dx = SPEED * dt; gates.forEach(g => g.x -= dx); spawnX -= dx;
      if (gates.length && gates[0].x < -PW - 10) gates.shift();
      if (passed + gates.filter(g => !g.done).length < GOAL && spawnX < W + 60) { addGate(spawnX + SPACING); spawnX += SPACING; }
      if (hurt > 0) hurt -= dt;
      for (const g of gates) {
        const inX = fx() + 13 > g.x + 6 && fx() - 13 < g.x + PW - 6;
        if (inX && hurt <= 0 && (fy - 9 < g.top || fy + 9 > g.top + g.g)) { lives--; hurt = 1.3; sfx('hit'); if (lives <= 0) return end(false); }
        if (!g.done && g.x + PW < fx() - 13) { g.done = true; passed++; sfx('coin'); if (passed >= GOAL) return end(true); }
      }
    }
    bubbles.forEach(b => { b.t += dt; b.y -= 40 * dt; b.x -= 30 * dt; }); bubbles = bubbles.filter(b => b.t < 1.4);
    setHud(hud, `<span class="pill">${'♥'.repeat(lives)}<span style="opacity:.25">${'♥'.repeat(3 - lives)}</span></span><span class="pill">Gaps ${passed} / ${GOAL}</span><span class="track"><span class="fill" style="width:${(passed / GOAL * 100).toFixed(1)}%"></span></span>`);
    draw(); if (!ended) raf = requestAnimationFrame(tick);
  }
  function coral(x, top, bottom, k){
    // a branching coral pillar growing up from the sea floor
    const col = k < .33 ? '#f4876f' : k < .66 ? '#b06ab3' : '#e8a24a';
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x + 10, top + 10, PW - 20, bottom - top, 10); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + PW / 2, top + 30); ctx.lineTo(x + 6, top + 6); ctx.moveTo(x + PW / 2, top + 24); ctx.lineTo(x + PW - 6, top + 2); ctx.moveTo(x + PW / 2, top + 14); ctx.lineTo(x + PW / 2, top); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.18)'; for (let y = top + 40; y < bottom; y += 18) circ(ctx, x + PW / 2 - 6, y, 3, 'rgba(255,255,255,.18)');
  }
  function kelp(x, bottom, k){
    // kelp hanging from a ledge, with a jellyfish at the tip
    ctx.fillStyle = '#2f5d4f'; ctx.fillRect(x - 6, -4, PW + 12, 14);
    ctx.strokeStyle = '#3f8a5a'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) { const xx = x + 10 + i * 17, sway = Math.sin(clock * 2 + i + k * 6) * 4; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.quadraticCurveTo(xx + sway, bottom * 0.5, xx - sway, bottom - 22); ctx.stroke(); }
    const jx = x + PW / 2, jy = bottom - 14;
    ctx.fillStyle = 'rgba(247,200,230,.9)'; ctx.beginPath(); ctx.arc(jx, jy, 15, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(247,200,230,.8)'; ctx.lineWidth = 2; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(jx + i * 5, jy); ctx.quadraticCurveTo(jx + i * 5 + Math.sin(clock * 4 + i) * 3, jy + 8, jx + i * 5, jy + 16); ctx.stroke(); }
  }
  function fish(x, y, tilt){
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt); if (hurt > 0 && Math.floor(hurt * 10) % 2 === 0) ctx.globalAlpha = 0.4;
    const wag = Math.sin(clock * 14) * 3;
    ctx.fillStyle = '#f26b1d'; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-24, -9 + wag); ctx.lineTo(-24, 9 + wag); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, 16, 10, 0, 0, Math.PI * 2); ctx.fillStyle = '#f26b1d'; ctx.fill(); ctx.clip();
    ctx.fillStyle = '#fff'; ctx.fillRect(5, -11, 5, 22); ctx.fillRect(-7, -11, 5, 22); ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.2; ctx.strokeRect(5, -11, 5, 22); ctx.strokeRect(-7, -11, 5, 22); ctx.restore();
    ctx.fillStyle = '#f26b1d'; ctx.beginPath(); ctx.moveTo(-4, -9); ctx.quadraticCurveTo(2, -16, 8, -9); ctx.fill();
    circ(ctx, 11, -2, 2.6, '#fff'); circ(ctx, 11.5, -2, 1.4, '#111');
    ctx.restore();
  }
  function anemone(x){
    const y = floor();
    ctx.fillStyle = '#c2577a'; ctx.beginPath(); ctx.ellipse(x, y + 4, 44, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f2a6c4'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    for (let i = -6; i <= 6; i++) { const s = Math.sin(clock * 2.5 + i) * 6; ctx.beginPath(); ctx.moveTo(x + i * 6, y); ctx.quadraticCurveTo(x + i * 7 + s, y - 30, x + i * 8 - s, y - 52 + Math.abs(i) * 3); ctx.stroke(); }
  }
  function draw(){
    if (!W) return;
    skyC(ctx, W, H, ['#6fd6e4','#1aa3c2','#0b5a78']);
    ctx.fillStyle = 'rgba(255,255,255,.07)'; [0.2, 0.55, 0.85].forEach((p, i) => { const x = W * p + Math.sin(clock * 0.4 + i) * 18; ctx.beginPath(); ctx.moveTo(x - 18, 0); ctx.lineTo(x + 18, 0); ctx.lineTo(x - 40, H); ctx.lineTo(x - 80, H); ctx.fill(); });
    ctx.fillStyle = '#e9d6a8'; ctx.fillRect(0, floor(), W, H - floor());
    ctx.fillStyle = '#d8c290'; const off = (clock * SPEED * (started ? 1 : 0)) % 40; for (let x = -off; x < W; x += 40) ctx.fillRect(x, floor() + 10, 18, 3);
    gates.forEach(g => { kelp(g.x, g.top, g.k); coral(g.x, g.top + g.g, floor() + 4, g.k); });
    const lastG = gates[gates.length - 1];
    if (passed >= GOAL - 1 && lastG) anemone(lastG.x + SPACING * 0.7);
    bubbles.forEach(b => { ctx.strokeStyle = `rgba(220,250,255,${1 - b.t / 1.4})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke(); });
    fish(fx(), fy, Math.max(-0.5, Math.min(0.6, vy / 600)));
    if (playing && !started) { ctx.fillStyle = '#ffffff'; ctx.font = '700 20px Outfit, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Tap to swim', W / 2, H * 0.2); }
  }
  size();
  setHud(hud, `<span class="pill">♥♥♥</span><span class="pill">Gaps 0 / ${GOAL}</span><span class="track"><span class="fill" style="width:0%"></span></span>`);
  return { start, stop, move(){} };
};
export const flapSkins = {
  fish: {
    label:'Clownfish: tap or press Space to swim up between the coral and the jellyfish',
    ok:(hits, star) => ({ title:'Home sweet anemone', text:`Your clownfish made it home through all 15 gaps${hits ? ` with ${plural(hits, 'bump')}` : ' without a single bump'}. ${star ? 'Smooth swimming!' : 'Make it with at most one bump for a star.'}` }),
    fail:n => ({ title:'Time for a rest', text:`Your clownfish got through ${plural(n, 'gap')} before needing a rest in the coral. Short, gentle taps work best.` })
  }
};
