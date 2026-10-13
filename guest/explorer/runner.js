// Passport Explorer game: Runner (jump over obstacles to reach a goal). PORTED unchanged in logic and tuning from the owner's prototype; only the
// imports and the exports are new. Only the llama skin (Peru) is kept: the owner chose three DIFFERENT games for Easter Island and Bhutan instead of three runners, so the prototype's other two runner skins (swim, hike) are not brought over.
import { ridgeC, peakC, skyC, ell, circ, plural, setHud, canvasIn, sfx, makeGrain, grainFill, glow, groundShadow, vignette, cloud, litShape } from './common.js';

export const runner = function(host, hud, onEnd, sk){
  const c = canvasIn(host, sk.label), ctx = c.getContext('2d');
  let W = 0, H = 0;
  const GOAL = 9000, L = { y:0, vy:0, ground:true, hurt:0 };
  let obs = [], items = [], dist = 0, speed = 220, lives = 3, got = 0, spawn = 1.6, ispawn = 2.4, raf = 0, last = 0, playing = false, ended = false;
  const lx = () => Math.max(64, W * 0.17), gy = () => H - 46;
  function size(){ const dpr = Math.min(3, window.devicePixelRatio || 1); W = host.clientWidth; H = Math.round(Math.max(300, Math.min(380, W * 0.75)));
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
      // Sky: deep morning blue to warm peach, with the sun glowing behind the peaks and thin clouds drifting slowly.
      skyC(ctx, W, H, ['#6f93c8','#c7b3c9','#f4c4a6','#fbe3c4']);
      glow(ctx, W * 0.78, H * 0.3, 190, '255,226,170', 0.85); circ(ctx, W * 0.78, H * 0.3, 20, '#fff6e2');
      for (let i = 0; i < 3; i++) cloud(ctx, ((W * (0.2 + i * 0.35) - dist * (0.015 + i * 0.006)) % (W + 240) + W + 240) % (W + 240) - 120, H * (0.16 + i * 0.07), 0.9 + i * 0.2, 0.55);
      // Far snow peaks: lit on the sun side, shaded on the other, with a soft haze at their feet.
      [[0.12, 96, 0.62], [0.5, 120, 0.72], [0.88, 88, 0.6]].forEach(([fx, ph, sc], i) => {
        const w = 190 * sc, x = ((W * fx - dist * 0.03 * (1 + i * 0.2)) % (W + 400) + W + 400) % (W + 400) - 200, base = H * 0.56, top = base - ph;
        litShape(ctx, [[x - w, base], [x - w * 0.15, top], [x + w * 0.1, top + 8], [x + w, base]], '#c9d3e6', '#8d9bbd', null);
        ctx.fillStyle = 'rgba(70,84,125,.35)'; ctx.beginPath(); ctx.moveTo(x + w * 0.1, top + 8); ctx.lineTo(x + w, base); ctx.lineTo(x + w * 0.1, base); ctx.fill();
        ctx.fillStyle = '#fbfcff'; ctx.beginPath(); ctx.moveTo(x - w * 0.15, top); ctx.lineTo(x - w * 0.34, top + ph * 0.3); ctx.lineTo(x - w * 0.16, top + ph * 0.24); ctx.lineTo(x, top + ph * 0.36); ctx.lineTo(x + w * 0.1, top + 8); ctx.closePath(); ctx.fill();
      });
      const haze = ctx.createLinearGradient(0, H * 0.46, 0, H * 0.64); haze.addColorStop(0, 'rgba(255,236,214,0)'); haze.addColorStop(1, 'rgba(255,236,214,.7)'); ctx.fillStyle = haze; ctx.fillRect(0, H * 0.46, W, H * 0.18);
      // Green mid hills, then the Machu Picchu mountain, then the stepped Inca terraces.
      ridgeC(ctx, W, H, dist * 0.08, H * 0.62, 26, 0.008, '#7e9b86');
      const pk = ((W * 0.72 - dist * 0.12) % (W + 300) + W + 300) % (W + 300) - 150; peakC(ctx, pk, H * 0.74, 130, 128, '#4f7a58');
      ctx.fillStyle = 'rgba(25,60,40,.25)'; ctx.beginPath(); ctx.moveTo(pk, H * 0.74 - 128); ctx.lineTo(pk + 65, H * 0.74); ctx.lineTo(pk + 6, H * 0.74); ctx.fill();
      const tw = 170, to = (dist * 0.32) % tw;
      for (let x = -to - tw; x < W + tw; x += tw) {
        for (let st = 0; st < 4; st++) {
          const y = g - 46 + st * 11, inset = (3 - st) * 12;
          litShape(ctx, [[x + inset, y], [x + tw - inset, y], [x + tw - inset, y + 11], [x + inset, y + 11]], '#8fb36f', '#5f8c55', 'rgba(255,255,255,.18)');
          ctx.fillStyle = '#bdb2a0'; ctx.fillRect(x + inset, y + 8, tw - inset * 2, 3); ctx.fillStyle = 'rgba(80,70,55,.35)'; ctx.fillRect(x + inset, y + 10.5, tw - inset * 2, 1.2);
        }
      }
      // Ground: the stone path with worn slabs, grass tufts and a sprinkle of flowers racing past in the front.
      const gr = ctx.createLinearGradient(0, g, 0, H); gr.addColorStop(0, '#7aa567'); gr.addColorStop(1, '#4d7a45'); ctx.fillStyle = gr; ctx.fillRect(0, g, W, H - g);
      ctx.fillStyle = '#d3c8b4'; ctx.fillRect(0, g, W, 9); ctx.fillStyle = '#a99d86'; ctx.fillRect(0, g + 9, W, 2);
      const so = dist % 46; for (let x = -so; x < W; x += 46) { ctx.fillStyle = 'rgba(120,108,88,.55)'; ctx.fillRect(x, g, 2, 9); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x + 4, g + 1, 18, 2); }
      const fo = dist * 0.9 % 60; for (let x = -fo; x < W + 60; x += 60) { ctx.strokeStyle = '#3f6b3a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, g + 30); ctx.lineTo(x - 5, g + 20); ctx.moveTo(x, g + 30); ctx.lineTo(x + 1, g + 17); ctx.moveTo(x, g + 30); ctx.lineTo(x + 6, g + 21); ctx.stroke(); circ(ctx, x + 1, g + 17, 2.2, '#f4c542'); }
      vignette(ctx, W, H, 0.18);
    },
    player(ctx, x, y, phase, ground, flash){
      groundShadow(ctx, x, y + (ground ? 0 : 0) , 34, 7, ground ? 0.3 : 0.15);
      ctx.save(); ctx.translate(x, y); if (flash) ctx.globalAlpha = 0.4;
      const bob = ground ? Math.sin(phase * 2) * 1.5 : 0;
      // legs with hooves
      [[-18, 0], [-9, Math.PI], [10, Math.PI / 2], [19, Math.PI * 1.5]].forEach(([dx, p], i) => { const s = ground ? Math.sin(phase + p) * 5 : 3; ctx.fillStyle = i % 2 ? '#c9b48c' : '#d9c6a0'; ctx.fillRect(dx + s * 0.6 - 3, -26, 6, 26); ctx.fillStyle = '#7a6244'; ctx.fillRect(dx + s * 0.6 - 3.5, -4, 7, 4); });
      // woolly body with soft shading and a few tufts
      const body = ctx.createRadialGradient(-4, -42 + bob, 4, 0, -34 + bob, 34); body.addColorStop(0, '#fffaf0'); body.addColorStop(1, '#e6d6b8'); ctx.fillStyle = body;
      ctx.beginPath(); ctx.ellipse(0, -35 + bob, 29, 15, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fffaf0'; [[-22, -44], [-10, -50], [4, -51], [16, -47], [-26, -35], [22, -38]].forEach(([tx, ty]) => circ(ctx, tx, ty + bob, 6, '#fffaf0'));
      circ(ctx, -29, -41 + bob, 6, '#fbf3e4');
      // neck, head, ears, eye, nose
      ctx.fillStyle = '#fbf3e4'; ctx.fillRect(14, -73 + bob, 12, 38);
      ell(ctx, 25, -74 + bob, 12.5, 8, '#fbf3e4'); ell(ctx, 35, -72 + bob, 5.5, 4.2, '#e2cfae'); circ(ctx, 38, -72 + bob, 1.2, '#7a5a40');
      ctx.fillStyle = '#fbf3e4'; ctx.beginPath(); ctx.moveTo(17, -79 + bob); ctx.lineTo(18, -92 + bob); ctx.lineTo(23, -80 + bob); ctx.moveTo(22, -80 + bob); ctx.lineTo(26, -93 + bob); ctx.lineTo(29, -80 + bob); ctx.fill();
      ctx.fillStyle = '#ecc9b6'; ctx.beginPath(); ctx.moveTo(18.5, -80 + bob); ctx.lineTo(18.8, -88 + bob); ctx.lineTo(21.5, -80 + bob); ctx.fill();
      circ(ctx, 27, -76 + bob, 2.4, '#1b2433'); circ(ctx, 27.8, -76.8 + bob, 0.8, '#fff'); circ(ctx, 19, -85 + bob, 3, '#e94f8a'); circ(ctx, 19, -85 + bob, 1.2, '#ffd0e3');
      // the woven saddle blanket with a diamond pattern
      ctx.fillStyle = '#b8322a'; ctx.fillRect(-15, -48 + bob, 25, 15); ctx.fillStyle = '#f0b429'; ctx.fillRect(-15, -44 + bob, 25, 2.5); ctx.fillStyle = '#1f7a76'; ctx.fillRect(-15, -39 + bob, 25, 2.5);
      ctx.fillStyle = '#fff3d6'; for (let q = 0; q < 4; q++) { ctx.beginPath(); ctx.moveTo(-10 + q * 6, -36 + bob); ctx.lineTo(-7 + q * 6, -39 + bob); ctx.lineTo(-4 + q * 6, -36 + bob); ctx.lineTo(-7 + q * 6, -33.5 + bob); ctx.fill(); }
      ctx.strokeStyle = '#e8c53a'; ctx.lineWidth = 1.4; for (let q = 0; q < 5; q++) { ctx.beginPath(); ctx.moveTo(-14 + q * 5.5, -33 + bob); ctx.lineTo(-14 + q * 5.5, -29 + bob); ctx.stroke(); }
      ctx.restore();
    },
    obstacle(ctx, o, g){
      groundShadow(ctx, o.x + o.w / 2, g + 1, o.w * 0.8, 4, 0.25);
      litShape(ctx, [[o.x, g], [o.x + o.w * 0.12, g - o.h * 0.7], [o.x + o.w * 0.28, g - o.h], [o.x + o.w * 0.75, g - o.h * 0.88], [o.x + o.w, g - o.h * 0.3], [o.x + o.w, g]], '#b3aea2', '#7b766b', 'rgba(255,255,255,.3)');
      ctx.fillStyle = 'rgba(40,36,30,.28)'; ctx.beginPath(); ctx.moveTo(o.x + o.w * 0.6, g - o.h * 0.9); ctx.lineTo(o.x + o.w, g - o.h * 0.3); ctx.lineTo(o.x + o.w, g); ctx.lineTo(o.x + o.w * 0.5, g); ctx.fill();
      ctx.fillStyle = '#6f9a62'; ctx.beginPath(); ctx.ellipse(o.x + o.w * 0.35, g - o.h * 0.96, o.w * 0.22, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    },
    item(ctx, x, y){ ctx.save(); ctx.translate(x + 9, y + 9); glow(ctx, 0, 0, 22, '255,214,120', 0.45); ctx.rotate(Math.PI / 4); ctx.fillStyle = '#c0392b'; ctx.fillRect(-9, -9, 18, 18); ctx.fillStyle = '#f0b429'; ctx.fillRect(-9, -3, 18, 2.5); ctx.fillRect(-9, 3, 18, 2.5); ctx.fillStyle = '#1f7a76'; ctx.fillRect(-9, -6, 18, 1.5); ctx.fillRect(-9, 0, 18, 1.5);
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.strokeRect(-8.5, -8.5, 17, 17); ctx.restore(); },
    goal(ctx, x, g){
      // The Sun Gate: a stone doorway of big blocks with the morning light pouring through.
      litShape(ctx, [[x - 46, g], [x - 46, g - 124], [x + 46, g - 124], [x + 46, g]], '#c8bda9', '#9a9078', null);
      ctx.strokeStyle = 'rgba(80,70,55,.45)'; ctx.lineWidth = 1.4; for (let r = 0; r < 6; r++) { ctx.beginPath(); ctx.moveTo(x - 46, g - 124 + r * 21); ctx.lineTo(x + 46, g - 124 + r * 21); ctx.stroke(); for (let q = 0; q < 3; q++) { ctx.beginPath(); ctx.moveTo(x - 46 + ((r + q) % 2 ? 16 : 30) + q * 32, g - 124 + r * 21); ctx.lineTo(x - 46 + ((r + q) % 2 ? 16 : 30) + q * 32, g - 124 + (r + 1) * 21); ctx.stroke(); } }
      glow(ctx, x, g - 40, 70, '255,226,160', 0.95);
      const door = ctx.createLinearGradient(0, g - 78, 0, g); door.addColorStop(0, '#fff1c8'); door.addColorStop(1, '#ffd48a'); ctx.fillStyle = door; ctx.beginPath(); ctx.moveTo(x - 15, g); ctx.lineTo(x - 11, g - 78); ctx.lineTo(x + 11, g - 78); ctx.lineTo(x + 15, g); ctx.fill();
    },
    ok:(n, clean) => ({ title:'Sun Gate reached!', text:`You reached Inti Punku with ${plural(n, 'woven textile')}. Machu Picchu lies below you in the morning light. ${clean ? 'Not a single stumble!' : 'Reach it without a stumble for a star.'}` }),
    fail:() => ({ title:'The llama sat down', text:'After three stumbles your llama lay down and refused to move. Real llamas do this when a load feels too heavy! The trail team carries on to the Sun Gate.' })
  }
};
