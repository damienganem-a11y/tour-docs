// Passport Explorer game: Maze (find the way by lantern light, with the arrow pad). Skin: souk (Marrakech).
// PORTED unchanged in logic and tuning from the owner's prototype (tools/reference/jet-set-explorer-prototype.html); only the imports and exports are new.
import { canvasIn, ell, plural, setHud, sfx, shuffle } from './common.js';

export const maze = function(host, hud, onEnd, sk){
  const COLS = 9, ROWS = 11, TIME = 90, D = [[0, -1], [1, 0], [0, 1], [-1, 0]], OPP = [2, 3, 0, 1];
  const cells = Array.from({ length:COLS * ROWS }, (_, k) => ({ c:k % COLS, r:Math.floor(k / COLS), w:[1, 1, 1, 1], v:0 }));
  const at = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS) ? null : cells[r * COLS + c];
  const stack = [at(0, ROWS - 1)]; stack[0].v = 1;   // carve a perfect maze: exactly one way through
  while (stack.length) {
    const cur = stack[stack.length - 1], opts = [];
    for (let d = 0; d < 4; d++) { const n = at(cur.c + D[d][0], cur.r + D[d][1]); if (n && !n.v) opts.push([d, n]); }
    if (!opts.length) { stack.pop(); continue; }
    const [d, n] = opts[Math.floor(Math.random() * opts.length)]; cur.w[d] = 0; n.w[OPP[d]] = 0; n.v = 1; stack.push(n);
  }
  const goal = { c:COLS - 1, r:0 }, P = { c:0, r:ROWS - 1, x:0, y:ROWS - 1 };
  const isEnd = k => (cells[k].c === 0 && cells[k].r === ROWS - 1) || (cells[k].c === goal.c && cells[k].r === goal.r);
  const items = new Set(shuffle(cells.map((_, k) => k).filter(k => !isEnd(k))).slice(0, 6));
  const decos = cells.map((cl, k) => (!isEnd(k) && !items.has(k) && cl.w.reduce((a, b) => a + b, 0) === 3) ? k : null);
  const c = canvasIn(host, sk.label), ctx = c.getContext('2d');
  let W = 0, H = 0, S = 40, ox = 0, raf = 0, last = 0, playing = false, ended = false, time = TIME, got = 0;
  function size(){ const dpr = Math.min(2, window.devicePixelRatio || 1); W = host.clientWidth; S = Math.floor(Math.min((W - 16) / COLS, 46)); H = S * ROWS + 16; ox = Math.floor((W - S * COLS) / 2);
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  function move(d){
    if (!playing || ended || at(P.c, P.r).w[d]) return;
    P.c += D[d][0]; P.r += D[d][1]; sfx('step');
    const k = P.r * COLS + P.c;
    if (items.has(k)) { items.delete(k); got++; sfx('coin'); }
    if (P.c === goal.c && P.r === goal.r) end(true);
  }
  const KEYS = { ArrowUp:0, KeyW:0, ArrowRight:1, KeyD:1, ArrowDown:2, KeyS:2, ArrowLeft:3, KeyA:3 };
  const onKey = e => { if (e.code in KEYS) { e.preventDefault(); move(KEYS[e.code]); } };
  let sx = 0, sy = 0;
  c.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; });
  c.addEventListener('pointerup', e => { const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return; move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0)); });
  addEventListener('keydown', onKey); addEventListener('resize', size);
  function start(){ playing = true; last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop(){ ended = true; cancelAnimationFrame(raf); removeEventListener('keydown', onKey); removeEventListener('resize', size); }
  function end(ok){ ended = true; playing = false; cancelAnimationFrame(raf); draw();
    const star = ok && got >= 4; onEnd(ok ? { star, ...sk.ok(Math.round(TIME - time), got, star) } : { star:false, ...sk.fail(got) }); }
  function tick(now){
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    time -= dt; if (time <= 0) { time = 0; end(false); return; }
    P.x += (P.c - P.x) * Math.min(1, dt * 16); P.y += (P.r - P.y) * Math.min(1, dt * 16);
    setHud(hud, `<span class="pill">${Math.ceil(time)} s</span><span class="pill">${sk.hudItem} ${got} / 6</span><span class="muted" style="font-size:13px">${sk.hint}</span>`);
    draw(); if (!ended) raf = requestAnimationFrame(tick);
  }
  function draw(){
    if (!W) return;
    const oy = 8;
    ctx.fillStyle = `rgb(${sk.fog})`; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = sk.floor; ctx.fillRect(ox, oy, S * COLS, S * ROWS);
    ctx.fillStyle = sk.check; for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) if ((r + q) % 2) ctx.fillRect(ox + q * S, oy + r * S, S, S);
    decos.forEach(k => { if (k !== null) sk.deco(ctx, ox + cells[k].c * S, oy + cells[k].r * S, S, k); });
    items.forEach(k => sk.item(ctx, ox + (cells[k].c + 0.5) * S, oy + (cells[k].r + 0.5) * S, S));
    sk.goal(ctx, ox + (goal.c + 0.5) * S, oy + (goal.r + 0.5) * S, S * 0.86);
    const wallPath = () => { ctx.beginPath(); cells.forEach(cl => { const x = ox + cl.c * S, y = oy + cl.r * S;
      if (cl.w[0]) { ctx.moveTo(x, y); ctx.lineTo(x + S, y); }
      if (cl.w[3]) { ctx.moveTo(x, y); ctx.lineTo(x, y + S); }
      if (cl.c === COLS - 1 && cl.w[1]) { ctx.moveTo(x + S, y); ctx.lineTo(x + S, y + S); }
      if (cl.r === ROWS - 1 && cl.w[2]) { ctx.moveTo(x, y + S); ctx.lineTo(x + S, y + S); } }); };
    ctx.lineCap = 'square'; ctx.lineWidth = Math.max(4, S * 0.2);
    ctx.save(); ctx.translate(0, 2.5); ctx.strokeStyle = sk.shadow; wallPath(); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = sk.wall; wallPath(); ctx.stroke();
    const px = ox + (P.x + 0.5) * S, py = oy + (P.y + 0.5) * S;
    if (!ended) {
      const fog = ctx.createRadialGradient(px, py, S * 1.3, px, py, S * 3.4);
      fog.addColorStop(0, `rgba(${sk.fog},0)`); fog.addColorStop(1, `rgba(${sk.fog},.95)`); ctx.fillStyle = fog; ctx.fillRect(0, 0, W, H);
      const gx = ox + (goal.c + 0.5) * S, gy = oy + (goal.r + 0.5) * S, glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, S * 1.3);
      glow.addColorStop(0, `rgba(${sk.glow},.8)`); glow.addColorStop(1, `rgba(${sk.glow},0)`); ctx.fillStyle = glow; ctx.fillRect(gx - S * 1.3, gy - S * 1.3, S * 2.6, S * 2.6);
    }
    ctx.fillStyle = '#e9a800'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(px, py, S * 0.24, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  size();
  setHud(hud, `<span class="pill">${TIME} s</span><span class="pill">${sk.hudItem} 0 / 6</span><span class="muted" style="font-size:13px">${sk.hint}</span>`);
  return { start, stop, move };
};

