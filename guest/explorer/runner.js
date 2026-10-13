// Passport Explorer game: Runner (jump over obstacles to reach a goal). PORTED unchanged in logic and tuning from the owner's prototype; only the
// imports and the exports are new. Only the llama skin (Peru) is kept: the owner chose three DIFFERENT games for Easter Island and Bhutan instead of three runners, so the prototype's other two runner skins (swim, hike) are not brought over.
import { ridgeC, peakC, skyC, ell, circ, plural, setHud, canvasIn, sfx } from './common.js';

export const runner = function(host, hud, onEnd, sk){
  const c = canvasIn(host, sk.label), ctx = c.getContext('2d');
  let W = 0, H = 0;
  const GOAL = 9000, L = { y:0, vy:0, ground:true, hurt:0 };
  let obs = [], items = [], dist = 0, speed = 220, lives = 3, got = 0, spawn = 1.6, ispawn = 2.4, raf = 0, last = 0, playing = false, ended = false;
  const lx = () => Math.max(64, W * 0.17), gy = () => H - 46;
  function size(){ const dpr = Math.min(2, window.devicePixelRatio || 1); W = host.clientWidth; H = Math.round(Math.max(300, Math.min(380, W * 0.75)));
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  function jump(){ if (!playing || ended) return; if (L.ground) { L.vy = -590; L.ground = false; sfx('jump'); } }
  const onKey = e => { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); jump(); } };
  c.addEventListener('pointerdown', e => { if (playing) { e.preventDefault(); jump(); } });
  addEventListener('keydown', onKey); addEventListener('resize', size);
  function start(){ playing = true; last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop(){ ended = true; cancelAnimationFrame(raf); removeEventListener('keydown', onKey); removeEventListener('resize', size); }
  function end(ok){ ended = true; playing = false; cancelAnimationFrame(raf); const clean = lives === 3;
    onEnd(ok ? { star:clean, ...sk.ok(got, clean) } : { star:false, ...sk.fail(got) }); }
  function tick(now){ const dt = Math.min(0.033, (now - last) / 1000); last = now; update(dt); if (!ended) { draw(); raf = requestAnimationFrame(tick); } }
  function update(dt){
    dist += speed * dt; speed = Math.min(420, speed + 5 * dt);
    L.vy += 1600 * dt; L.y += L.vy * dt; if (L.y >= 0) { L.y = 0; L.vy = 0; L.ground = true; }
    if (L.hurt > 0) L.hurt -= dt;
    // Items sit where you naturally pass: right above a rock (one jump clears the rock AND grabs it),
    // or low on the path between rocks (just keep running).
    if (dist < GOAL - W) {
      spawn -= dt; if (spawn <= 0) {
        const o = { x:W + 20, w:20 + Math.random() * 16, h:16 + Math.random() * 16, k:Math.random() }; obs.push(o);
        if (Math.random() < 0.5) items.push({ x:o.x + o.w / 2 - 9, y:84 + Math.random() * 16, got:false, k:Math.random() });
        spawn = 1.0 + Math.random() * 1.1 - Math.min(0.3, dist / GOAL * 0.3);
      }
      ispawn -= dt; if (ispawn <= 0) {
        const lastO = obs[obs.length - 1];
        if (!lastO || lastO.x < W - 140) { items.push({ x:W + 20, y:40, got:false, k:Math.random() }); ispawn = 1.8 + Math.random() * 1.6; }
        else ispawn = 0.25;
      }
    }
    obs.forEach(o => o.x -= speed * dt); items.forEach(it => it.x -= speed * dt);
    obs = obs.filter(o => o.x > -60); items = items.filter(it => it.x > -40 && !it.got);
    const x0 = lx() - 24, x1 = lx() + 30, yb = gy() + L.y, yt = yb - 72;
    for (const o of obs) if (L.hurt <= 0 && o.x < x1 - 8 && o.x + o.w > x0 + 8 && yb > gy() - o.h + 4) { lives--; L.hurt = 1.1; sfx('hit'); if (lives <= 0) { end(false); return; } }
    for (const it of items) { const iy = gy() - it.y; if (!it.got && it.x < x1 && it.x + 18 > x0 && iy + 18 > yt && iy < yb) { it.got = true; got++; sfx('coin'); } }
    if (dist >= GOAL) { end(true); return; }
    setHud(hud, `<span class="pill">${'♥'.repeat(lives)}<span style="opacity:.25">${'♥'.repeat(3 - lives)}</span></span><span class="pill">${sk.hudItem} ${got}</span><span class="track" title="Distance to the goal"><span class="fill" style="width:${(dist / GOAL * 100).toFixed(1)}%"></span></span>`);
  }
  function draw(){
    if (!W) return;
    sk.bg(ctx, W, H, dist, gy());
    if (dist > GOAL - W * 1.4) sk.goal(ctx, lx() + (GOAL - dist) + 40, gy(), H);
    obs.forEach(o => sk.obstacle(ctx, o, gy()));
    items.forEach(it => sk.item(ctx, it.x, gy() - it.y, it.k));
    sk.player(ctx, lx(), gy() + L.y, dist * 0.06, L.ground, L.hurt > 0 && Math.floor(L.hurt * 10) % 2 === 0);
  }
  size();
  setHud(hud, `<span class="pill">♥♥♥</span><span class="pill">${sk.hudItem} 0</span><span class="track"><span class="fill" style="width:0%"></span></span>`);
  return { start, stop, move(){} };
};

