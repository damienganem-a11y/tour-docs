// The passport stamps (the guest app): one hand-drawn stamp per destination, each with its own shape, its own ink colour and ONE iconic thing
// of that place (a moai for Easter Island, the terraces of Machu Picchu for Cusco, coral for Port Douglas...). Drawn here as small SVG pictures, no
// image files, so they work offline and stay sharp. Pure text in, text out: the leader's tests can check it.
//
// A stamp = a frame (one of 7 shapes) + the icon + a ribbon with the name + the country above + the date below, all printed in ONE ink colour,
// then roughened (wobbly edges, little gaps where the ink did not take) so it looks pressed by hand and not printed.
// A destination the app has no drawing for gets a compass rose: any trip works.

const PAPER = '#fff'; // the colour of the "cut out" lines inside a shape: the card the stamp sits on

// ---------- the icons ----------
// Each icon is drawn around (0,0), about 104 wide and 88 tall, in the stamp's ink (currentColor). Lines "cut out" of a shape are drawn in PAPER.
const cut = (d, w = 2.4) => `<path d="${d}" fill="none" stroke="${PAPER}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const line = (d, w = 3) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const solid = (d) => `<path d="${d}"/>`;
const waves = (y, from = -50, to = 50) => { let d = `M${from} ${y}`; for (let x = from; x < to; x += 20) d += ` q5 -5 10 0 t10 0`; return line(d, 2.4); };

const moaiBody = `${solid('M-12 -34 L-10 -48 H10 L12 -34Z')}${solid('M-15 42 V0 Q-19 -10 -19 -22 V-32 Q-19 -36 -14 -36 H14 Q19 -36 19 -32 V-22 Q19 -10 15 0 V42Z')}
<rect x="-25" y="-30" width="6" height="27" rx="2.5"/><rect x="19" y="-30" width="6" height="27" rx="2.5"/>
${cut('M-16 -25 H16', 4)}<rect x="-13" y="-22" width="8" height="4.5" rx="2" fill="${PAPER}"/><rect x="5" y="-22" width="8" height="4.5" rx="2" fill="${PAPER}"/>
${cut('M-3.5 -22 V-8 Q0 -4 3.5 -8 V-22', 2.6)}${cut('M-8 0 H8', 2.6)}${cut('M-15 15 Q-7 17 0 27 Q7 17 15 15', 2.6)}`;

// A lotus-bud temple tower (Angkor): stacked tiers narrowing to a point. Centre x, base y, height, width.
const tower = (cx, base, height, width) => {
  let d = ''; const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const w = width * (1 - i * 0.22); const y1 = base - (height * i) / tiers; const y2 = base - (height * (i + 1)) / tiers;
    d += `M${cx - w / 2} ${y1} L${cx - w / 2 + 2} ${y2 + 3} L${cx} ${y2 - 1} L${cx + w / 2 - 2} ${y2 + 3} L${cx + w / 2} ${y1}Z `;
  }
  return `<path d="${d}"/><path d="M${cx} ${base - height - 1} V${base - height - 9}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`;
};

// Coral: a branching staghorn drawn by repeating two angles (same picture every time).
const branch = (x, y, len, angle, depth) => {
  if (depth === 0) return '';
  const x2 = x + Math.sin(angle) * len; const y2 = y - Math.cos(angle) * len;
  return `<path d="M${x.toFixed(1)} ${y.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke-width="${(depth * 1.5 + 0.8).toFixed(1)}"/>`
    + branch(x2, y2, len * 0.74, angle - 0.55, depth - 1) + branch(x2, y2, len * 0.74, angle + 0.5, depth - 1);
};