export const mazeSkins = {
  souk: {
    label:'Souk maze: swipe, use the arrows, or the keyboard', hudItem:'Mint', hint:'Follow the lantern',
    floor:'#f1dcc0', check:'rgba(190,120,70,.10)', wall:'#c8704b', shadow:'rgba(80,35,20,.35)', fog:'42,28,22', glow:'255,214,120',
    deco(ctx, x, y, S, k){ ctx.fillStyle = ['#d9822b','#c43d2f','#e2b13c','#7a9a3a','#8e4a9a'][k % 5]; ctx.beginPath(); ctx.moveTo(x + S * 0.28, y + S * 0.72); ctx.lineTo(x + S * 0.5, y + S * 0.32); ctx.lineTo(x + S * 0.72, y + S * 0.72); ctx.fill(); },
    item(ctx, cx, cy, s){ ell(ctx, cx - s * 0.08, cy, s * 0.16, s * 0.08, '#3f9a52', -0.6); ell(ctx, cx + s * 0.08, cy - s * 0.04, s * 0.16, s * 0.08, '#3f9a52', 0.6); },
    goal(ctx, cx, cy, s){
      ctx.fillStyle = '#2f7f86'; ctx.fillRect(cx - s * 0.5, cy - s * 0.5, s, s);
      ell(ctx, cx, cy + s * 0.08, s * 0.24, s * 0.18, '#e8c86b');
      ctx.beginPath(); ctx.moveTo(cx - s * 0.18, cy + s * 0.05); ctx.lineTo(cx - s * 0.38, cy - s * 0.14); ctx.lineTo(cx - s * 0.22, cy + s * 0.14); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - s * 0.1, cy - s * 0.08); ctx.lineTo(cx, cy - s * 0.3); ctx.lineTo(cx + s * 0.1, cy - s * 0.08); ctx.fill(); },
    ok:(t, n, star) => ({ title:'Tea is served!', text:`You found the family’s door in ${t} seconds with ${plural(n, 'sprig')} of fresh mint. ${star ? 'Your host is delighted with the mint.' : 'Bring at least 4 sprigs of mint for a star.'}` }),
    fail:() => ({ title:'A friendly rescue', text:'The tea was getting cold, so a shopkeeper walked you the rest of the way. It happens to everyone in the medina!' })
  }
};