function rock(ctx, o, g, c1, c2){ ctx.fillStyle = c1; ctx.beginPath(); ctx.moveTo(o.x, g); ctx.lineTo(o.x + o.w * 0.2, g - o.h); ctx.lineTo(o.x + o.w * 0.75, g - o.h * 0.85); ctx.lineTo(o.x + o.w, g); ctx.fill(); ctx.fillStyle = c2; ctx.fillRect(o.x + o.w * 0.25, g - o.h * 0.8, o.w * 0.25, 3); }

export const runnerSkins = {
  llama: {
    label:'Inca Trail: tap or press Space to jump', hudItem:'Textiles',
    bg(ctx, W, H, dist, g){
      skyC(ctx, W, H, ['#8ea7cf','#eeb8a2','#fbe3c4']);
      circ(ctx, W * 0.8, H * 0.28, 22, 'rgba(255,244,220,.9)');
      ridgeC(ctx, W, H, dist * 0.06, H * 0.5, 50, 0.006, '#a6b1c9');
      const pk = ((W * 0.7 - dist * 0.12) % (W + 300) + W + 300) % (W + 300) - 150; peakC(ctx, pk, H * 0.72, 120, 120, '#5d8463');
      ridgeC(ctx, W, H, dist * 0.2, H * 0.68, 30, 0.009, '#93a891');
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(0, H * 0.62, W, 10);
      ridgeC(ctx, W, H, dist * 0.55, g - 6, 14, 0.02, '#6f9a62');
      ctx.fillStyle = '#6f9a62'; ctx.fillRect(0, g, W, H - g);
      ctx.fillStyle = '#8ab478'; for (let r = 1; r < 4; r++) ctx.fillRect(0, g + r * 11, W, 2);
      ctx.fillStyle = '#c9bfae'; ctx.fillRect(0, g, W, 6);
      ctx.fillStyle = '#a99d89'; const off = dist % 34; for (let x = -off; x < W; x += 34) ctx.fillRect(x, g, 2, 6);
    },
    player(ctx, x, y, phase, ground, flash){
      ctx.save(); ctx.translate(x, y); if (flash) ctx.globalAlpha = 0.4;
      [[-18, 0], [-9, Math.PI], [10, Math.PI / 2], [19, Math.PI * 1.5]].forEach(([dx, p]) => { const s = ground ? Math.sin(phase + p) * 5 : 3; ctx.fillStyle = '#d6c19c'; ctx.fillRect(dx + s * 0.6 - 3, -24, 6, 24); });
      ell(ctx, 0, -34, 28, 14, '#fbf3e4'); circ(ctx, -28, -40, 6, '#fbf3e4'); ctx.fillRect(14, -72, 12, 36); ell(ctx, 25, -73, 12, 7.5, '#fbf3e4');
      ell(ctx, 35, -71, 5, 4, '#ead9bb');
      ctx.fillStyle = '#fbf3e4'; ctx.beginPath(); ctx.moveTo(17, -78); ctx.lineTo(19, -90); ctx.lineTo(23, -79); ctx.moveTo(22, -79); ctx.lineTo(25, -91); ctx.lineTo(28, -79); ctx.fill();
      circ(ctx, 27, -75, 1.8, '#1b2433');
      ctx.fillStyle = '#c0392b'; ctx.fillRect(-15, -47, 24, 14); ctx.fillStyle = '#e9a800'; ctx.fillRect(-15, -43, 24, 2.5); ctx.fillStyle = '#1f7a76'; ctx.fillRect(-15, -38.5, 24, 2.5);
      circ(ctx, 19, -84, 3, '#e94f8a');
      ctx.restore();
    },
    obstacle(ctx, o, g){ rock(ctx, o, g, '#8f8a80', '#b3aea4'); },
    item(ctx, x, y){ ctx.save(); ctx.translate(x + 9, y + 9); ctx.rotate(Math.PI / 4); ctx.fillStyle = '#c0392b'; ctx.fillRect(-9, -9, 18, 18); ctx.fillStyle = '#e9a800'; ctx.fillRect(-9, -3, 18, 2.5); ctx.fillRect(-9, 3, 18, 2.5); ctx.fillStyle = '#1f7a76'; ctx.fillRect(-2, -9, 3, 18); ctx.restore(); },
    goal(ctx, x, g){ ctx.fillStyle = '#b8ae9c'; ctx.fillRect(x - 40, g - 120, 80, 120); ctx.fillStyle = '#9d937f'; for (let r = 0; r < 6; r++) ctx.fillRect(x - 40, g - 120 + r * 20, 80, 1.5);
      ctx.fillStyle = '#ffd99a'; ctx.beginPath(); ctx.moveTo(x - 14, g); ctx.lineTo(x - 10, g - 74); ctx.lineTo(x + 10, g - 74); ctx.lineTo(x + 14, g); ctx.fill(); },
    ok:(n, clean) => ({ title:'Sun Gate reached!', text:`You reached Inti Punku with ${plural(n, 'woven textile')}. Machu Picchu lies below you in the morning light. ${clean ? 'Not a single stumble!' : 'Reach it without a stumble for a star.'}` }),
    fail:() => ({ title:'The llama sat down', text:'After three stumbles your llama lay down and refused to move. Real llamas do this when a load feels too heavy! The trail team carries on to the Sun Gate.' })
  }
};
