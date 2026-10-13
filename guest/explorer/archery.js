// Passport Explorer game: Archery (shoot when the swaying sight is on the target, with wind). Skin: dha (Bhutan).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { canvasIn, circ, setHud, sfx, skyC, tone } from './common.js';

export const archery = function(host, hud, onEnd, sk){
  const c = canvasIn(host, sk.label), ctx = c.getContext('2d');
  const ARROWS = 6;
  let W = 0, H = 0, raf = 0, last = 0, playing = false, ended = false, clock = 0;
  let shot = 0, score = 0, wind = 0, phase = 'aim', fly = null, marks = [], banner = '', bannerT = -9, danceT = -9, timeoutId = 0;
  const board = () => ({ x:W * 0.5, top:H * 0.18, w:Math.max(72, W * 0.22), h:H * 0.5 }), bull = () => { const b = board(); return { x:b.x, y:b.top + b.h * 0.3 }; };
  function size(){ const dpr = Math.min(3, window.devicePixelRatio || 1); W = host.clientWidth; H = Math.round(Math.max(400, Math.min(520, W * 1.15)));
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  function newWind(){ wind = Math.round((Math.random() * 2 - 1) * 10) / 10; }
  function sight(){ const b = bull(), k = 1 + shot * 0.08; return { x:b.x + Math.sin(clock * 1.25 * k) * W * 0.22 + Math.sin(clock * 3.1) * W * 0.02, y:b.y + Math.sin(clock * 1.9 * k + 1) * H * 0.16 }; }
  function shoot(){
    if (!playing || ended || phase !== 'aim') return;
    const s = sight(), land = { x:s.x + wind * W * 0.1, y:s.y + 6 };
    phase = 'fly'; fly = { from:{ x:W * 0.5, y:H + 20 }, to:land, t:0 }; tone(300, 900, .18, 'triangle', .05);
  }
  function resolve(){
    const p = fly.to, b = board(), u = bull(), r = Math.hypot(p.x - u.x, p.y - u.y), onBoard = Math.abs(p.x - b.x) <= b.w / 2 && p.y >= b.top && p.y <= b.top + b.h;
    let pts = 0;
    if (r <= b.w * 0.17) pts = 3; else if (r <= b.w * 0.36) pts = 2; else if (onBoard) pts = 1;
    score += pts; marks.push({ x:p.x, y:p.y, hit:pts > 0 });
    banner = pts === 3 ? 'Bullseye!' : pts === 2 ? 'Good hit' : pts === 1 ? 'On the board' : 'Missed the target'; bannerT = clock;
    if (pts > 0) { danceT = clock; sfx(pts === 3 ? 'right' : 'coin'); } else sfx('wrong');
    shot++; phase = 'wait';
    timeoutId = setTimeout(() => { if (shot >= ARROWS) finish(); else { newWind(); phase = 'aim'; } }, 1300);
  }
  function finish(){ ended = true; playing = false; cancelAnimationFrame(raf); draw(); const star = score >= sk.starAt; onEnd({ star, ...sk.ok(score, ARROWS * 3, star) }); }
  c.addEventListener('pointerdown', e => { e.preventDefault(); shoot(); });
  const kd = e => { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) shoot(); } };
  addEventListener('keydown', kd); addEventListener('resize', size);
  function start(){ playing = true; newWind(); last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop(){ ended = true; cancelAnimationFrame(raf); clearTimeout(timeoutId); removeEventListener('keydown', kd); removeEventListener('resize', size); }
  function tick(now){
    const dt = Math.min(0.033, (now - last) / 1000); last = now; clock += dt;
    if (phase === 'fly') { fly.t += dt / 0.55; if (fly.t >= 1) { fly.t = 1; resolve(); } }
    const wtxt = wind === 0 ? 'No wind' : `Wind ${wind < 0 ? '←' : '→'} ${Math.abs(wind) >= 0.6 ? 'strong' : Math.abs(wind) >= 0.3 ? 'medium' : 'light'}`;
    setHud(hud, `<span class="pill">Arrow ${Math.min(shot + 1, ARROWS)} / ${ARROWS}</span><span class="pill">Score ${score}</span><span class="pill gold">${wtxt}</span>`);
    draw(); if (!ended) raf = requestAnimationFrame(tick);
  }
  function dancer(x, y, s, ph){
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const a = Math.sin(ph * 8) * 0.6;
    ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-6 - a * 4, -18); ctx.moveTo(4, 0); ctx.lineTo(6 + a * 4, -18); ctx.stroke();
    ctx.fillStyle = '#7d1d2a'; ctx.beginPath(); ctx.moveTo(-10, -16); ctx.lineTo(10, -16); ctx.lineTo(8, -46); ctx.lineTo(-8, -46); ctx.fill();
    ctx.fillStyle = '#f4efe6'; ctx.fillRect(-9, -46, 18, 4);
    ctx.strokeStyle = '#7d1d2a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-7, -42); ctx.lineTo(-18, -56 - a * 8); ctx.moveTo(7, -42); ctx.lineTo(18, -56 + a * 8); ctx.stroke();
    circ(ctx, 0, -54, 7, '#c99670'); ctx.restore();
  }
  function draw(){
    if (!W) return;
    skyC(ctx, W, H, ['#8fb8e0','#cfe0ee','#eef4f7']);
    ctx.fillStyle = '#dfe8f0'; ctx.beginPath(); ctx.moveTo(0, H * 0.3); ctx.lineTo(W * 0.2, H * 0.14); ctx.lineTo(W * 0.38, H * 0.26); ctx.lineTo(W * 0.62, H * 0.1); ctx.lineTo(W * 0.85, H * 0.24); ctx.lineTo(W, H * 0.16); ctx.lineTo(W, H * 0.4); ctx.lineTo(0, H * 0.4); ctx.fill();
    ctx.fillStyle = '#6f8e74'; ctx.beginPath(); ctx.moveTo(0, H * 0.4); ctx.quadraticCurveTo(W * 0.5, H * 0.3, W, H * 0.42); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.fillStyle = '#8fb06f'; ctx.fillRect(0, H * 0.62, W, H * 0.38);
    // prayer flag on a pole: it streams with the wind
    const fxp = W * 0.12, fyp = H * 0.28; ctx.strokeStyle = '#6b5a4a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(fxp, H * 0.66); ctx.lineTo(fxp, fyp); ctx.stroke();
    const cols = ['#2f6db5','#f4efe6','#c8332b','#2e8b57','#e9b40c'], dir = wind >= 0 ? 1 : -1, len = 14 + Math.abs(wind) * 40;
    cols.forEach((col, i) => { const y0 = fyp + i * 9, flap = Math.sin(clock * (3 + Math.abs(wind) * 8) + i) * (2 + Math.abs(wind) * 3);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(fxp, y0); ctx.lineTo(fxp + dir * len, y0 + 2 + flap); ctx.lineTo(fxp + dir * len, y0 + 9 + flap); ctx.lineTo(fxp, y0 + 8); ctx.fill(); });
    // target board: tall and narrow, painted with rings
    const b = board(), u = bull();
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(b.x - b.w / 2 + 5, b.top + 5, b.w, b.h);
    ctx.fillStyle = '#e8dcc0'; ctx.fillRect(b.x - b.w / 2, b.top, b.w, b.h);
    ctx.fillStyle = '#2f6db5'; ctx.fillRect(b.x - b.w / 2, b.top + b.h * 0.62, b.w, b.h * 0.1);
    ctx.fillStyle = '#c8332b'; ctx.fillRect(b.x - b.w / 2, b.top + b.h * 0.76, b.w, b.h * 0.08);
    circ(ctx, u.x, u.y, b.w * 0.36, '#2e8b57'); circ(ctx, u.x, u.y, b.w * 0.27, '#f4efe6'); circ(ctx, u.x, u.y, b.w * 0.17, '#e9b40c'); circ(ctx, u.x, u.y, b.w * 0.07, '#c8332b');
    ctx.strokeStyle = '#8a7a5a'; ctx.lineWidth = 2; ctx.strokeRect(b.x - b.w / 2, b.top, b.w, b.h);
    marks.forEach(m => { ctx.strokeStyle = '#3b2a1a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + 10, m.y + 14); ctx.stroke(); ctx.fillStyle = '#f4efe6'; ctx.beginPath(); ctx.moveTo(m.x + 8, m.y + 11); ctx.lineTo(m.x + 15, m.y + 14); ctx.lineTo(m.x + 11, m.y + 19); ctx.fill(); circ(ctx, m.x, m.y, 2.5, '#3b2a1a'); });
    if (clock - danceT < 1.3) { dancer(W * 0.78, H * 0.78, 1.1, clock); dancer(W * 0.9, H * 0.8, 1, clock + 0.4); dancer(W * 0.22, H * 0.82, 1, clock + 0.2); }
    if (phase === 'fly' && fly) { const t = fly.t, x = fly.from.x + (fly.to.x - fly.from.x) * t, y = fly.from.y + (fly.to.y - fly.from.y) * t - Math.sin(Math.PI * t) * H * 0.18, sc = 1.6 - t;
      ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); ctx.strokeStyle = '#3b2a1a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 26); ctx.stroke(); ctx.fillStyle = '#f4efe6'; ctx.beginPath(); ctx.moveTo(-5, 20); ctx.lineTo(0, 28); ctx.lineTo(5, 20); ctx.fill(); ctx.restore(); }
    if (phase === 'aim' && playing) { const s = sight(); ctx.strokeStyle = 'rgba(23,23,26,.85)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(s.x, s.y, 16, 0, Math.PI * 2); ctx.moveTo(s.x - 24, s.y); ctx.lineTo(s.x - 8, s.y); ctx.moveTo(s.x + 8, s.y); ctx.lineTo(s.x + 24, s.y); ctx.moveTo(s.x, s.y - 24); ctx.lineTo(s.x, s.y - 8); ctx.moveTo(s.x, s.y + 8); ctx.lineTo(s.x, s.y + 24); ctx.stroke(); circ(ctx, s.x, s.y, 2.5, '#c8332b');
      ctx.fillStyle = '#17171a'; ctx.font = '600 14px Outfit, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Tap to shoot', W / 2, H - 16); }
    if (clock - bannerT < 1.2) { ctx.font = '800 24px Outfit, sans-serif'; ctx.textAlign = 'center'; const tw = ctx.measureText(banner).width + 32;
      ctx.fillStyle = 'rgba(23,23,26,.8)'; ctx.beginPath(); ctx.roundRect(W / 2 - tw / 2, 14, tw, 40, 20); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(banner, W / 2, 42); }
  }
  size();
  setHud(hud, `<span class="pill">Arrow 1 / ${ARROWS}</span><span class="pill">Score 0</span>`);
  return { start, stop, move(){} };
};
export const archerySkins = {
  dha: {
    label:'Archery: tap to shoot when the sight is on the target, allowing for the wind', starAt:11,
    ok:(p, m, star) => ({ title:star ? 'Your team is singing!' : 'Six arrows shot', text:`You scored ${p} out of ${m}. ${star ? 'Your teammates dance in front of the target.' : 'Score 11 or more for a star. Tip: aim upwind of the bullseye.'}` })
  }
};