const ICONS = {
  'easter-island': `<g transform="translate(-36 19) scale(.55)">${moaiBody}</g><g transform="translate(36 19) scale(.55)">${moaiBody}</g>${moaiBody}${line('M-52 42 H52', 3)}`,

  // Cusco: Machu Picchu, the sharp peak above the stepped terraces, one stone house, the sun.
  cusco: `${solid('M-50 30 L-26 -6 L-14 2 L6 -44 L18 -14 L26 -20 L50 30Z')}${cut('M-34 4 Q-28 0 -22 4 M14 -4 Q20 -9 27 -3', 2)}
${solid('M-52 42 V34 H-32 V28 H-12 V22 H14 V28 H34 V34 H52 V42Z')}${cut('M-50 38 H50', 1.8)}${cut('M-30 31 H-14 M16 31 H32', 1.8)}
${cut('M-8 22 V14 L-2 8 L4 14 V22', 2)}<circle cx="-36" cy="-26" r="7"/>${line('M-36 -38 V-35 M-48 -26 H-45 M-47 -37 L-45 -35 M-25 -37 L-27 -35', 2)}`,

  miami: `<path d="M-44 22 A24 24 0 0 1 4 22Z"/>${line('M-20 -6 V-14 M-36 -2 L-42 -8 M-4 -2 L2 -8 M-44 8 L-52 6 M4 8 L12 6', 2.6)}
${solid('M10 42 V6 H16 V-6 H22 V-20 H28 V-6 H34 V6 H40 V42Z')}${cut('M13 14 H37 M13 22 H37 M13 30 H37', 2)}${line('M22 -20 V-28', 2.2)}
${line('M-16 42 Q-20 16 -10 -4', 3.6)}${solid('M-10 -4 q-14 -4 -22 6 q12 -8 22 -2Z M-10 -4 q-6 -16 -22 -14 q14 2 20 12Z M-10 -4 q8 -14 24 -10 q-14 0 -20 12Z M-10 -4 q14 -2 20 10 q-8 -8 -20 -6Z M-10 -4 q-14 2 -16 14 q4 -10 16 -8Z')}${line('M-52 42 H52', 3)}`,

  apia: `${solid('M-44 8 Q-44 -26 0 -34 Q44 -26 44 8Z')}${cut('M-30 6 Q-30 -16 -10 -26 M-14 6 Q-14 -18 0 -28 M2 6 Q2 -18 8 -28 M18 6 Q18 -14 26 -22 M-38 4 H38', 2)}
${solid('M-44 8 H44 V14 H-44Z')}${solid('M-38 14 H-33 V34 H-38Z M-4 14 H1 V34 H-4Z M33 14 H38 V34 H33Z')}${waves(40)}`,

  'port-douglas': `<g stroke="currentColor" stroke-linecap="round" fill="none" transform="translate(-14 0)">${branch(-14, 42, 19, -0.25, 4)}${branch(16, 42, 17, 0.25, 4)}</g>
${solid('M30 42 Q30 24 44 24 Q58 24 58 42Z')}${cut('M36 40 Q38 32 44 30 M46 40 Q48 34 52 34', 1.8)}
${solid('M-6 -30 q10 -12 26 0 q-14 12 -26 0Z M20 -30 l10 -8 v16Z')}${cut('M4 -38 q-2 8 0 16 M12 -38 q-2 8 0 16', 2.2)}<circle cx="-1" cy="-31" r="1.8" fill="${PAPER}"/>
<circle cx="-40" cy="-22" r="3.4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="-31" cy="-34" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="-26" cy="-18" r="2" fill="none" stroke="currentColor" stroke-width="2"/>${line('M-52 42 H52', 3)}`,

  'siem-reap': `${tower(0, 20, 52, 28)}${tower(-26, 22, 34, 20)}${tower(26, 22, 34, 20)}
${solid('M-48 22 H48 V28 H-48Z M-44 28 H44 V34 H-44Z')}${cut('M-30 25 H30', 1.6)}${waves(40, -48, 48)}${line('M-18 46 H18', 2)}`,

  kathmandu: `${solid('M-34 14 A34 34 0 0 1 34 14Z')}${solid('M-12 -18 H12 V-2 H-12Z')}
${cut('M-8 -12 q3 -3 6 0 M2 -12 q3 -3 6 0', 2)}${cut('M0 -9 q-1 3 1 5', 1.8)}${solid('M-7 -22 H7 L5 -26 H-5Z M-5 -26 H5 L3 -30 H-3Z M-3 -30 H3 L1 -34 H-1Z')}
${line('M0 -34 V-44', 2.4)}${solid('M-6 -41 H6 L0 -47Z')}${solid('M-44 14 H44 V20 H-44Z M-40 20 H40 V26 H-40Z')}
${line('M0 -44 L-44 -14 M0 -44 L44 -14 M0 -44 L-30 -4 M0 -44 L30 -4', 1.6)}<path d="M-38 -10 l4 -2 v5Z M-26 -2 l4 -2 v5Z M26 -2 l-4 -2 v5Z M38 -10 l-4 -2 v5Z"/>${waves(38)}`,

  paro: `${solid('M-50 42 L-48 -30 Q-30 -46 -6 -42 Q20 -46 38 -36 Q50 -30 50 -16 V42Z')}
<g fill="${PAPER}"><rect x="-26" y="-12" width="14" height="10"/><rect x="-8" y="-4" width="16" height="10"/><rect x="12" y="2" width="14" height="10"/><rect x="-14" y="14" width="12" height="9"/></g>
<g stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" fill="currentColor"><path d="M-29 -12 L-19 -22 L-9 -12Z"/><path d="M-11 -4 L0 -14 L11 -4Z"/><path d="M9 2 L19 -7 L29 2Z"/><path d="M-17 14 L-8 6 L1 14Z"/></g>
${cut('M-44 -20 Q-40 0 -42 30 M30 -30 Q36 -10 32 14', 2)}${line('M-50 30 H50', 0)}${line('M-46 -16 L44 -30', 1.4)}<path d="M-30 -20 l5 -1 v5Z M-12 -23 l5 -1 v5Z M6 -26 l5 -1 v5Z M24 -28 l5 -1 v5Z" fill="${PAPER}"/>`,

  agra: `${solid('M-18 18 V2 Q-18 -20 0 -34 Q18 -20 18 2 V18Z')}${line('M0 -34 V-44', 2.4)}${solid('M-3 -42 q3 -6 6 0Z')}
${solid('M-34 18 V-4 Q-34 -12 -28 -12 Q-22 -12 -22 -4 V18Z M22 18 V-4 Q22 -12 28 -12 Q34 -12 34 -4 V18Z')}
${solid('M-46 18 V-18 H-40 V18Z M40 18 V-18 H46 V18Z')}${solid('M-47 -18 a4 5 0 0 1 8 0Z M39 -18 a4 5 0 0 1 8 0Z')}
${cut('M-6 18 V6 Q0 -4 6 6 V18', 2)}${solid('M-52 18 H52 V24 H-52Z')}${cut('M-30 38 H30 M-22 44 H22', 2.4)}${line('M-20 30 H20', 2)}`,

  serengeti: `${solid('M-40 -22 Q-20 -36 0 -30 Q20 -36 42 -22 Q20 -22 0 -22 Q-20 -22 -40 -22Z')}${line('M2 -22 V-8 M2 -14 L-8 -22', 3.2)}
<circle cx="-34" cy="-34" r="5"/>${solid('M-8 12 Q-8 -4 12 -4 Q34 -4 40 10 Q42 14 40 18 V34 H33 V22 H26 V34 H19 V22 H4 V34 H-3 V24 H-8 V34 H-14 V12Z')}
${solid('M-8 12 Q-26 6 -28 20 Q-28 30 -34 34 H-26 Q-22 28 -22 22 Q-16 22 -14 14Z')}${cut('M-30 28 L-22 20', 0)}${cut('M-18 10 Q-16 4 -10 6', 2)}<circle cx="2" cy="4" r="0"/>${line('M-52 42 H52', 3)}`,

  petra: `${solid('M-52 42 V-40 L-40 -34 L-34 -42 L-30 -10 L-30 42Z M52 42 V-40 L40 -34 L34 -42 L30 -10 L30 42Z')}
${solid('M-24 42 V4 H24 V42Z')}${solid('M-24 4 L0 -6 L24 4Z')}${solid('M-12 4 V-14 A12 12 0 0 1 12 -14 V4Z M-5 -26 H5 V-34 Q0 -40 -5 -34Z')}
${cut('M-16 12 V42 M-8 12 V42 M8 12 V42 M16 12 V42', 2)}${cut('M-5 42 V26 Q0 20 5 26 V42', 2.2)}${cut('M-6 -10 V0 H6 V-10Q0 -16 -6 -10', 2)}${cut('M-18 4 L0 -3 L18 4', 2)}${line('M-52 42 H52', 3)}`,

  marrakech: `${solid('M-44 42 V-6 Q-44 -34 0 -34 Q44 -34 44 -6 V42 H36 V-4 Q36 -26 0 -26 Q-36 -26 -36 -4 V42Z')}
${solid('M-12 42 V-12 H12 V42Z')}${solid('M-8 -12 H8 V-20 H-8Z')}${solid('M-4 -20 H4 V-26 H-4Z')}${line('M0 -26 V-38', 2.4)}<circle cx="0" cy="-41" r="3.4"/>
${cut('M-7 -4 q7 -10 14 0 M-7 12 q7 -10 14 0 M-7 28 q7 -10 14 0', 2.2)}${cut('M-12 -7 H12', 1.8)}`,

  lisbon: `${solid('M-40 -12 Q-40 -20 -32 -20 H32 Q40 -20 40 -12 V22 H-40Z')}${cut('M-34 -6 H34', 2)}
<rect x="-34" y="-14" width="14" height="14" rx="2" fill="${PAPER}"/><rect x="-14" y="-14" width="14" height="14" rx="2" fill="${PAPER}"/><rect x="6" y="-14" width="14" height="14" rx="2" fill="${PAPER}"/><rect x="26" y="-14" width="8" height="14" rx="2" fill="${PAPER}"/>
${solid('M-40 22 H40 V28 H-40Z')}<circle cx="-24" cy="32" r="6"/><circle cx="24" cy="32" r="6"/><circle cx="-24" cy="32" r="2" fill="${PAPER}"/><circle cx="24" cy="32" r="2" fill="${PAPER}"/>
${line('M0 -20 L-10 -30 M0 -20 L10 -30 M-26 -38 H26 M0 -30 V-38', 2.4)}${line('M-52 40 H52', 2.4)}${cut('M-40 14 H40', 2)}`,

  istanbul: `${solid('M-20 20 V4 Q-20 -20 0 -24 Q20 -20 20 4 V20Z')}${solid('M-34 20 V8 Q-34 -6 -22 -6 V20Z M34 20 V8 Q34 -6 22 -6 V20Z')}${line('M0 -24 V-32', 2.4)}<path d="M-4 -32 a4 4 0 1 0 4 4 a3 3 0 1 1 -4 -4Z" transform="translate(4 -2)"/>
${solid('M-48 20 V-30 L-45 -42 L-42 -30 V20Z M42 20 V-30 L45 -42 L48 -30 V20Z')}${solid('M-47 -14 H-43 V-10 H-47Z M43 -14 H47 V-10 H43Z')}
${solid('M-52 20 H52 V28 H-52Z')}${cut('M-8 20 V8 Q0 -2 8 8 V20 M-14 6 H14', 2.2)}${waves(38)}${line('M-44 -22 q4 -4 8 0 q4 -4 8 0', 1.8)}`,

  kyoto: `${line('M-48 -26 Q0 -20 48 -26', 5.4)}${solid('M-52 -32 Q0 -24 52 -32 L50 -26 Q0 -18 -50 -26Z')}${line('M-38 -14 H38', 4)}
${solid('M-34 -22 H-24 V42 H-34Z M24 -22 H34 V42 H24Z')}${solid('M-6 -20 H6 V-12 H-6Z')}
<g opacity="1">${solid('M-18 6 H-14 V42 H-18Z M14 6 H18 V42 H14Z')}${line('M-22 6 H22', 3)}${line('M-20 14 H20', 2)}</g>${line('M-52 42 H52', 3)}`,

  maldives: `${solid('M-44 -4 L-26 -22 L-8 -4Z M-30 -4 H-22 V10 H-30Z')}${solid('M6 -4 L24 -22 L42 -4Z M20 -4 H28 V10 H20Z')}
${solid('M-48 10 H48 V15 H-48Z')}${solid('M-40 15 H-36 V30 H-40Z M-14 15 H-10 V30 H-14Z M12 15 H16 V30 H12Z M36 15 H40 V30 H36Z')}
${waves(36)}${waves(44, -40, 40)}${line('M-14 10 Q-8 -8 -2 -30', 3)}${solid('M-2 -30 q8 -10 20 -6 q-12 0 -18 8Z M-2 -30 q-8 -10 -20 -6 q12 0 18 8Z M-2 -30 q4 -12 14 -14 q-8 6 -12 16Z')}<circle cx="36" cy="-32" r="6"/>`,

  kigali: `${solid('M-24 -16 Q-24 -42 0 -42 Q24 -42 24 -16 V12 Q24 30 0 32 Q-24 30 -24 12Z')}${solid('M-8 -44 Q0 -52 8 -44Z')}
${solid('M-48 42 Q-48 24 -28 20 H28 Q48 24 48 42Z')}
${cut('M-19 -18 H19', 4.4)}<circle cx="-9" cy="-9" r="3.2" fill="${PAPER}"/><circle cx="9" cy="-9" r="3.2" fill="${PAPER}"/>${cut('M-5 -4 Q0 2 5 -4 M-10 16 Q0 22 10 16', 2.6)}<ellipse cx="-3.4" cy="2" rx="1.6" ry="2.4" fill="${PAPER}"/><ellipse cx="3.4" cy="2" rx="1.6" ry="2.4" fill="${PAPER}"/>`,

  'cape-town': `${solid('M-52 42 V14 Q-46 -2 -38 6 L-32 12 L-30 -18 H36 L44 12 L52 16 V42Z')}${cut('M-20 14 H30 M-24 26 H34', 2)}
<g fill="${PAPER}" stroke="currentColor" stroke-width="2.4"><circle cx="-18" cy="-22" r="8"/><circle cx="-4" cy="-28" r="10"/><circle cx="12" cy="-26" r="9"/><circle cx="26" cy="-21" r="7"/><path d="M-26 -18 H34 V-12 Q26 -8 18 -12 Q8 -6 0 -12 Q-10 -6 -18 -12 Q-24 -10 -26 -14Z" stroke="none"/></g>
${waves(46, -40, 40)}`,

  seychelles: `${line('M-8 10 Q-16 -16 -6 -34', 3.6)}${solid('M-6 -34 q10 -10 24 -6 q-14 0 -20 8Z M-6 -34 q-10 -10 -24 -6 q14 0 20 8Z M-6 -34 q2 -12 14 -16 q-8 8 -10 18Z M-6 -34 q-4 -10 -18 -12 q10 4 14 14Z')}
${solid('M-36 42 Q-52 38 -48 24 Q-44 12 -28 14 Q-14 16 -16 42Z')}${solid('M-18 42 Q-24 20 -4 12 Q20 6 26 24 Q30 36 26 42Z')}${solid('M20 42 Q18 28 32 24 Q48 22 50 42Z')}
${cut('M-40 40 Q-32 28 -18 40 M0 14 Q4 26 -2 40 M30 40 Q36 30 46 36', 2)}${waves(46, -50, 50)}<ellipse cx="38" cy="-26" rx="6" ry="7"/>${cut('M38 -33 V-19', 1.6)}`,

  // For any other place: a compass rose.
  compass: `<circle cx="0" cy="0" r="36" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="0" cy="0" r="30" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 4"/>
${solid('M0 -42 L8 0 L0 42 L-8 0Z')}${solid('M-42 0 L0 -8 L42 0 L0 8Z')}${cut('M0 -34 V34 M-34 0 H34', 1.6)}<circle r="6" fill="${PAPER}"/><circle r="3"/>`,
};
ICONS.marrakech2 = ICONS.marrakech;

