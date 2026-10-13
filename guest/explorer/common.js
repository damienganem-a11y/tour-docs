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
