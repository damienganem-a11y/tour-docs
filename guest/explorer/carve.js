// Passport Explorer game: Carve (scratch away rock from the top down). Skin: treasury (Petra).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { canvasIn, mulberry32, setHud, sfx } from './common.js';

export const carve = function(host, hud, onEnd, sk){
  const c = canvasIn(host, sk.label), ctx = c.getContext('2d'), art = document.createElement('canvas'), rock = document.createElement('canvas');
  const actx = art.getContext('2d'), rctx = rock.getContext('2d'), BANDS = 5, TIME = sk.time, CELL = 12;
  let W = 0, H = 0, dpr = 1, raf = 0, t0 = 0, playing = false, ended = false, band = 0, grid = [], cols = 0, rows = 0, F = null, down = false, lastP = null, flash = -9, msgT = -9;
  function size(){
    dpr = Math.min(2, window.devicePixelRatio || 1); W = host.clientWidth; H = Math.round(Math.max(420, Math.min(540, W * 1.25)));
    [c, art, rock].forEach(cv => { cv.width = W * dpr; cv.height = H * dpr; }); c.style.height = H + 'px';
    [ctx, actx, rctx].forEach(x => x.setTransform(dpr, 0, 0, dpr, 0, 0));
    F = { x:W * 0.14, y:H * 0.05, w:W * 0.72, h:H * 0.9 };
    cols = Math.ceil(F.w / CELL); rows = Math.ceil(F.h / CELL); grid = new Array(cols * rows).fill(0);
    sk.drawArt(actx, W, H, F); sk.drawRock(rctx, W, H, mulberry32(7)); band = 0; draw();
  }
  const bandBottom = b => F.y + F.h * (b + 1) / BANDS;
  function scratch(x, y){
    const limit = bandBottom(band) + 6; if (y > limit + 14) { if (performance.now() - msgT > 1200) { msgT = performance.now(); } return; }
    const R = Math.max(18, W * 0.05);
    rctx.save(); rctx.globalCompositeOperation = 'destination-out'; rctx.beginPath(); rctx.rect(0, 0, W, limit); rctx.clip();
    rctx.beginPath(); if (lastP) { rctx.lineWidth = R * 2; rctx.lineCap = 'round'; rctx.moveTo(lastP.x, Math.min(lastP.y, limit)); rctx.lineTo(x, Math.min(y, limit)); rctx.stroke(); } rctx.arc(x, y, R, 0, Math.PI * 2); rctx.fill(); rctx.restore();
    const gx0 = Math.max(0, Math.floor((x - R - F.x) / CELL)), gx1 = Math.min(cols - 1, Math.floor((x + R - F.x) / CELL)), gy0 = Math.max(0, Math.floor((y - R - F.y) / CELL)), gy1 = Math.min(rows - 1, Math.floor((Math.min(y, limit) + R - F.y) / CELL));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) { const cx = F.x + (gx + .5) * CELL, cy = F.y + (gy + .5) * CELL; if (cy <= limit && Math.hypot(cx - x, cy - y) <= R) grid[gy * cols + gx] = 1; }
    if (lastP) { const steps = Math.ceil(Math.hypot(x - lastP.x, y - lastP.y) / (R * 0.6)); for (let s = 1; s < steps; s++) { const ix = lastP.x + (x - lastP.x) * s / steps, iy = lastP.y + (y - lastP.y) * s / steps;
        for (let gy = Math.max(0, Math.floor((iy - R - F.y) / CELL)); gy <= Math.min(rows - 1, Math.floor((iy + R - F.y) / CELL)); gy++) for (let gx = Math.max(0, Math.floor((ix - R - F.x) / CELL)); gx <= Math.min(cols - 1, Math.floor((ix + R - F.x) / CELL)); gx++) {
          const cx = F.x + (gx + .5) * CELL, cy = F.y + (gy + .5) * CELL; if (cy <= limit && Math.hypot(cx - ix, cy - iy) <= R) grid[gy * cols + gx] = 1; } } }
    lastP = { x, y };
    if (bandDone(band)) { band++; flash = performance.now(); sfx('right'); if (band >= BANDS) finish(true); }
  }
  function bandCover(b){ const y0 = Math.floor(rows * b / BANDS), y1 = Math.floor(rows * (b + 1) / BANDS); let n = 0, k = 0; for (let gy = y0; gy < y1; gy++) for (let gx = 0; gx < cols; gx++) { n++; k += grid[gy * cols + gx]; } return n ? k / n : 1; }
  const bandDone = b => bandCover(b) >= 0.86;
  const pos = e => { const b = c.getBoundingClientRect(); return { x:e.clientX - b.left, y:e.clientY - b.top }; };
  c.addEventListener('pointerdown', e => { if (!playing || ended) return; e.preventDefault(); down = true; lastP = null; const p = pos(e); scratch(p.x, p.y); });
  c.addEventListener('pointermove', e => { if (!down || !playing || ended) return; const p = pos(e); scratch(p.x, p.y); });
  ['pointerup','pointerleave','pointercancel'].forEach(ev => c.addEventListener(ev, () => { down = false; lastP = null; }));
  addEventListener('resize', size);
  function start(){ playing = true; t0 = performance.now(); raf = requestAnimationFrame(tick); }
  function stop(){ ended = true; cancelAnimationFrame(raf); removeEventListener('resize', size); }
  function finish(ok){ ended = true; playing = false; cancelAnimationFrame(raf); if (ok) { rctx.clearRect(0, 0, W, H); } draw();
    const s = Math.round((performance.now() - t0) / 1000), star = ok && s <= sk.starTime; onEnd(ok ? { star, ...sk.ok(s, star) } : { star:false, ...sk.fail(band) }); }
  function tick(){
    const left = TIME - (performance.now() - t0) / 1000; if (left <= 0) return finish(false);
    setHud(hud, `<span class="pill">Level ${Math.min(band + 1, BANDS)} / ${BANDS}</span><span class="pill">${Math.ceil(left)} s</span><span class="track"><span class="fill" style="width:${Math.min(100, (band + bandCover(Math.min(band, BANDS - 1))) / BANDS * 100).toFixed(1)}%"></span></span>`);
    draw(); if (!ended) raf = requestAnimationFrame(tick);
  }
  function draw(){
    if (!W) return;
    ctx.clearRect(0, 0, W, H); ctx.drawImage(art, 0, 0, W, H); ctx.drawImage(rock, 0, 0, W, H);
    if (playing && band < BANDS) {
      const y = bandBottom(band);
      ctx.fillStyle = 'rgba(40,15,12,.35)'; ctx.fillRect(0, y, W, H - y);
      ctx.setLineDash([8, 6]); ctx.strokeStyle = '#fff4dc'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '700 13px Outfit, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = '#fff4dc'; ctx.fillText('Carve above this line', W - 10, y - 8);
      if (performance.now() - msgT < 1200) { ctx.textAlign = 'center'; ctx.font = '800 18px Outfit, sans-serif'; ctx.fillText('Top down! Finish this level first', W / 2, y + 28); }
    }
    if (performance.now() - flash < 500) { ctx.fillStyle = `rgba(255,240,200,${0.5 * (1 - (performance.now() - flash) / 500)})`; ctx.fillRect(0, 0, W, H); }
  }
  size();
  setHud(hud, `<span class="pill">Level 1 / ${BANDS}</span><span class="pill">${TIME} s</span>`);
  return { start, stop, move(){} };
};
export const carveSkins = {
  treasury: {
    label:'Carve the Treasury: drag your finger to cut away the rock, from the top down', time:90, starTime:60,
    drawArt(ctx, W, H, F){
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#e9a27f'); g.addColorStop(1, '#d4876a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const x = F.x, y = F.y, w = F.w, h = F.h, L = '#f3bf9c', M = '#e6a582', D = '#b8664e', S = '#7a3830';
      ctx.fillStyle = '#d98e6a'; ctx.fillRect(x, y, w, h);
      // upper storey: tholos with urn, two broken half-pediments
      const uy = y + h * 0.04, uh = h * 0.4;
      ctx.fillStyle = M; ctx.fillRect(x + w * 0.04, uy + uh * 0.32, w * 0.92, uh * 0.68);
      ctx.fillStyle = L; for (let i = 0; i < 6; i++) { const cx = x + w * (0.08 + i * 0.168); if (i === 2 || i === 3) continue; ctx.fillRect(cx, uy + uh * 0.36, w * 0.05, uh * 0.6); }
      ctx.fillStyle = D; ctx.beginPath(); ctx.moveTo(x + w * 0.02, uy + uh * 0.34); ctx.lineTo(x + w * 0.28, uy + uh * 0.18); ctx.lineTo(x + w * 0.28, uy + uh * 0.34); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + w * 0.98, uy + uh * 0.34); ctx.lineTo(x + w * 0.72, uy + uh * 0.18); ctx.lineTo(x + w * 0.72, uy + uh * 0.34); ctx.fill();
      ctx.fillStyle = L; ctx.fillRect(x + w * 0.36, uy + uh * 0.24, w * 0.28, uh * 0.76);
      ctx.fillStyle = M; for (let i = 0; i < 3; i++) ctx.fillRect(x + w * (0.39 + i * 0.09), uy + uh * 0.3, w * 0.04, uh * 0.66);
      ctx.fillStyle = D; ctx.beginPath(); ctx.moveTo(x + w * 0.34, uy + uh * 0.26); ctx.quadraticCurveTo(x + w * 0.5, uy + uh * 0.06, x + w * 0.66, uy + uh * 0.26); ctx.fill();
      ctx.fillStyle = L; ctx.beginPath(); ctx.ellipse(x + w * 0.5, uy + uh * 0.02, w * 0.04, uh * 0.06, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x + w * 0.49, uy + uh * 0.06, w * 0.02, uh * 0.06);
      ctx.fillStyle = S; ctx.fillRect(x + w * 0.46, uy + uh * 0.62, w * 0.08, uh * 0.3);
      // entablature
      const ey = y + h * 0.45; ctx.fillStyle = D; ctx.fillRect(x, ey, w, h * 0.035); ctx.fillStyle = L; ctx.fillRect(x, ey + h * 0.035, w, h * 0.04);
      ctx.fillStyle = D; for (let i = 0; i < 10; i++) ctx.fillRect(x + w * (0.03 + i * 0.1), ey + h * 0.045, w * 0.03, h * 0.02);
      // lower storey: pediment over six columns, dark doorway
      const ly = ey + h * 0.075, lh = h * 0.47;
      ctx.fillStyle = D; ctx.beginPath(); ctx.moveTo(x + w * 0.2, ly + lh * 0.1); ctx.lineTo(x + w * 0.5, ly - lh * 0.06); ctx.lineTo(x + w * 0.8, ly + lh * 0.1); ctx.fill();
      ctx.fillStyle = L; ctx.beginPath(); ctx.moveTo(x + w * 0.26, ly + lh * 0.085); ctx.lineTo(x + w * 0.5, ly - lh * 0.02); ctx.lineTo(x + w * 0.74, ly + lh * 0.085); ctx.fill();
      ctx.fillStyle = M; ctx.fillRect(x + w * 0.02, ly + lh * 0.1, w * 0.96, lh * 0.9);
      ctx.fillStyle = L; for (let i = 0; i < 6; i++) { const cx = x + w * (0.05 + i * 0.17); ctx.fillRect(cx, ly + lh * 0.14, w * 0.06, lh * 0.82); ctx.fillStyle = D; ctx.fillRect(cx - w * 0.01, ly + lh * 0.11, w * 0.08, lh * 0.04); ctx.fillStyle = L; }
      ctx.fillStyle = S; ctx.fillRect(x + w * 0.44, ly + lh * 0.42, w * 0.12, lh * 0.58);
      ctx.fillStyle = D; ctx.fillRect(x, y + h - h * 0.02, w, h * 0.02);
    },
    drawRock(ctx, W, H, rnd){
      ctx.fillStyle = '#9a4a3c'; ctx.fillRect(0, 0, W, H);
      const cols = ['#a8524a','#8e3f36','#b9664f','#7d3830','#c47a5c'];
      for (let y = 0; y < H; y += 12 + rnd() * 18) { ctx.fillStyle = cols[Math.floor(rnd() * 5)]; ctx.beginPath(); ctx.moveTo(0, y); for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y + Math.sin(x * 0.02 + y) * 6 + rnd() * 3); ctx.lineTo(W, y + 22); ctx.lineTo(0, y + 22); ctx.fill(); }
      for (let i = 0; i < 160; i++) { ctx.fillStyle = rnd() < .5 ? 'rgba(60,20,15,.25)' : 'rgba(240,190,150,.18)'; ctx.beginPath(); ctx.ellipse(rnd() * W, rnd() * H, 2 + rnd() * 10, 1 + rnd() * 4, rnd() * 3, 0, Math.PI * 2); ctx.fill(); }
    },
    ok:(s, star) => ({ title:'Al-Khazneh revealed', text:`You carved the Treasury from top to bottom in ${s} seconds. ${star ? 'A master mason’s pace!' : 'Finish within 60 seconds for a star.'}` }),
    fail:b => ({ title:'The master mason takes over', text:`You carved ${b} of 5 levels before time ran out. The real facade took the Nabataeans years.` })
  }
};
