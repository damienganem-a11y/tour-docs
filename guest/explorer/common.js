// Passport Explorer, shared pieces of the mini-games. PORTED from the owner's prototype (tools/reference/jet-set-explorer-prototype.html): the drawing helpers
// and the small utilities are the prototype's own; the sound is the prototype's synth blips, but only plays when the guest turned sound on.

let soundIsOn = () => false;
export function setSoundCheck(fn) { soundIsOn = fn; }

let actx = null;
export function tone(f1, f2, dur, type, vol) {
  if (!soundIsOn()) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* no sound: the game plays on */ }
}
export function sfx(type) {
  const m = { jump:[440,660,.12,'square',.07], coin:[880,1320,.1,'triangle',.07], hit:[200,90,.22,'sawtooth',.07], right:[660,990,.2,'triangle',.07],
              wrong:[240,150,.24,'triangle',.07], stamp:[140,60,.28,'square',.07], step:[300,320,.04,'triangle',.03], pour:[520,500,.06,'sine',.03], snap:[1800,900,.06,'square',.05] }[type];
  if (m) tone(...m);
}

export function ridgeC(ctx, W, H, off, base, amp, freq, color){
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W + 8; x += 8) { const t = (x + off) * freq; ctx.lineTo(x, base - amp * (0.55 * Math.sin(t) + 0.3 * Math.sin(t * 2.3 + 1.7) + 0.15 * Math.sin(t * 5.1 + 0.4))); }
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
}
export function peakC(ctx, x, base, w, h, color){ ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x - w / 2, base); ctx.bezierCurveTo(x - w * 0.3, base - h * 0.6, x - w * 0.15, base - h, x + w * 0.05, base - h); ctx.bezierCurveTo(x + w * 0.25, base - h * 0.9, x + w * 0.3, base - h * 0.4, x + w / 2, base); ctx.fill(); }
export function skyC(ctx, W, H, stops){ const g = ctx.createLinearGradient(0, 0, 0, H); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
export function ell(ctx, x, y, rx, ry, color, rot){ ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); ctx.fill(); }
export function circ(ctx, x, y, r, color){ ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
export function setHud(hud, html){ if (hud._s !== html) { hud.innerHTML = html; hud._s = html; } }
export function canvasIn(host, label){ const c = document.createElement('canvas'); c.setAttribute('aria-label', label); host.prepend(c); return c; }
export function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---- Richer drawing helpers (v0.99.8): texture, light and depth for the games' scenes. All deterministic (no flicker) and cheap to draw. ----

// A small tile of fine speckle (light and dark dots) that can be laid over any area to give it a printed, tactile grain. Built once, reused every frame.
export function makeGrain(size = 128, seed = 1, alpha = 0.07) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), r = mulberry32(seed);
  for (let i = 0; i < size * size * 0.16; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    g.fillRect(r() * size, r() * size, r() < 0.2 ? 2 : 1, r() < 0.2 ? 2 : 1);
  }
  return c;
}
export function grainFill(ctx, grain, x, y, w, h, shiftX = 0, shiftY = 0) {
  grain._p ??= ctx.createPattern(grain, 'repeat');
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(-shiftX % 128, -shiftY % 128); ctx.fillStyle = grain._p; ctx.fillRect(x + shiftX % 128, y + shiftY % 128, w + 128, h + 128); ctx.restore();
}
// A soft round light (the sun, a lantern, a glow behind a figure).
export function glow(ctx, x, y, r, rgb = '255,236,190', a = 0.9) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
// The soft shadow under a character or an object standing on the ground.
export function groundShadow(ctx, x, y, rx, ry = rx * 0.22, a = 0.28) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx); g.addColorStop(0, `rgba(20,14,8,${a})`); g.addColorStop(1, 'rgba(20,14,8,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
// The corners of the picture darken a little, which draws the eye to the middle.
export function vignette(ctx, W, H, a = 0.22) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(20,10,5,${a})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
// A soft cloud (a few overlapping round puffs), in white or a tint.
export function cloud(ctx, x, y, s = 1, a = 0.7, rgb = '255,255,255') {
  ctx.fillStyle = `rgba(${rgb},${a})`;
  [[0, 0, 22], [22, -6, 18], [-22, 3, 16], [40, 4, 14], [-38, 8, 11]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); ctx.fill(); });
}
// A polygon filled with a vertical gradient and a thin lighter edge on its top (a lit surface).
export function litShape(ctx, pts, top, bottom, edge = 'rgba(255,255,255,.35)') {
  const ys = pts.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1.2; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
}
