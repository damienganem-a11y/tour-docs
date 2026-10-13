// Passport Explorer game: Catch (drag to catch falling items, dodge the others). Skins: egg (Easter Island), blossom (Washington, new).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { canvasIn, circ, ell, plural, setHud, sfx, skyC } from './common.js';

export const catchGame = function(host, hud, onEnd, sk){
  const c = canvasIn(host, sk.label), ctx = c.getContext('2d');
  const GOAL = 12;
  let W = 0, H = 0, raf = 0, last = 0, playing = false, ended = false, clock = 0;
  let px = 0, target = 0, keys = 0, lives = 3, caught = 0, birds = [], falls = [], fx = [], hurt = 0, nextBird = 0.4;
  const groundY = () => H - 56;
  function size(){ const dpr = Math.min(3, window.devicePixelRatio || 1); W = host.clientWidth; H = Math.round(Math.max(400, Math.min(520, W * 1.15)));
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); if (!px) { px = target = W / 2; } draw(); }
  const setTarget = e => { const b = c.getBoundingClientRect(); target = Math.max(30, Math.min(W - 30, e.clientX - b.left)); };
  c.addEventListener('pointerdown', e => { e.preventDefault(); setTarget(e); });
  c.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'mouse') setTarget(e); });
  const kd = e => { if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); keys = -1; } if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); keys = 1; } };
  const ku = e => { if (['ArrowLeft','KeyA','ArrowRight','KeyD'].includes(e.code)) keys = 0; };
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('resize', size);
  function start(){ playing = true; last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop(){ ended = true; cancelAnimationFrame(raf); removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', size); }
  function end(ok){ ended = true; playing = false; cancelAnimationFrame(raf); draw(); const lost = 3 - lives, star = ok && lost <= 1;
    onEnd(ok ? { star, ...sk.ok(caught, lost, star) } : { star:false, ...sk.fail(caught) }); }
  function tick(now){
    const dt = Math.min(0.033, (now - last) / 1000); last = now; clock += dt;
    if (keys) target = Math.max(30, Math.min(W - 30, target + keys * 380 * dt));
    px += (target - px) * Math.min(1, dt * 14);
    if (hurt > 0) hurt -= dt;
    const level = Math.min(1, caught / GOAL);
    nextBird -= dt;
    if (nextBird <= 0) { const dir = Math.random() < .5 ? 1 : -1; birds.push({ x:dir > 0 ? -30 : W + 30, y:40 + Math.random() * H * 0.22, dir, sp:90 + Math.random() * 60, drop:0.3 + Math.random() * 1.2, ph:Math.random() * 6 }); nextBird = 1.5 - level * 0.6 + Math.random() * 0.6; }
    birds.forEach(b => { b.x += b.dir * b.sp * dt; b.ph += dt * 10; b.drop -= dt;
      if (b.drop <= 0 && b.x > 30 && b.x < W - 30) { falls.push({ x:b.x, y:b.y + 8, vy:40, rock:false }); b.drop = 99; } });
    birds = birds.filter(b => b.x > -60 && b.x < W + 60);
    if (Math.random() < dt * (0.35 + level * 0.5)) falls.push({ x:30 + Math.random() * (W - 60), y:-14, vy:60, rock:true, rot:Math.random() * 6 });
    const gy = groundY();
    for (const f of falls) {
      f.vy = Math.min(f.rock ? 300 : 230 + level * 60, f.vy + (f.rock ? 380 : 260) * dt); f.y += f.vy * dt; if (f.rock) f.rot += dt * 4;
      if (!f.gone && f.y > gy - 52 && f.y < gy - 24 && Math.abs(f.x - px) < 30) {
        f.gone = true;
        if (f.rock) { if (hurt <= 0) { lives--; hurt = 1; sfx('hit'); fx.push({ x:f.x, y:gy - 40, t:0, txt:sk.hitText ?? 'Ouch!' }); if (lives <= 0) return end(false); } }
        else { caught++; sfx('coin'); fx.push({ x:f.x, y:gy - 50, t:0, txt:'+1' }); if (caught >= GOAL) return end(true); }
      }
      if (!f.gone && f.y > gy - 4) { f.gone = true; if (!f.rock) { lives--; sfx('wrong'); fx.push({ x:f.x, y:gy - 10, t:0, txt:sk.missText ?? 'Cracked!', crack:true }); if (lives <= 0) return end(false); } }
    }
    falls = falls.filter(f => !f.gone);
    fx.forEach(f => f.t += dt); fx = fx.filter(f => f.t < 0.9);
    setHud(hud, `<span class="pill">${'♥'.repeat(lives)}<span style="opacity:.25">${'♥'.repeat(3 - lives)}</span></span><span class="pill">${sk.noun ?? 'Eggs'} ${caught} / ${GOAL}</span><span class="track"><span class="fill" style="width:${(caught / GOAL * 100).toFixed(1)}%"></span></span>`);
    draw(); if (!ended) raf = requestAnimationFrame(tick);
  }
  function tern(b){
    ctx.save(); ctx.translate(b.x, b.y); ctx.scale(b.dir, 1);
    const w = Math.sin(b.ph) * 9;
    ctx.fillStyle = '#1c1c22'; ctx.beginPath(); ctx.moveTo(-2, 0); ctx.quadraticCurveTo(-12, -10 - w, -26, -6 - w); ctx.quadraticCurveTo(-12, -4, -2, 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.quadraticCurveTo(8, -10 - w, 20, -8 - w); ctx.quadraticCurveTo(10, -3, 2, 2); ctx.fill();
    ell(ctx, 0, 1, 12, 4.5, '#f4f4f4'); ctx.fillStyle = '#1c1c22'; ctx.beginPath(); ctx.ellipse(1, -1, 11, 2.5, 0, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-20, -4); ctx.lineTo(-14, 1); ctx.lineTo(-20, 5); ctx.fill();
    ctx.fillStyle = '#1c1c22'; ctx.beginPath(); ctx.moveTo(11, -1); ctx.lineTo(17, 0); ctx.lineTo(11, 2); ctx.fill();
    ctx.restore();
  }
  function egg(x, y){ ell(ctx, x, y, 7, 9.5, '#efe6d2'); [[-2, -3], [3, 1], [-1, 4], [2, -5]].forEach(([dx, dy]) => circ(ctx, x + dx, y + dy, 1.2, '#8a6a4a')); }
  function stone(f){ ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.fillStyle = '#5b544c'; ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(-2, -10); ctx.lineTo(9, -6); ctx.lineTo(10, 5); ctx.lineTo(-3, 9); ctx.lineTo(-10, 4); ctx.fill(); ctx.fillStyle = '#7a7268'; ctx.fillRect(-4, -6, 6, 3); ctx.restore(); }
  function swimmer(x, y){
    ctx.save(); ctx.translate(x, y); if (hurt > 0 && Math.floor(hurt * 10) % 2 === 0) ctx.globalAlpha = .4;
    ctx.strokeStyle = '#6b4a3a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-7, 22); ctx.moveTo(5, 0); ctx.lineTo(7, 22); ctx.stroke();
    ctx.fillStyle = '#6b4a3a'; ctx.fillRect(-8, -26, 16, 28); circ(ctx, 0, -33, 8, '#6b4a3a');
    ctx.fillStyle = '#e8ddc4'; ctx.fillRect(-8, -6, 16, 6);
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-7, -22); ctx.lineTo(-22, -34); ctx.moveTo(7, -22); ctx.lineTo(22, -34); ctx.stroke();
    // reed basket held overhead
    ctx.fillStyle = '#c9a463'; ctx.beginPath(); ctx.moveTo(-28, -40); ctx.lineTo(28, -40); ctx.lineTo(20, -28); ctx.lineTo(-20, -28); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#a07e40'; ctx.lineWidth = 1.5; for (let i = -20; i <= 20; i += 8) { ctx.beginPath(); ctx.moveTo(i * 1.3, -40); ctx.lineTo(i, -28); ctx.stroke(); }
    ctx.restore();
  }
  function draw(){
    if (!W) return;
    const gy = groundY();
    if (sk.art) sk.art.bg(ctx, W, H, gy, clock); else {
    skyC(ctx, W, H, ['#7fa8d6','#f2b48c','#ffe0b2']);
    ctx.fillStyle = '#4b4540'; ctx.beginPath(); ctx.moveTo(W, H * 0.25); ctx.lineTo(W * 0.78, H * 0.3); ctx.lineTo(W * 0.7, H * 0.55); ctx.lineTo(W, H * 0.6); ctx.fill();
    ctx.fillStyle = '#6f8f4f'; ctx.beginPath(); ctx.moveTo(W, H * 0.24); ctx.lineTo(W * 0.78, H * 0.29); ctx.lineTo(W * 0.8, H * 0.31); ctx.lineTo(W, H * 0.27); ctx.fill();
    ctx.fillStyle = '#3d6f95'; ctx.fillRect(0, H * 0.58, W, gy - H * 0.58 + 10);
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 2; for (let r = 0; r < 4; r++) { ctx.beginPath(); for (let x = 0; x <= W; x += 10) { const yy = H * 0.62 + r * 18 + Math.sin(x * 0.05 + clock * (1 + r * 0.3)) * 2.5; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); }
    ctx.fillStyle = '#5b544c'; ctx.beginPath(); ctx.moveTo(0, gy + 6); ctx.quadraticCurveTo(W * 0.5, gy - 16, W, gy + 6); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.fillStyle = '#7d9a5a'; ctx.beginPath(); ctx.moveTo(0, gy + 8); ctx.quadraticCurveTo(W * 0.5, gy - 12, W, gy + 8); ctx.lineTo(W, gy + 16); ctx.quadraticCurveTo(W * 0.5, gy - 2, 0, gy + 16); ctx.fill();
    }
    // A skin may bring its own drawings (art.flier, art.bad, art.good, art.catcher); without one, the Easter Island terns, eggs, stones and swimmer are drawn.
    birds.forEach(sk.art ? (b) => sk.art.flier(ctx, b) : tern);
    falls.forEach(f => (f.rock ? (sk.art ? sk.art.bad(ctx, f) : stone(f)) : (sk.art ? sk.art.good(ctx, f.x, f.y) : egg(f.x, f.y))));
    if (sk.art) sk.art.catcher(ctx, px, gy - 8, hurt > 0 && Math.floor(hurt * 10) % 2 === 0); else swimmer(px, gy - 8);
    fx.forEach(f => { ctx.globalAlpha = 1 - f.t / 0.9; ctx.fillStyle = f.crack ? '#d1513b' : '#ffffff'; ctx.font = '800 18px Outfit, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(f.txt, f.x, f.y - f.t * 30); ctx.globalAlpha = 1; });
  }
  size();
  setHud(hud, `<span class="pill">♥♥♥</span><span class="pill">${sk.noun ?? 'Eggs'} 0 / ${GOAL}</span><span class="track"><span class="fill" style="width:0%"></span></span>`);
  return { start, stop, move(){} };
};
export const catchSkins = {
  egg: {
    label:'Catch the tern eggs: drag left and right, or use the arrow keys',
    ok:(n, lost, star) => ({ title:'Tangata manu!', text:`You caught ${n} eggs. Your chief is the Birdman for the year! ${star ? 'Barely a slip all day.' : 'Lose at most one heart for a star.'}` }),
    fail:n => ({ title:'Another chief wins', text:`You caught ${plural(n, 'egg')} before three slips. Champions sometimes waited on Motu Nui for weeks: try again!` })
  },
  // New in this app (Washington, the wrap-up): drawn in the same style as the eggs.
  blossom: {
    label:'Catch the cherry blossoms: drag left and right, or use the arrow keys', noun:'Blossoms', missText:'Missed!', hitText:'Splash!',
    art: {
      bg(ctx, W, H, gy, clock){
        skyC(ctx, W, H, ['#8fb0dc','#f6c3b8','#fde8d2']);
        ctx.fillStyle = '#f6f2ea'; ctx.beginPath(); ctx.moveTo(W * 0.12, H * 0.5); ctx.quadraticCurveTo(W * 0.12, H * 0.34, W * 0.28, H * 0.34); ctx.quadraticCurveTo(W * 0.44, H * 0.34, W * 0.44, H * 0.5); ctx.fill();
        ctx.fillRect(W * 0.14, H * 0.5, W * 0.28, H * 0.05); ctx.fillStyle = '#e8e1d4'; for (let i = 0; i < 6; i++) ctx.fillRect(W * 0.16 + i * W * 0.045, H * 0.5, 4, H * 0.05);
        ctx.fillStyle = '#4d7aa8'; ctx.fillRect(0, H * 0.6, W, gy - H * 0.6 + 10);
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; for (let r = 0; r < 3; r++) { ctx.beginPath(); for (let x = 0; x <= W; x += 10) { const yy = H * 0.64 + r * 16 + Math.sin(x * 0.05 + clock * (1 + r * 0.3)) * 2; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); }
        ctx.fillStyle = '#7ea36b'; ctx.beginPath(); ctx.moveTo(0, gy + 6); ctx.quadraticCurveTo(W * 0.5, gy - 14, W, gy + 6); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
        ctx.fillStyle = '#5b3a2e'; ctx.fillRect(W * 0.04, H * 0.3, 7, gy - H * 0.3); ctx.fillRect(W * 0.9, H * 0.34, 7, gy - H * 0.34);
        [[W * 0.04 + 3, H * 0.3], [W * 0.9 + 3, H * 0.34]].forEach(([x, y]) => { for (let i = 0; i < 9; i++) circ(ctx, x + Math.cos(i * 2.1) * 34, y + Math.sin(i * 1.7) * 22, 15, i % 2 ? '#f6c4d4' : '#f9dce6'); });
      },
      flier(ctx, b){ ctx.save(); ctx.translate(b.x, b.y); ctx.scale(b.dir, 1); ctx.strokeStyle = '#5b3a2e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-26, 4); ctx.quadraticCurveTo(0, -4 + Math.sin(b.ph) * 3, 26, 2); ctx.stroke();
        [-18, -6, 6, 18].forEach((x, i) => circ(ctx, x, -2 + (i % 2) * 5 + Math.sin(b.ph + i) * 2, 6, i % 2 ? '#f6c4d4' : '#f9dce6')); ctx.restore(); },
      good(ctx, x, y){ for (let i = 0; i < 5; i++) { const a = i * 1.2566; ell(ctx, x + Math.cos(a) * 5, y + Math.sin(a) * 5, 5, 3.4, '#f7c9d8', a); } circ(ctx, x, y, 2.2, '#d9467a'); },
      bad(ctx, f){ ctx.save(); ctx.translate(f.x, f.y); ctx.fillStyle = '#6aa3d6'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.quadraticCurveTo(8, 2, 0, 8); ctx.quadraticCurveTo(-8, 2, 0, -10); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(-2, -2, 2, 5); ctx.restore(); },
      catcher(ctx, x, y, flash){ ctx.save(); ctx.translate(x, y); if (flash) ctx.globalAlpha = .4; ctx.strokeStyle = '#2f3a52'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-7, 22); ctx.moveTo(5, 0); ctx.lineTo(7, 22); ctx.stroke(); ctx.fillStyle = '#b3202a'; ctx.fillRect(-8, -26, 16, 28); circ(ctx, 0, -33, 8, '#e0b08c');
        ctx.fillStyle = '#14264d'; ctx.fillRect(-10, -43, 20, 5); ctx.lineWidth = 5; ctx.strokeStyle = '#b3202a'; ctx.beginPath(); ctx.moveTo(-7, -22); ctx.lineTo(-20, -34); ctx.moveTo(7, -22); ctx.lineTo(20, -34); ctx.stroke();
        ctx.fillStyle = '#e9d9b8'; ctx.beginPath(); ctx.moveTo(-30, -40); ctx.lineTo(30, -40); ctx.lineTo(22, -28); ctx.lineTo(-22, -28); ctx.closePath(); ctx.fill(); ctx.restore(); }
    },
    ok:(n, lost, star) => ({ title:'Hanami!', text:`You caught ${n} blossoms at the Tidal Basin. Washington blooms like this for about two weeks each spring. ${star ? 'Hardly a drop got you!' : 'Lose at most one heart for a star.'}` }),
    fail:n => ({ title:'Rain on the Basin', text:`You caught ${plural(n, 'blossom')} before the raindrops won. Spring in Washington is fickle: the trees will bloom again.` })
  }
};
