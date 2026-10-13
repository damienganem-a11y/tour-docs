// Passport Explorer game: Pour (hold to pour, release at the line). Skin: tea (Marrakech).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { canvasIn, circ, ell, plural, setHud, sfx, skyC } from './common.js';

export const pour = function(host, hud, onEnd, sk){
  const c = canvasIn(host, sk.label), ctx = c.getContext('2d');
  let W = 0, H = 0, raf = 0, last = 0, playing = false, ended = false, pourTick = 0;
  let g = 0, level = 0, target = 0.5, foam = 0, lift = 0, pouring = false, phase = 'ready', liftSum = 0, liftT = 0, label = '', points = 0, perfects = 0, timeoutId = 0;
  const maxPts = sk.foam ? 12 : 9;
  function size(){ const dpr = Math.min(3, window.devicePixelRatio || 1); W = host.clientWidth; H = Math.round(Math.max(340, Math.min(430, W * 0.95)));
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  function newCup(){ level = 0; foam = 0; lift = 0; liftSum = 0; liftT = 0; target = sk.target[0] + Math.random() * (sk.target[1] - sk.target[0]); phase = 'ready'; label = ''; paintHud(); }
  function paintHud(){ setHud(hud, `<span class="pill">${sk.cup} ${Math.min(g + 1, 3)} / 3</span><span class="pill gold">${sk.labels[Math.min(g, 2)]}</span><span class="pill">Points ${points}</span>`); }
  function press(e){ if (e && e.preventDefault) e.preventDefault(); if (!playing || ended) return; if (phase === 'ready') { phase = 'pour'; pouring = true; } }
  function release(){ if (phase === 'pour' && pouring) { pouring = false; score(); } }
  function score(){
    const err = Math.abs(level - target); let pts;
    if (level > 1) { label = 'Spilled!'; pts = 0; }
    else if (err <= 0.03) { label = 'Perfect'; pts = 3; perfects++; }
    else if (err <= 0.07) { label = 'Lovely'; pts = 2; }
    else { label = level < target ? 'A little short' : 'A little full'; pts = 1; }
    if (sk.foam && pts > 0 && liftT > 0 && liftSum / liftT > 0.5) { pts++; label += ' + foam'; }
    points += pts; phase = 'scored'; sfx(pts >= 3 ? 'right' : pts === 0 ? 'wrong' : 'coin'); paintHud();
    timeoutId = setTimeout(() => { g++; if (g >= 3) finish(); else newCup(); }, 1400);
  }
  function finish(){ ended = true; playing = false; cancelAnimationFrame(raf); const star = points >= sk.starAt; onEnd({ star, ...sk.ok(points, maxPts, perfects, star) }); }
  c.addEventListener('pointerdown', press);
  ['pointerup','pointerleave','pointercancel'].forEach(ev => c.addEventListener(ev, release));
  const kd = e => { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) press(); } }, ku = e => { if (e.code === 'Space') release(); };
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('resize', size);
  function start(){ playing = true; newCup(); last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop(){ ended = true; cancelAnimationFrame(raf); clearTimeout(timeoutId); removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', size); }
  function tick(now){
    const dt = Math.min(0.033, (now - last) / 1000); last = now;
    if (pouring) {
      level += sk.rates[g] * dt * (1 + lift * 0.2); lift = Math.min(1, lift + dt * 0.9); foam = Math.min(1, foam + lift * dt * 0.9);
      liftSum += lift * dt; liftT += dt; pourTick -= dt; if (pourTick <= 0) { sfx('pour'); pourTick = 0.12; }
      if (level >= 1.06) { pouring = false; score(); }
    } else lift = Math.max(0, lift - dt * 1.6);
    draw(); if (!ended) raf = requestAnimationFrame(tick);
  }
  function draw(){
    if (!W) return;
    sk.bg(ctx, W, H);
    const baseY = H - 40, gx = W * 0.4, liq = sk.liquid[Math.min(g, 2)];
    sk.tray(ctx, gx, baseY, W);
    const v = sk.vessel === 'glass' ? { gh:Math.min(150, H * 0.4), t:.62, b:.46 } : { gh:Math.min(80, H * 0.22), t:1.35, b:.82 };
    const gh = v.gh, tw = gh * v.t, bw = gh * v.b, top = baseY - gh;
    const xAt = (y, side) => gx + side * (bw / 2 + (tw - bw) / 2 * ((baseY - y) / gh));
    ctx.save(); ctx.beginPath(); ctx.moveTo(xAt(baseY, -1), baseY); ctx.lineTo(xAt(top, -1), top); ctx.lineTo(xAt(top, 1), top); ctx.lineTo(xAt(baseY, 1), baseY); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fill(); ctx.clip();
    const lv = Math.min(level, 1), ly = baseY - lv * gh;
    ctx.fillStyle = liq; ctx.fillRect(gx - tw, ly, tw * 2, baseY - ly);
    if (sk.foam && lv > 0.02) { ctx.fillStyle = '#fbf0d2'; ctx.fillRect(gx - tw, ly - 7 * foam, tw * 2, 7 * foam + 1); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(110,100,90,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xAt(baseY, -1), baseY); ctx.lineTo(xAt(top, -1), top); ctx.moveTo(xAt(top, 1), top); ctx.lineTo(xAt(baseY, 1), baseY); ctx.lineTo(xAt(baseY, -1), baseY); ctx.stroke();
    ctx.strokeStyle = sk.trim; ctx.lineWidth = 2; ctx.beginPath(); const py1 = top + gh * 0.16;
    for (let k = 0; k <= 8; k++) { const x = xAt(py1, -1) + (xAt(py1, 1) - xAt(py1, -1)) * k / 8, y = py1 + (k % 2 ? 5 : 0); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    const ty = baseY - target * gh; ctx.setLineDash([5, 4]); ctx.strokeStyle = '#8f6600'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xAt(ty, -1) - 10, ty); ctx.lineTo(xAt(ty, 1) + 10, ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#8f6600'; ctx.font = '600 12px Outfit, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('line', xAt(ty, 1) + 14, ty + 4);
    if (level > 1) ell(ctx, gx + 30, baseY + 4, 40, 6, liq);
    const potX = gx + 58, potY = top - 40 - lift * Math.min(H * 0.28, 120), rot = pouring ? -0.5 : -0.08;
    const tipX = potX + (-62) * Math.cos(rot) - (-6) * Math.sin(rot), tipY = potY + (-62) * Math.sin(rot) + (-6) * Math.cos(rot);
    if (pouring) { ctx.strokeStyle = liq; ctx.lineWidth = Math.max(1.5, 4 - lift * 2.2); ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.quadraticCurveTo(tipX - 4, (tipY + ly) / 2, gx - 2, Math.max(ly - 7 * foam, top)); ctx.stroke(); }
    ctx.save(); ctx.translate(potX, potY); ctx.rotate(rot); sk.pot(ctx); ctx.restore();
    ctx.textAlign = 'center'; ctx.fillStyle = sk.ink;
    if (phase === 'ready' && playing) { ctx.font = '700 20px Outfit, sans-serif'; ctx.fillText('Press and hold to pour', W / 2, H * 0.24); }
    if (phase === 'scored') { ctx.font = '800 30px Outfit, sans-serif'; ctx.fillText(label, W / 2, H * 0.26); }
  }
  size(); paintHud();
  return { start, stop, move(){} };
};

function teapot(ctx){
  const silver = ctx.createLinearGradient(-26, -22, 26, 22); silver.addColorStop(0, '#f3f1ec'); silver.addColorStop(1, '#a8a296');
  ctx.strokeStyle = '#8c867b'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-20, 6); ctx.quadraticCurveTo(-46, 8, -62, -6); ctx.stroke();
  ctx.strokeStyle = '#c9c4ba'; ctx.lineWidth = 3.5; ctx.stroke();
  ctx.strokeStyle = '#8c867b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(26, -2, 14, -1.2, 1.2); ctx.stroke();
  ctx.fillStyle = silver; ctx.beginPath(); ctx.ellipse(0, 0, 26, 22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b8b2a6'; ctx.fillRect(-16, 18, 32, 7);
  ctx.fillStyle = silver; ctx.beginPath(); ctx.moveTo(-14, -18); ctx.lineTo(14, -18); ctx.lineTo(8, -34); ctx.lineTo(-8, -34); ctx.fill();
  circ(ctx, 0, -38, 4, '#d4a017'); ctx.strokeStyle = '#d4a017'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, 2, 18, 6, 0, 0, Math.PI * 2); ctx.stroke();
}
function dallah(ctx){
  const brass = ctx.createLinearGradient(-24, -50, 24, 24); brass.addColorStop(0, '#f6dd8e'); brass.addColorStop(1, '#a87f2e');
  ctx.strokeStyle = '#8a6a26'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-8, -24); ctx.quadraticCurveTo(-34, -40, -50, -24); ctx.quadraticCurveTo(-58, -16, -62, -6); ctx.stroke();
  ctx.strokeStyle = '#e2c26c'; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = '#8a6a26'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(8, -36); ctx.bezierCurveTo(32, -36, 32, 4, 16, 10); ctx.stroke();
  ctx.fillStyle = brass; ctx.beginPath(); ctx.moveTo(-18, 22); ctx.quadraticCurveTo(-28, 4, -14, -8); ctx.lineTo(-8, -16); ctx.lineTo(-8, -34); ctx.quadraticCurveTo(-8, -40, -12, -44); ctx.lineTo(12, -44); ctx.quadraticCurveTo(8, -40, 8, -34); ctx.lineTo(8, -16); ctx.lineTo(14, -8); ctx.quadraticCurveTo(28, 4, 18, 22); ctx.closePath(); ctx.fill();
  ell(ctx, 0, 23, 17, 4, '#a87f2e');
  ctx.fillStyle = brass; ctx.beginPath(); ctx.moveTo(-12, -44); ctx.quadraticCurveTo(0, -62, 12, -44); ctx.fill();
  ctx.strokeStyle = '#a87f2e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -54); ctx.lineTo(0, -64); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -68, 4, 0.3, Math.PI - 0.3, true); ctx.stroke();
}
export const pourSkins = {
  tea: {
    label:'Tea ceremony: hold to pour, release at the gold line', cup:'Glass', vessel:'glass', foam:true, starAt:9, ink:'#17171a', trim:'#d4a017',
    labels:['Gentle as life','Strong as love','Bitter as death'], liquid:['#e0ad4c','#b8752b','#7a4318'], rates:[0.30, 0.40, 0.52], target:[0.62, 0.84], pot:teapot,
    bg(ctx, W, H){ skyC(ctx, W, H, ['#fbefe0','#f1d9bd']); const by = H * 0.12, ts = 18;
      for (let x = -ts; x < W + ts; x += ts) { ctx.fillStyle = Math.round(x / ts) % 2 ? '#2f7f86' : '#e9a800'; ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + ts / 2, by - ts / 2); ctx.lineTo(x + ts, by); ctx.lineTo(x + ts / 2, by + ts / 2); ctx.fill(); }
      ctx.fillStyle = '#c8704b'; ctx.fillRect(0, by + ts / 2 + 4, W, 3); },
    tray(ctx, gx, by, W){ ell(ctx, gx + 40, by + 6, Math.min(W * 0.42, 190), 16, '#d9b45a'); ell(ctx, gx + 40, by + 4, Math.min(W * 0.38, 170), 11, '#c49a3d'); },
    ok:(p, m, n, star) => ({ title:star ? 'A master of tea' : 'Tea is served', text:`${p} points out of ${m} across the three glasses${n ? `, with ${plural(n, 'perfect pour')}` : ''}. ${star ? 'Your host raises a glass to you.' : 'Score 9 or more for a star: pour long and high for the foam bonus.'}` })
  }
};
