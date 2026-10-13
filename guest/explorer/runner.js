// Passport Explorer game: Runner (jump over obstacles to reach a goal). PORTED unchanged in logic and tuning from the owner's prototype; only the
// imports and the exports are new. Skins here: llama (Peru), swim (Easter Island), hike (Bhutan).
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
  },
  swim: {
    label:'Birdman race: tap or press Space to ride over the waves', hudItem:'Terns',
    bg(ctx, W, H, dist, g){
      skyC(ctx, W, g, ['#5a6fa8','#f0a07a','#ffd9a8']);
      circ(ctx, W * 0.25, g - 40, 26, '#ffe2b0');
      const cx = W * 0.05 - dist * 0.3; if (cx > -260) { ctx.fillStyle = '#4b4540'; ctx.beginPath(); ctx.moveTo(cx - 40, g); ctx.lineTo(cx - 40, g - 150); ctx.lineTo(cx + 120, g - 130); ctx.lineTo(cx + 180, g); ctx.fill(); ctx.fillStyle = '#6f8f4f'; ctx.fillRect(cx - 40, g - 156, 165, 10); }
      const sea = ctx.createLinearGradient(0, g - 8, 0, H); sea.addColorStop(0, '#3d7aa3'); sea.addColorStop(1, '#173f5f'); ctx.fillStyle = sea; ctx.fillRect(0, g - 8, W, H - g + 8);
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2;
      for (let r = 0; r < 4; r++) { ctx.beginPath(); for (let x = 0; x <= W; x += 10) { const yy = g + 6 + r * 9 + Math.sin((x + dist * (0.6 + r * 0.2)) * 0.04) * 2.5; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); }
    },
    player(ctx, x, y, phase, ground, flash){
      ctx.save(); ctx.translate(x, y); if (flash) ctx.globalAlpha = 0.4;
      ell(ctx, 0, -6, 34, 7, '#b58b4c'); ctx.strokeStyle = '#8a6a36'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-30, -6); ctx.lineTo(30, -6); ctx.moveTo(-26, -9); ctx.lineTo(26, -9); ctx.stroke();
      ell(ctx, 0, -15, 20, 6, '#6b4a3a'); circ(ctx, 24, -18, 7, '#6b4a3a');
      ctx.strokeStyle = '#6b4a3a'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(14, -16); ctx.lineTo(14 + Math.cos(phase * 2) * 16, -12 + Math.sin(phase * 2) * 10); ctx.stroke();
      ctx.restore();
    },
    obstacle(ctx, o, g){ ctx.fillStyle = '#9fd3e6'; ctx.beginPath(); ctx.moveTo(o.x - 6, g); ctx.quadraticCurveTo(o.x + o.w * 0.3, g - o.h * 1.4, o.x + o.w * 0.75, g - o.h * 1.05); ctx.quadraticCurveTo(o.x + o.w * 0.55, g - o.h * 0.5, o.x + o.w + 6, g); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(o.x + o.w * 0.15, g - o.h * 0.9); ctx.quadraticCurveTo(o.x + o.w * 0.4, g - o.h * 1.35, o.x + o.w * 0.75, g - o.h * 1.05); ctx.stroke(); },
    item(ctx, x, y){ ctx.strokeStyle = '#1d2433'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - 2, y + 4); ctx.quadraticCurveTo(x + 5, y - 4, x + 10, y + 5); ctx.quadraticCurveTo(x + 15, y - 4, x + 22, y + 4); ctx.stroke(); circ(ctx, x + 10, y + 6, 3, '#fff'); },
    goal(ctx, x, g){ ctx.fillStyle = '#5b544c'; ctx.beginPath(); ctx.moveTo(x - 70, g); ctx.quadraticCurveTo(x - 40, g - 110, x + 10, g - 95); ctx.quadraticCurveTo(x + 60, g - 80, x + 90, g); ctx.fill();
      ctx.fillStyle = '#7d9a5a'; ctx.fillRect(x - 30, g - 100, 60, 6); const glow = ctx.createRadialGradient(x, g - 106, 0, x, g - 106, 22); glow.addColorStop(0, 'rgba(255,240,200,.9)'); glow.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = glow; ctx.fillRect(x - 22, g - 128, 44, 44); ell(ctx, x, g - 106, 5, 7, '#f4ead7'); },
    ok:(n, clean) => ({ title:'Motu Nui!', text:`You reached the islet and spotted ${plural(n, 'sooty tern')}. Now the wait for the first egg begins. ${clean ? 'Not one wave got the better of you!' : 'Make it without a tumble for a star.'}` }),
    fail:() => ({ title:'Swept back to shore', text:'Three big waves pushed you back to the rocks below Orongo. The crossing is about a mile of open, rough sea: even champions needed several tries.' })
  },
  hike: {
    label:'Tiger’s Nest climb: tap or press Space to hop', hudItem:'Flags',
    bg(ctx, W, H, dist, g){
      skyC(ctx, W, H, ['#8fb8e0','#cfe0ee','#eef4f7']);
      ridgeC(ctx, W, H, dist * 0.04, H * 0.42, 60, 0.007, '#dfe8f0');
      ridgeC(ctx, W, H, dist * 0.15, H * 0.62, 40, 0.01, '#6f8e74');
      const cl = ((W * 0.85 - dist * 0.14) % (W + 400) + W + 400) % (W + 400) - 200;
      ctx.fillStyle = '#56524c'; ctx.beginPath(); ctx.moveTo(cl - 40, H); ctx.lineTo(cl - 30, H * 0.3); ctx.lineTo(cl + 50, H * 0.18); ctx.lineTo(cl + 70, H); ctx.fill();
      ctx.fillStyle = '#f6f1e7'; ctx.fillRect(cl - 10, H * 0.24, 34, 18); ctx.fillStyle = '#d9a531'; ctx.beginPath(); ctx.moveTo(cl - 14, H * 0.24); ctx.lineTo(cl + 7, H * 0.2); ctx.lineTo(cl + 28, H * 0.24); ctx.fill();
      ridgeC(ctx, W, H, dist * 0.5, g - 8, 16, 0.02, '#3e5a45');
      ctx.fillStyle = '#2f4a37'; const po = dist * 0.5 % 60; for (let x = -po; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, g - 50); ctx.lineTo(x + 14, g - 6); ctx.lineTo(x - 14, g - 6); ctx.fill(); }
      ctx.fillStyle = '#4f6b44'; ctx.fillRect(0, g, W, H - g); ctx.fillStyle = '#8a6a4a'; ctx.fillRect(0, g, W, 7);
      ctx.fillStyle = '#6e5238'; const off = dist % 28; for (let x = -off; x < W; x += 28) ctx.fillRect(x, g + 2, 6, 2);
    },
    player(ctx, x, y, phase, ground, flash){
      ctx.save(); ctx.translate(x, y); if (flash) ctx.globalAlpha = 0.4;
      const s = ground ? Math.sin(phase) * 10 : 6;
      ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(s, 0); ctx.moveTo(0, -30); ctx.lineTo(-s, 0); ctx.stroke();
      ctx.fillStyle = '#7d1d2a'; ctx.fillRect(-9, -62, 18, 34); ctx.fillStyle = '#e58a00'; ctx.fillRect(-19, -60, 11, 24);
      ctx.strokeStyle = '#7d1d2a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(4, -54); ctx.lineTo(14 - s * 0.4, -38); ctx.stroke();
      circ(ctx, 2, -72, 9, '#c99670'); ctx.fillStyle = '#2b2b33'; ctx.fillRect(-8, -82, 20, 5);
      ctx.restore();
    },
    obstacle(ctx, o, g){ if (o.k < 0.5) rock(ctx, o, g, '#7f7b74', '#a9a49b'); else { ctx.strokeStyle = '#5a3f2a'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(o.x, g); ctx.quadraticCurveTo(o.x + o.w / 2, g - o.h * 1.2, o.x + o.w, g); ctx.stroke(); } },
    item(ctx, x, y, k){ const cols = ['#2f6db5','#f4efe6','#c8332b','#2e8b57','#e9b40c']; ctx.strokeStyle = '#8a7a5a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 24, y + 2); ctx.stroke();
      for (let i = 0; i < 3; i++) { ctx.fillStyle = cols[(Math.floor(k * 5) + i) % 5]; ctx.fillRect(x - 4 + i * 9, y + 1, 7, 11); } },
    goal(ctx, x, g, H){ ctx.fillStyle = '#56524c'; ctx.beginPath(); ctx.moveTo(x - 30, g); ctx.lineTo(x - 20, g - 170); ctx.lineTo(x + 80, g - 190); ctx.lineTo(x + 100, g); ctx.fill();
      ctx.fillStyle = '#f6f1e7'; ctx.fillRect(x - 10, g - 150, 60, 34); ctx.fillStyle = '#8a1f2b'; ctx.fillRect(x - 10, g - 150, 60, 5);
      ctx.fillStyle = '#d9a531'; ctx.beginPath(); ctx.moveTo(x - 16, g - 150); ctx.lineTo(x + 20, g - 166); ctx.lineTo(x + 56, g - 150); ctx.fill(); },
    ok:(n, clean) => ({ title:'Taktsang!', text:`You reached Tiger’s Nest with ${plural(n, 'prayer flag')}. Below you lies the Paro valley; above, the cliff where Guru Rinpoche meditated. ${clean ? 'Sure-footed all the way!' : 'Climb it without a stumble for a star.'}` }),
    fail:() => ({ title:'Back on the mule', text:'After three stumbles you rode a mule back down. Many pilgrims take it slowly: it’s a steep climb at altitude.' })
  }
};