// Which drawing, ink and frame each place has. Matched on the destination's name (lower case, first words), so "Marrakech farewell" still finds Marrakech.
const LOOKS = [
  { key: 'easter-island', words: ['easter island', 'rapa nui'], ink: '#a8442a', frame: 'arch' },
  { key: 'cusco', words: ['cusco', 'cuzco', 'machu picchu'], ink: '#2f7a52', frame: 'octagon' },
  { key: 'miami', words: ['miami'], ink: '#d6336c', frame: 'ticket' },
  { key: 'apia', words: ['apia', 'samoa'], ink: '#1b8ca6', frame: 'scallop' },
  { key: 'port-douglas', words: ['port douglas', 'cairns', 'great barrier'], ink: '#e2562a', frame: 'circle' },
  { key: 'siem-reap', words: ['siem reap', 'angkor'], ink: '#8a5a24', frame: 'octagon' },
  { key: 'kathmandu', words: ['kathmandu'], ink: '#b3261e', frame: 'postage' },
  { key: 'paro', words: ['paro', 'thimphu', 'bhutan'], ink: '#7a3b8f', frame: 'arch' },
  { key: 'agra', words: ['agra', 'taj'], ink: '#c0396b', frame: 'chamfer' },
  { key: 'serengeti', words: ['serengeti', 'masai', 'maasai'], ink: '#b8651b', frame: 'circle' },
  { key: 'petra', words: ['petra'], ink: '#b04a2c', frame: 'arch' },
  { key: 'marrakech', words: ['marrakech', 'marrakesh'], ink: '#a3292e', frame: 'chamfer' },
  { key: 'lisbon', words: ['lisbon', 'lisboa'], ink: '#d99a0b', frame: 'ticket' },
  { key: 'istanbul', words: ['istanbul'], ink: '#1d5f9e', frame: 'scallop' },
  { key: 'kyoto', words: ['kyoto'], ink: '#cf2e2e', frame: 'postage' },
  { key: 'maldives', words: ['maldives', 'male'], ink: '#0f8f8a', frame: 'circle' },
  { key: 'kigali', words: ['kigali', 'rwanda'], ink: '#46603a', frame: 'octagon' },
  { key: 'cape-town', words: ['cape town'], ink: '#2b5aa6', frame: 'postage' },
  { key: 'seychelles', words: ['seychelles'], ink: '#d1568a', frame: 'scallop' },
];
const FALLBACK_INKS = ['#e4572e', '#23805f', '#2d6cdf', '#8a4fb0', '#1f8a8a', '#c0392b'];
const FRAMES_FALLBACK = ['circle', 'postage', 'octagon', 'arch', 'ticket', 'chamfer', 'scallop'];

