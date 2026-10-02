// A small QR code writer (no library, no internet): text in, a square of dark/light cells out. Used for the guests' personal links.
// Byte mode (any text), error correction level M, versions 1 to 10 (up to 213 characters) — plenty for a link. Plain steps, as in the
// QR standard (ISO 18004): 1 pick the smallest version that fits, 2 make the data bytes, 3 add error-correction bytes (Reed-Solomon),
// 4 place them in the grid around the fixed patterns, 5 try the 8 masks and keep the one with the lowest penalty, 6 add the format bits.

// Per version (1..10), level M: [data bytes, error-correction bytes per block, blocks of group 1, data bytes per block in group 1, blocks of group 2, data bytes per block in group 2]
const M_TABLE = [
  null,
  [16, 10, 1, 16, 0, 0], [28, 16, 1, 28, 0, 0], [44, 26, 1, 44, 0, 0], [64, 18, 2, 32, 0, 0], [86, 24, 2, 43, 0, 0],
  [108, 16, 4, 27, 0, 0], [124, 18, 4, 31, 0, 0], [154, 22, 2, 38, 2, 39], [182, 22, 3, 36, 2, 37], [216, 26, 4, 43, 1, 44],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// ---- Reed-Solomon over GF(256) ----
const EXP = new Array(512); const LOG = new Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
function rsRemainder(data, ecLength) {
  let gen = [1];
  for (let i = 0; i < ecLength; i++) { const next = new Array(gen.length + 1).fill(0); gen.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); }); gen = next; }
  const rem = new Array(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift(); rem.push(0);
    for (let i = 0; i < ecLength; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

function encodeData(text, version) {
  const capacity = M_TABLE[version][0];
  const bytes = [...new TextEncoder().encode(text)];
  const lengthBits = version <= 9 ? 8 : 16;
  const bits = [];
  const put = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  put(0b0100, 4); put(bytes.length, lengthBits); bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, capacity * 8 - bits.length));                  // terminator
  while (bits.length % 8) bits.push(0);
  const out = []; for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function blocksWithEc(data, version) {
  const [, ecLen, g1, d1, g2, d2] = M_TABLE[version];
  const blocks = []; let at = 0;
  for (let i = 0; i < g1; i++) { blocks.push(data.slice(at, at + d1)); at += d1; }
  for (let i = 0; i < g2; i++) { blocks.push(data.slice(at, at + d2)); at += d2; }
  const ecs = blocks.map((b) => rsRemainder(b, ecLen));
  const out = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

// ---- the grid ----
function withVersionBits(version, grid) {
  if (version < 7) return;
  let rem = version; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  const { size, cells } = grid;
  for (let i = 0; i < 18; i++) { const bit = ((bits >> i) & 1) === 1; const a = size - 11 + (i % 3); const b = Math.floor(i / 3); cells[b][a] = bit; cells[a][b] = bit; }
}

function buildGrid(version) {
  const size = version * 4 + 17;
  const cells = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (r, c, v) => { if (r >= 0 && c >= 0 && r < size && c < size) cells[r][c] = v; };
  const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) set(r0 + r, c0 + c, r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4))); };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const pos = ALIGN[version];
  for (const r of pos) for (const c of pos) {
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue; // would sit on a finder pattern
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  set(size - 8, 8, true);
  for (let i = 0; i < 9; i++) { if (cells[8][i] === null) set(8, i, false); if (cells[i][8] === null) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { if (cells[8][size - 1 - i] === null) set(8, size - 1 - i, false); if (cells[size - 1 - i][8] === null) set(size - 1 - i, 8, false); }
  const grid = { size, cells };
  withVersionBits(version, grid);
  return grid;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function placeData(grid, bytes) {
  const { size, cells } = grid;
  const fixed = cells.map((row) => row.map((v) => v !== null));
  const bits = []; for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  let k = 0; let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // the timing column is skipped
    for (let i = 0; i < size; i++) {
      const r = up ? size - 1 - i : i;
      for (const c of [col, col - 1]) if (!fixed[r][c]) cells[r][c] = k < bits.length ? bits[k++] === 1 : false;
    }
    up = !up;
  }
  return fixed;
}

function formatBits(mask) {
  const data = (0b00 << 3) | mask; // level M = 00
  let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function applyMaskAndFormat(base, fixed, mask) {
  const size = base.length;
  const cells = base.map((row, r) => row.map((v, c) => (fixed[r][c] ? v : v !== MASKS[mask](r, c))));
  const bits = formatBits(mask);
  const bit = (i) => ((bits >> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) cells[i][8] = bit(i);
  cells[7][8] = bit(6); cells[8][8] = bit(7); cells[8][7] = bit(8);
  for (let i = 9; i < 15; i++) cells[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) cells[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) cells[size - 15 + i][8] = bit(i);
  cells[size - 8][8] = true;
  return cells;
}

function penalty(cells) {
  const n = cells.length; let score = 0;
  const runs = (line) => { let s = 0; let run = 1; for (let i = 1; i < n; i++) { if (line[i] === line[i - 1]) run++; else { if (run >= 5) s += run - 2; run = 1; } } if (run >= 5) s += run - 2; return s; };
  for (let i = 0; i < n; i++) { score += runs(cells[i]); score += runs(cells.map((row) => row[i])); }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (cells[r][c] === cells[r][c + 1] && cells[r][c] === cells[r + 1][c] && cells[r][c] === cells[r + 1][c + 1]) score += 3;
  const pattern = [true, false, true, true, true, false, true, false, false, false, false];
  const matches = (get, at) => pattern.every((p, i) => get(at + i) === p) || pattern.every((p, i) => get(at + 10 - i) === p);
  for (let i = 0; i < n; i++) for (let j = 0; j <= n - 11; j++) { if (matches((k) => cells[i][k], j)) score += 40; if (matches((k) => cells[k][i], j)) score += 40; }
  const dark = cells.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

// Returns an array of rows, each an array of booleans (true = dark). Throws if the text is too long for version 10.
export function qrCells(text) {
  const byteCount = new TextEncoder().encode(text).length;
  let version = 1;
  while (version <= 10 && byteCount + (version <= 9 ? 2 : 3) > M_TABLE[version][0]) version++;
  if (version > 10) throw new Error('That text is too long for a QR code here.');
  const grid = buildGrid(version);
  const fixed = placeData(grid, blocksWithEc(encodeData(text, version), version));
  const base = grid.cells;
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const cells = applyMaskAndFormat(base, fixed, mask);
    const score = penalty(cells);
    if (!best || score < best.score) best = { score, cells };
  }
  return best.cells;
}

// An SVG picture of the code (with the 4-cell quiet border the standard asks for), ready to show or print.
export function qrSvg(text, { pixels = 240 } = {}) {
  const cells = qrCells(text);
  const n = cells.length + 8;
  let path = '';
  cells.forEach((row, r) => row.forEach((dark, c) => { if (dark) path += `M${c + 4} ${r + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${pixels}" height="${pixels}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
