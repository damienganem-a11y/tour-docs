// Passport Explorer game: Spot (tap the animal named at the top). Skins: safari (Serengeti), himalaya (Kathmandu, new).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { canvasIn, circ, ell, plural, setHud, sfx, skyC } from './common.js';

export const spot = function(host, hud, onEnd, sk){
  const c = canvasIn(host, sk.label), ctx = c.getContext('2d');
  let W = 0, H = 0, raf = 0, last = 0, playing = false, ended = false, ents = [], target = null, count = 0, mist = 0, time = sk.time, msg = '', msgT = 0, flashT = -9, clock = 0;
  function size(){ const dpr = Math.min(3, window.devicePixelRatio || 1); W = host.clientWidth; H = Math.round(Math.max(360, Math.min(470, W * 0.95)));
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  function spawn(T){
    T = T || sk.types[Math.floor(Math.random() * sk.types.length)];
    const dir = Math.random() < .5 ? 1 : -1, depth = Math.random(), s = 0.7 + depth * 0.55;
    ents.push({ T, dir, s, x:dir > 0 ? -70 : W + 70, y:H * (sk.y[0] + (sk.y[1] - sk.y[0]) * depth), sp:(T.speed[0] + Math.random() * (T.speed[1] - T.speed[0])) * (0.7 + s * 0.4), ph:Math.random() * 6 });
    ents.sort((a, b) => a.y - b.y);
  }
  function pick(){ const others = sk.types.filter(t => !target || t.name !== target.name); target = others[Math.floor(Math.random() * others.length)]; if (!ents.some(e => e.T === target)) spawn(target); }
  c.addEventListener('pointerdown', e => {
    if (!playing || ended) return;
    const b = c.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    for (let i = ents.length - 1; i >= 0; i--) { const en = ents[i], cy = en.y - en.T.cy * en.s;
      if (Math.hypot(x - en.x, y - cy) < en.T.r * en.s) {
        if (en.T === target) { count++; flashT = clock; sfx('snap'); ents.splice(i, 1); msg = `${target.name}: got it!`; msgT = clock; if (count >= sk.goal) return end(); pick(); }
        else { mist++; sfx('wrong'); msg = `That’s a ${en.T.name.toLowerCase()}!`; msgT = clock; }
        return; } }
    if (sk.bad && sk.bad(x, y, W, H)) { mist++; sfx('wrong'); msg = sk.badMsg; msgT = clock; }
  });
  function start(){ playing = true; for (let i = 0; i < 5; i++) { spawn(); ents[ents.length - 1].x = Math.random() * W; } pick(); last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop(){ ended = true; cancelAnimationFrame(raf); removeEventListener('resize', size); }
  function end(){ ended = true; playing = false; cancelAnimationFrame(raf); const star = count >= sk.goal && mist <= 1; onEnd(count >= sk.goal ? { star, ...sk.ok(count, mist, star) } : { star:false, ...sk.fail(count) }); }
  function tick(now){
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    time -= dt; if (time <= 0) { time = 0; return end(); }
    ents.forEach(e => { e.x += e.dir * e.sp * dt; e.ph += dt; });
    ents = ents.filter(e => e.x > -90 && e.x < W + 90);
    while (ents.length < 6) spawn();
    if (!ents.some(e => e.T === target)) spawn(target);
    setHud(hud, `<span class="pill gold">${sk.verb}: ${target.name}</span><span class="pill">${count} / ${sk.goal}</span><span class="pill">${Math.ceil(time)} s</span><span class="pill">Mistakes ${mist}</span>`);
    draw(); if (!ended) raf = requestAnimationFrame(tick);
  }
  function draw(){
    if (!W) return;
    sk.bg(ctx, W, H, clock);
    ents.forEach(e => { ctx.save(); ctx.translate(e.x, e.y); ctx.scale(e.s * e.dir, e.s); e.T.draw(ctx, e.ph); ctx.restore(); });
    if (sk.fg) sk.fg(ctx, W, H, clock);
    if (clock - flashT < 0.2) { ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - (clock - flashT) / 0.2)})`; ctx.fillRect(0, 0, W, H); }
    if (msg && clock - msgT < 1.2) { ctx.font = '700 18px Outfit, sans-serif'; ctx.textAlign = 'center'; const tw = ctx.measureText(msg).width + 28;
      ctx.fillStyle = 'rgba(23,23,26,.8)'; ctx.beginPath(); ctx.roundRect(W / 2 - tw / 2, 14, tw, 34, 17); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(msg, W / 2, 37); }
  }
  size(); addEventListener('resize', size);
  setHud(hud, `<span class="pill">${sk.goal} to find</span><span class="pill">${sk.time} s</span>`);
  return { start, stop, move(){} };
};

const legs = (ctx, xs, top, len, col, ph, w) => { ctx.strokeStyle = col; ctx.lineWidth = w || 4; ctx.lineCap = 'round'; xs.forEach((x, i) => { const s = Math.sin(ph * 8 + i * 1.7) * 4; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + s, top + len); ctx.stroke(); }); };
export const spotSkins = {
  safari: {
    label:'Photo safari: tap the animal the guide calls out', verb:'Snap', goal:8, time:50, y:[0.55, 0.95],
    bg(ctx, W, H){ skyC(ctx, W, H * 0.48, ['#9fc1d9','#f7c27a','#fbe3b0']); circ(ctx, W * 0.78, H * 0.38, 30, '#ffd27a');
      ctx.fillStyle = '#c98a4c'; ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(0, H * 0.48); ctx.quadraticCurveTo(W * 0.3, H * 0.4, W * 0.6, H * 0.47); ctx.lineTo(W, H * 0.46); ctx.lineTo(W, H * 0.5); ctx.lineTo(0, H * 0.5); ctx.fill(); ctx.globalAlpha = 1;
      const g = ctx.createLinearGradient(0, H * 0.48, 0, H); g.addColorStop(0, '#d9ab5c'); g.addColorStop(1, '#b98a3e'); ctx.fillStyle = g; ctx.fillRect(0, H * 0.48, W, H * 0.52);
      [[0.15, 0.5, 0.9], [0.86, 0.49, 0.7]].forEach(([fx, fy, s]) => { const x = W * fx, y = H * fy; ctx.strokeStyle = '#3c2a1c'; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 34 * s); ctx.stroke(); ell(ctx, x, y - 40 * s, 40 * s, 8 * s, '#3c2a1c'); ell(ctx, x - 10 * s, y - 45 * s, 22 * s, 6 * s, '#3c2a1c'); }); },
    types:[
      { name:'Zebra', r:36, cy:30, speed:[40, 70], draw(ctx, ph){ legs(ctx, [-18, -10, 12, 20], -20, 20, '#222', ph);
          ctx.save(); ctx.beginPath(); ctx.ellipse(0, -28, 26, 13, 0, 0, Math.PI * 2); ctx.fillStyle = '#fafafa'; ctx.fill(); ctx.clip(); ctx.strokeStyle = '#222'; ctx.lineWidth = 3; for (let x = -24; x < 26; x += 7) { ctx.beginPath(); ctx.moveTo(x, -42); ctx.quadraticCurveTo(x + 3, -28, x, -14); ctx.stroke(); } ctx.restore();
          ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.moveTo(16, -36); ctx.lineTo(30, -56); ctx.lineTo(42, -50); ctx.lineTo(24, -28); ctx.fill(); ell(ctx, 38, -50, 9, 5, '#fafafa', 0.5); ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(18, -38); ctx.lineTo(30, -56); ctx.stroke(); circ(ctx, 44, -46, 2.5, '#222'); } },
      { name:'Giraffe', r:52, cy:56, speed:[30, 50], draw(ctx, ph){ legs(ctx, [-14, -7, 12, 18], -42, 42, '#c9973f', ph, 5); ell(ctx, 0, -48, 24, 12, '#e0b25a');
          ctx.strokeStyle = '#e0b25a'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(16, -52); ctx.lineTo(30, -98); ctx.stroke(); ell(ctx, 35, -100, 10, 5, '#e0b25a', 0.3);
          [[-10, -50], [4, -46], [-2, -54], [14, -50], [22, -70], [26, -84]].forEach(([x, y]) => circ(ctx, x, y, 3, '#9a6328')); ctx.strokeStyle = '#9a6328'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(32, -104); ctx.lineTo(31, -112); ctx.moveTo(36, -104); ctx.lineTo(37, -112); ctx.stroke(); } },
      { name:'Elephant', r:44, cy:32, speed:[22, 38], draw(ctx, ph){ ctx.fillStyle = '#8d8a86'; [-18, -6, 10, 22].forEach((x, i) => ctx.fillRect(x - 5 + Math.sin(ph * 5 + i) * 2, -18, 10, 18)); ell(ctx, 0, -32, 32, 22, '#8d8a86'); circ(ctx, 32, -38, 15, '#8d8a86'); ell(ctx, 24, -36, 10, 14, '#7a7773');
          ctx.strokeStyle = '#8d8a86'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(42, -34); ctx.quadraticCurveTo(50, -18, 46, -4); ctx.stroke(); ctx.strokeStyle = '#f4efe6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(40, -28); ctx.lineTo(48, -24); ctx.stroke(); circ(ctx, 36, -44, 2, '#222'); } },
      { name:'Lion', r:34, cy:24, speed:[35, 60], draw(ctx, ph){ legs(ctx, [-16, -8, 12, 18], -14, 14, '#c99545', ph, 5); ell(ctx, 0, -22, 26, 11, '#d4a35a');
          ctx.strokeStyle = '#d4a35a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-24, -24); ctx.quadraticCurveTo(-38, -30, -36, -14); ctx.stroke(); circ(ctx, -36, -14, 3, '#7a4a1c');
          circ(ctx, 26, -30, 14, '#8f5524'); circ(ctx, 29, -29, 8, '#d9ad66'); circ(ctx, 32, -31, 1.8, '#222'); } },
      { name:'Wildebeest', r:36, cy:30, speed:[45, 75], draw(ctx, ph){ legs(ctx, [-16, -8, 12, 18], -20, 20, '#4a4440', ph); ell(ctx, 0, -28, 26, 13, '#5a5450'); ell(ctx, 10, -36, 14, 8, '#5a5450');
          ctx.fillStyle = '#4a4440'; ctx.beginPath(); ctx.moveTo(20, -38); ctx.lineTo(38, -30); ctx.lineTo(40, -18); ctx.lineTo(24, -24); ctx.fill(); ctx.strokeStyle = '#2a2622'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(26, -38); ctx.quadraticCurveTo(22, -50, 32, -48); ctx.stroke();
          ctx.strokeStyle = '#2a2622'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(32, -20); ctx.lineTo(30, -12); ctx.moveTo(35, -21); ctx.lineTo(34, -13); ctx.stroke(); } }
    ],
    ok:(n, m, star) => ({ title:star ? 'Cover shot!' : 'Great safari', text:`You snapped all ${n} animals with ${plural(m, 'mistake')}. ${star ? 'Your guide wants a copy of your photos.' : 'Make at most one mistake for a star.'}` }),
    fail:n => ({ title:'The light fades', text:`You snapped ${plural(n, 'animal')} before sunset. The animals will be back at dawn, and so will you.` })
  },
  // New in this app (Kathmandu): four animals of the Himalaya, drawn in the style of the safari ones.
  himalaya: {
    label:'Roof of the world: tap the animal the guide calls out', verb:'Find', goal:8, time:50, y:[0.58, 0.95],
    bg(ctx, W, H){ skyC(ctx, W, H * 0.5, ['#7fa6d6','#f4c9a4','#fbe6cc']);
      ctx.fillStyle = '#e8eef6'; ctx.beginPath(); ctx.moveTo(0, H * 0.5); ctx.lineTo(W * 0.12, H * 0.26); ctx.lineTo(W * 0.24, H * 0.42); ctx.lineTo(W * 0.4, H * 0.18); ctx.lineTo(W * 0.56, H * 0.4); ctx.lineTo(W * 0.74, H * 0.24); ctx.lineTo(W * 0.88, H * 0.4); ctx.lineTo(W, H * 0.3); ctx.lineTo(W, H * 0.5); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(W * 0.4, H * 0.18); ctx.lineTo(W * 0.35, H * 0.27); ctx.lineTo(W * 0.4, H * 0.25); ctx.lineTo(W * 0.45, H * 0.28); ctx.fill();
      const g = ctx.createLinearGradient(0, H * 0.5, 0, H); g.addColorStop(0, '#7d9a5a'); g.addColorStop(1, '#5f7a44'); ctx.fillStyle = g; ctx.fillRect(0, H * 0.5, W, H * 0.5);
      [[0.1, 0.52], [0.9, 0.52]].forEach(([fx, fy]) => { const x = W * fx, y = H * fy; ctx.fillStyle = '#2f4a37'; ctx.beginPath(); ctx.moveTo(x, y - 60); ctx.lineTo(x + 20, y); ctx.lineTo(x - 20, y); ctx.fill(); }); },
    types:[
      { name:'Yak', r:44, cy:30, speed:[22, 38], draw(ctx, ph){ legs(ctx, [-20, -8, 10, 22], -18, 18, '#2b2420', ph, 7); ell(ctx, 0, -30, 32, 20, '#3a2f29'); ctx.fillStyle = '#2b2420'; ctx.beginPath(); ctx.moveTo(-30, -20); ctx.lineTo(-30, -2); ctx.lineTo(28, -2); ctx.lineTo(30, -20); ctx.fill();
          ell(ctx, 32, -34, 12, 10, '#3a2f29'); ctx.strokeStyle = '#efe6d2'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(30, -42); ctx.quadraticCurveTo(26, -56, 36, -54); ctx.stroke(); circ(ctx, 37, -36, 2, '#efe6d2'); } },
      { name:'Red panda', r:30, cy:18, speed:[20, 36], draw(ctx, ph){ ctx.strokeStyle = '#a8501f'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-18, -14); ctx.quadraticCurveTo(-40, -18, -42, -4); ctx.stroke();
          ctx.strokeStyle = '#f4e6d0'; ctx.lineWidth = 3; [-32, -37].forEach((x) => { ctx.beginPath(); ctx.moveTo(x, -22); ctx.lineTo(x - 2, -4); ctx.stroke(); }); legs(ctx, [-10, 0, 12, 18], -8, 8, '#2a1a14', ph, 5);
          ell(ctx, 0, -16, 20, 11, '#b95a22'); circ(ctx, 22, -20, 10, '#c96a2a'); circ(ctx, 28, -19, 7, '#f4ead6'); ell(ctx, 18, -30, 4, 5, '#c96a2a'); ell(ctx, 28, -30, 4, 5, '#c96a2a'); circ(ctx, 31, -20, 2, '#222'); circ(ctx, 24, -23, 1.6, '#222'); } },
      { name:'Snow leopard', r:36, cy:24, speed:[35, 60], draw(ctx, ph){ legs(ctx, [-16, -8, 12, 18], -14, 14, '#bdb6aa', ph, 5); ell(ctx, 0, -22, 26, 11, '#d8d2c6');
          ctx.strokeStyle = '#d8d2c6'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-24, -24); ctx.quadraticCurveTo(-46, -30, -44, -10); ctx.stroke();
          [[-10, -24], [0, -20], [10, -25], [-18, -18], [4, -28]].forEach(([x, y]) => circ(ctx, x, y, 3, '#4a463f')); circ(ctx, 26, -28, 12, '#d8d2c6'); circ(ctx, 32, -26, 6, '#efe9df'); circ(ctx, 29, -31, 1.8, '#222'); ell(ctx, 21, -38, 3, 4, '#d8d2c6'); } },
      { name:'Monal pheasant', r:30, cy:20, speed:[30, 52], draw(ctx, ph){ legs(ctx, [-4, 4], -8, 10, '#6b5a3a', ph, 3); ell(ctx, 0, -18, 18, 11, '#2b6cb5'); ell(ctx, -12, -20, 14, 8, '#1f8a6a');
          ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(-18, -20); ctx.lineTo(-30, -14); ctx.lineTo(-18, -12); ctx.fill(); circ(ctx, 16, -28, 7, '#1f8a6a'); ctx.strokeStyle = '#2b6cb5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(14, -34); ctx.lineTo(10, -42); ctx.moveTo(17, -34); ctx.lineTo(18, -43); ctx.stroke(); circ(ctx, 19, -29, 1.6, '#222'); ctx.fillStyle = '#e9b40c'; ctx.beginPath(); ctx.moveTo(22, -28); ctx.lineTo(28, -26); ctx.lineTo(22, -25); ctx.fill(); } }
    ],
    ok:(n, m, star) => ({ title:star ? 'Eyes of a naturalist' : 'Well spotted', text:`You found all ${n} animals with ${plural(m, 'mistake')}. ${star ? 'Your guide is impressed.' : 'Make at most one mistake for a star.'}` }),
    fail:n => ({ title:'The mist rolls in', text:`You found ${plural(n, 'animal')} before the mist came down. The animals are shy: they will wait for you.` })
  }
};