function hashOf(text) { let n = 0; for (const ch of String(text)) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return n; }
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function lookOf(name) {
  const n = String(name).toLowerCase();
  const found = LOOKS.find((l) => l.words.some((w) => n.startsWith(w) || n.includes(w)));
  if (found) return found;
  const h = hashOf(name);
  return { key: 'compass', ink: FALLBACK_INKS[h % FALLBACK_INKS.length], frame: FRAMES_FALLBACK[h % FRAMES_FALLBACK.length] };
}
export const STAMP_KEYS = LOOKS.map((l) => l.key);

// ---------- the frames: [outer shape, ribbon x range, date line y] ----------
const FRAMES = {
  circle: { shape: '<circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="100" cy="100" r="84" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 5"/>', ribbon: [26, 174], date: 175 },
  scallop: { shape: `<g>${Array.from({ length: 30 }, (_, i) => { const a = (i / 30) * Math.PI * 2; return `<circle cx="${(100 + 90 * Math.cos(a)).toFixed(1)}" cy="${(100 + 90 * Math.sin(a)).toFixed(1)}" r="6.5"/>`; }).join('')}</g><circle cx="100" cy="100" r="84" fill="none" stroke="currentColor" stroke-width="3"/>`, ribbon: [24, 176], date: 175 },
  postage: { shape: '<rect x="7" y="7" width="186" height="186" rx="6" fill="none" stroke="currentColor" stroke-width="7" stroke-dasharray="1 8.5" stroke-linecap="round"/><rect x="18" y="18" width="164" height="164" rx="4" fill="none" stroke="currentColor" stroke-width="4"/><rect x="25" y="25" width="150" height="150" fill="none" stroke="currentColor" stroke-width="1.4"/>', ribbon: [20, 180], date: 169 },
  octagon: { shape: '<polygon points="64,8 136,8 192,64 192,136 136,192 64,192 8,136 8,64" fill="none" stroke="currentColor" stroke-width="5"/><polygon points="68,17 132,17 183,68 183,132 132,183 68,183 17,132 17,68" fill="none" stroke="currentColor" stroke-width="1.6"/>', ribbon: [26, 174], date: 176 },
  arch: { shape: '<path d="M12 192 V92 A88 88 0 0 1 188 92 V192 Z" fill="none" stroke="currentColor" stroke-width="5"/><path d="M22 184 V92 A78 78 0 0 1 178 92 V184 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 5"/>', ribbon: [18, 182], date: 175 },
  ticket: { shape: '<path d="M10 22 H190 V88 A12 12 0 0 0 190 112 V178 H10 V112 A12 12 0 0 0 10 88 Z" fill="none" stroke="currentColor" stroke-width="5"/><path d="M20 30 H180 V170 H20Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 5"/>', ribbon: [20, 180], date: 169 },
  chamfer: { shape: '<polygon points="30,8 170,8 192,30 192,170 170,192 30,192 8,170 8,30" fill="none" stroke="currentColor" stroke-width="5"/><polygon points="34,18 166,18 182,34 182,166 166,182 34,182 18,166 18,34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="4 4"/>', ribbon: [20, 180], date: 175 },
};

// The stamp as an SVG picture. `dateText` is shown as given ("29 AUG 2027"). `id` keeps the filters of several stamps on one page apart.
export function stampSvg(destination, dateText, id) {
  const look = lookOf(destination.name);
  const frame = FRAMES[look.frame];
  const h = hashOf(destination.name);
  const tilt = (h % 13) - 6;
  const name = destination.name.toUpperCase();
  const country = (destination.country || '').toUpperCase();
  const [r0, r1] = frame.ribbon;
  const nameSize = Math.max(10, Math.min(21, (r1 - r0 - 40) / (name.length * 0.74)));
  const ribbon = `M${r0} 131 H${r1} L${r1 - 9} 144 L${r1} 157 H${r0} L${r0 + 9} 144Z`;
  const seed = (h % 90) + 2;
  return `<svg viewBox="0 0 200 200" width="100%" height="100%" role="img" aria-label="Stamp: ${esc(destination.name)}" style="transform: rotate(${tilt}deg); color: ${look.ink}">
<defs><filter id="ink-${id}" x="-4%" y="-4%" width="108%" height="108%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="${seed}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" result="d"/><feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="${seed + 7}" result="g"/><feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -9 6.4" result="wear"/><feComposite in="d" in2="wear" operator="in"/></filter></defs>
<g filter="url(#ink-${id})" fill="currentColor">
${frame.shape}
<text x="100" y="37" text-anchor="middle" font-family="Outfit, Inter, sans-serif" font-weight="800" font-size="${Math.min(11, 120 / Math.max(country.length, 1) / 0.78).toFixed(1)}" letter-spacing="2.4">${esc(country)}</text>
<g transform="translate(100 87) scale(.9)">${ICONS[look.key] ?? ICONS.compass}</g>
<path d="${ribbon}"/>
<text x="100" y="${(144 + nameSize * 0.36).toFixed(1)}" text-anchor="middle" font-family="Outfit, Inter, sans-serif" font-weight="800" font-size="${nameSize.toFixed(1)}" letter-spacing="1.2" fill="${PAPER}">${esc(name)}</text>
<text x="100" y="${frame.date}" text-anchor="middle" font-family="Outfit, Inter, sans-serif" font-weight="700" font-size="11" letter-spacing="2">${esc(dateText)}</text>
</g></svg>`;
}
