// Passport Explorer, the drawn themes (SPEC.md, stage 3): one repeating background pattern and one illustrated scene per destination, referenced BY NAME from
// the trip file (explorer.theme.pattern / explorer.scene). Drawn in code (SVG strings), no pictures to download, so it all works offline.
// PORTED from the owner's prototype (tools/reference/jet-set-explorer-prototype.html): the drawings are the prototype's own, only moved here and
// exported. Kathmandu and the Washington wrap-up are new, drawn in the same style. An unknown name gives no pattern / no scene (the page keeps its plain colors).

const PAT = {
  peru:`<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><rect width='48' height='48' fill='#9e2b22'/><rect width='48' height='6' fill='#c0392b'/><path d='M0 12L6 6L12 12L18 6L24 12L30 6L36 12L42 6L48 12' fill='none' stroke='#e9a800' stroke-width='2'/><path d='M12 30L24 18L36 30L24 42Z' fill='#e9a800'/><path d='M18 30L24 24L30 30L24 36Z' fill='#1f7a76'/><path d='M0 30L6 24L12 30L6 36Z M36 30L42 24L48 30L42 36Z' fill='#c0392b'/><rect y='44' width='48' height='4' fill='#1f7a76'/></svg>`,
  easter:`<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><rect width='60' height='60' fill='#1c3441'/><path d='M0 20 Q15 10 30 20 T60 20' fill='none' stroke='#2c5566' stroke-width='3'/><path d='M0 45 Q15 35 30 45 T60 45' fill='none' stroke='#244a5a' stroke-width='3'/><path d='M38 58 V47 Q38 40 41 39 H45 Q48 40 48 47 V58Z' fill='#2f5262'/><circle cx='12' cy='32' r='2.5' fill='#c4512b'/></svg>`,
  samoa:`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='#4e3121'/><path d='M0 0L10 10L20 0L30 10L40 0 M0 40L10 30L20 40L30 30L40 40' fill='none' stroke='#e9d3b0' stroke-width='2'/><path d='M20 12L28 20L20 28L12 20Z' fill='#e9d3b0'/><path d='M20 16L24 20L20 24L16 20Z' fill='#8a4b2a'/><circle cx='4' cy='20' r='2' fill='#e9d3b0'/><circle cx='36' cy='20' r='2' fill='#e9d3b0'/></svg>`,
  reef:`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='#0d6a82'/><circle cx='12' cy='14' r='4' fill='none' stroke='#5cc6d6' stroke-width='1.5' opacity='.6'/><circle cx='20' cy='6' r='2' fill='none' stroke='#5cc6d6' stroke-width='1.2' opacity='.6'/><path d='M0 44 Q16 36 32 44 T64 44' fill='none' stroke='#1a8aa1' stroke-width='3'/><path d='M40 22 q6 -5 12 0 q-6 5 -12 0Z M52 22 l4 -3 v6z' fill='#f2876f' opacity='.85'/></svg>`,
  angkor:`<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56'><rect width='56' height='56' fill='#6e5236'/><g fill='none' stroke='#8d6c49' stroke-width='2'><circle cx='28' cy='28' r='10'/><path d='M28 18 Q34 28 28 38 Q22 28 28 18Z'/><path d='M18 28 Q28 34 38 28 Q28 22 18 28Z'/></g><g fill='#8d6c49'><circle cx='0' cy='0' r='4'/><circle cx='56' cy='0' r='4'/><circle cx='0' cy='56' r='4'/><circle cx='56' cy='56' r='4'/></g></svg>`,
  bhutan:`<svg xmlns='http://www.w3.org/2000/svg' width='60' height='44'><rect width='60' height='44' fill='#5c1820'/><path d='M0 6 Q30 14 60 6' stroke='#d9b98a' fill='none'/><rect x='5' y='8' width='8' height='10' fill='#2f6db5'/><rect x='17' y='10' width='8' height='10' fill='#f4efe6'/><rect x='29' y='10' width='8' height='10' fill='#c8332b'/><rect x='41' y='9' width='8' height='10' fill='#2e8b57'/><rect x='53' y='7' width='7' height='10' fill='#e9b40c'/><path d='M0 36L5 31L10 36L15 31L20 36L25 31L30 36L35 31L40 36L45 31L50 36L55 31L60 36' fill='none' stroke='#e58a00' stroke-width='2'/></svg>`,
  agra:`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='#8a3a2b'/><g fill='#f4ede2'><rect x='12' y='12' width='16' height='16'/><rect x='12' y='12' width='16' height='16' transform='rotate(45 20 20)'/></g><circle cx='20' cy='20' r='4' fill='#1f6f5f'/><path d='M0 0H40V40H0Z' fill='none' stroke='#a54a38' stroke-width='2'/></svg>`,
  serengeti:(() => { let s = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='24'><rect width='48' height='24' fill='#2b1d14'/>`;
    for (let i = 0; i < 6; i++) { const x = i * 8 + 1;
      s += `<rect x='${x}' y='2' width='6' height='5' fill='#c8332b'/><rect x='${x}' y='9' width='6' height='5' fill='${i % 2 ? '#2f6db5' : '#f4efe6'}'/><rect x='${x}' y='16' width='6' height='5' fill='${i % 2 ? '#e58a00' : '#2e8b57'}'/>`; }
    return s + '</svg>'; })(),
  petra:`<svg xmlns='http://www.w3.org/2000/svg' width='80' height='40'><rect width='80' height='40' fill='#8e3f36'/><path d='M0 10 Q20 4 40 10 T80 10 V18 Q60 24 40 18 T0 18Z' fill='#a8524a'/><path d='M0 26 Q20 20 40 26 T80 26 V32 Q60 38 40 32 T0 32Z' fill='#b9664f'/><path d='M0 36 Q20 33 40 36 T80 36' stroke='#d78d6c' fill='none' stroke-width='1.5'/></svg>`,
  morocco:`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='#1f4a86'/><g fill='#f7eadd'><rect x='11' y='11' width='18' height='18'/><rect x='11' y='11' width='18' height='18' transform='rotate(45 20 20)'/></g><circle cx='20' cy='20' r='4' fill='#e9a800'/><path d='M0 0L6 0L0 6Z M40 0L34 0L40 6Z M0 40L6 40L0 34Z M40 40L34 40L40 34Z' fill='#c8704b'/></svg>`
};

let uidN = 0; const uid = () => 'u' + (++uidN);
const stp = (o, c) => `<stop offset="${o}" stop-color="${c}"/>`;
function palm(x, y, s, frond, trunk){
  frond = frond || '#4f3431'; trunk = trunk || frond;
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${frond}"><path d="M0 0 Q-4 -34 4 -64" stroke="${trunk}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M4 -64 Q-20 -72 -36 -58 Q-18 -66 4 -61Z"/><path d="M4 -64 Q28 -76 44 -62 Q24 -68 4 -60Z"/><path d="M4 -64 Q-6 -88 2 -98 Q4 -82 7 -64Z"/>
    <path d="M4 -64 Q20 -52 24 -36 Q14 -50 3 -61Z"/><path d="M4 -64 Q-12 -52 -18 -38 Q-8 -52 5 -61Z"/></g>`;
}
const bud = (x, top, base, w, f) => `<path d="M${x - w} ${base} L${x - w} ${base - 8} Q${x - w} ${top + (base - top) * 0.35} ${x} ${top} Q${x + w} ${top + (base - top) * 0.35} ${x + w} ${base - 8} L${x + w} ${base}Z" fill="${f}"/>`;
const acacia = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" fill="#3c2a1c"><path d="M-2 0 L-1 -34 L-14 -48 M1 -34 L12 -46" stroke="#3c2a1c" stroke-width="3" fill="none"/><ellipse cx="0" cy="-52" rx="40" ry="8"/><ellipse cx="-10" cy="-57" rx="22" ry="6"/></g>`;
const giraffeSil = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="#3c2a1c" stroke-width="3" fill="#3c2a1c"><line x1="-8" y1="0" x2="-8" y2="-22"/><line x1="8" y1="0" x2="8" y2="-22"/><ellipse cx="0" cy="-26" rx="12" ry="6" stroke="none"/><line x1="8" y1="-28" x2="16" y2="-54" stroke-width="5"/><ellipse cx="19" cy="-55" rx="5" ry="3" stroke="none"/></g>`;
const pine = (x, y, h) => `<path d="M${x} ${y - h} L${x + h * 0.3} ${y} L${x - h * 0.3} ${y}Z" fill="#2f4a37"/>`;

function scene(kind){
  const u = uid();
  const wrap = (sky, body) => `<svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1">${sky}</linearGradient><linearGradient id="f${u}" x1="0" y1="0" x2="0" y2="1">${stp(.48, '#fff').replace('/>', ' stop-opacity="0"/>')}${stp(1, '#fff')}</linearGradient></defs><rect width="400" height="260" fill="url(#s${u})"/>${body}<rect class="fade" width="400" height="260" fill="url(#f${u})"/></svg>`;
  switch (kind) {
    case 'peru': return wrap(stp(0,'#8ea7cf') + stp(.52,'#eeb8a2') + stp(1,'#fbe3c4'), `
      <circle cx="318" cy="110" r="24" fill="#fff4dc" opacity=".9"/>
      <path d="M0 160 L38 128 L70 146 L118 96 L156 136 L196 108 L236 140 L282 112 L330 146 L372 120 L400 132 V260 H0Z" fill="#a6b1c9"/>
      <path d="M0 182 C40 168 80 160 120 166 C150 170 170 150 200 156 C240 164 260 176 400 170 V260 H0Z" fill="#93a891"/>
      <path d="M236 214 C246 160 256 104 276 90 C294 102 304 160 322 214Z" fill="#4e7a55"/>
      <ellipse cx="200" cy="170" rx="200" ry="9" fill="#fff" opacity=".4"/>
      <path d="M0 212 C70 194 130 186 190 194 C240 200 290 210 400 212 V260 H0Z" fill="#6f9a62"/>
      <g fill="none" stroke="#8ab478" stroke-width="2"><path d="M0 222 C70 204 130 196 190 204 C240 210 290 220 400 222"/><path d="M0 232 C70 214 130 206 190 214 C240 220 290 230 400 232"/></g>
      <g fill="#ddd5c6"><rect x="128" y="186" width="12" height="9"/><rect x="144" y="182" width="16" height="12"/><rect x="164" y="187" width="10" height="8"/><rect x="178" y="184" width="14" height="10"/><rect x="196" y="189" width="9" height="7"/></g>
      <g fill="#8a6f57"><path d="M127 186 L134 180 L141 186Z"/><path d="M143 182 L152 175 L161 182Z"/><path d="M177 184 L185 178 L193 184Z"/></g>`);
    case 'easter': {
      let moai = '';
      for (let i = 0; i < 7; i++) { const x = 122 + i * 31, h = 44 + (i % 3) * 4;
        moai += `<g transform="translate(${x} ${186 - h})"><path d="M0 ${h} V${h * 0.45} Q0 0 5 0 H15 Q20 0 20 ${h * 0.45} V${h}Z" fill="#433d38"/><rect x="2" y="${h * 0.22}" width="16" height="3" fill="#2e2a26"/><path d="M10 ${h * 0.25} L13 ${h * 0.5} L7 ${h * 0.5}Z" fill="#2e2a26"/>${i === 1 || i === 4 ? '<rect x="3" y="-6" width="14" height="7" rx="3" fill="#a5452a"/>' : ''}</g>`; }
      return wrap(stp(0,'#5a6fa8') + stp(.5,'#f0a07a') + stp(1,'#ffd9a8'), `
      <circle cx="80" cy="148" r="24" fill="#ffe2b0"/>
      <rect y="150" width="400" height="50" fill="#3d6f95"/><rect x="50" y="153" width="60" height="3" fill="#ffd9a8" opacity=".6"/><rect x="62" y="160" width="36" height="2" fill="#ffd9a8" opacity=".5"/>
      <path d="M0 178 Q120 160 240 168 T400 172 V260 H0Z" fill="#6f8f4f"/>
      <rect x="112" y="186" width="230" height="12" rx="2" fill="#6b6157"/>${moai}
      <path d="M0 220 Q200 200 400 222 V260 H0Z" fill="#5d7a41"/>`); }
    case 'samoa': {
      let posts = ''; for (let x = 158; x <= 252; x += 15.5) posts += `<rect x="${x}" y="160" width="4" height="36" fill="#6b4a2e"/>`;
      return wrap(stp(0,'#6cc6ea') + stp(1,'#e4f6f7'), `
      <rect y="140" width="400" height="60" fill="#38bfc4"/><rect y="140" width="400" height="5" fill="#ffffff" opacity=".55"/>
      <path d="M0 190 Q200 176 400 192 V260 H0Z" fill="#f3e3c3"/>
      ${posts}<rect x="150" y="194" width="110" height="8" fill="#8a6a4a"/>
      <path d="M140 166 Q205 106 270 166Z" fill="#8b6b45"/><g fill="none" stroke="#a5865c" stroke-width="2"><path d="M150 160 Q205 112 260 160"/><path d="M162 152 Q205 118 248 152"/></g>
      ${palm(70, 202, 1.15, '#2f5d3a', '#7a5a44')}${palm(334, 200, 1, '#2f5d3a', '#7a5a44')}
      <circle cx="112" cy="214" r="6" fill="#e0503c"/><circle cx="120" cy="220" r="4" fill="#f2b33d"/>`); }
    case 'reef': return wrap(stp(0,'#6fd6e4') + stp(1,'#0b5a78'), `
      <g fill="#ffffff" opacity=".12"><path d="M60 0 L100 0 L40 200 L20 200Z"/><path d="M180 0 L210 0 L170 220 L150 220Z"/><path d="M300 0 L340 0 L320 200 L290 200Z"/></g>
      <g transform="translate(120 92)" fill="#3f6e5a"><ellipse rx="26" ry="16"/><circle cx="29" cy="-3" r="7"/><ellipse cx="2" cy="-17" rx="14" ry="5" transform="rotate(-25)"/><ellipse cx="2" cy="17" rx="14" ry="5" transform="rotate(25)"/><path d="M-6 -6 L6 -6 L10 4 L-10 4Z" fill="#567f5f"/></g>
      <g transform="translate(250 130)"><ellipse rx="12" ry="7" fill="#f26b1d"/><rect x="-3" y="-7" width="4" height="14" fill="#fff"/><path d="M-11 0 L-19 -6 L-19 6Z" fill="#f26b1d"/></g>
      <g transform="translate(286 112) scale(.8)"><ellipse rx="12" ry="7" fill="#f26b1d"/><rect x="-3" y="-7" width="4" height="14" fill="#fff"/><path d="M-11 0 L-19 -6 L-19 6Z" fill="#f26b1d"/></g>
      <g fill="none" stroke="#bfeff5" stroke-width="1.5" opacity=".7"><circle cx="210" cy="60" r="4"/><circle cx="218" cy="44" r="3"/><circle cx="212" cy="30" r="2"/></g>
      <path d="M0 210 Q200 196 400 214 V260 H0Z" fill="#e9d6a8"/>
      <g stroke="#f4876f" stroke-width="6" stroke-linecap="round" fill="none"><path d="M60 214 V180 M60 196 L44 178 M60 190 L76 170"/></g>
      <ellipse cx="150" cy="212" rx="26" ry="16" fill="#e8b56b"/><path d="M130 210 q6 -8 12 0 t12 0 t12 0" stroke="#c98f44" stroke-width="2" fill="none"/>
      <path d="M300 214 Q290 160 330 150 Q360 170 340 214Z" fill="#b06ab3" opacity=".9"/>
      <g fill="#7b5fc7"><rect x="220" y="190" width="8" height="24" rx="4"/><rect x="232" y="182" width="8" height="32" rx="4"/><rect x="244" y="194" width="8" height="20" rx="4"/></g>`);
    case 'angkor': {
      const temple = `<g fill="#3b2e3a"><rect x="70" y="160" width="260" height="26"/><rect x="100" y="146" width="200" height="16"/></g>${bud(200,72,150,16,'#3b2e3a')}${bud(150,100,150,12,'#3b2e3a')}${bud(250,100,150,12,'#3b2e3a')}${bud(110,118,160,10,'#3b2e3a')}${bud(290,118,160,10,'#3b2e3a')}`;
      return wrap(stp(0,'#9f8fc2') + stp(.5,'#f6b98a') + stp(1,'#f9dfb9'), `
      <circle cx="200" cy="112" r="20" fill="#fff0c9"/>${temple}
      <rect y="186" width="400" height="74" fill="#d9a08a"/>
      <g transform="translate(0 372) scale(1 -1)" opacity=".28">${temple}</g>
      <g fill="#5b8a5a"><ellipse cx="60" cy="236" rx="16" ry="4"/><ellipse cx="330" cy="244" rx="20" ry="5"/></g>
      ${palm(40, 190, .9, '#2b2228')}${palm(366, 192, .8, '#2b2228')}`); }
    case 'bhutan': {
      let flags = ''; const cols = ['#2f6db5','#f4efe6','#c8332b','#2e8b57','#e9b40c'];
      for (let i = 0; i <= 10; i++) { const t = i / 10, x = 2 * (1 - t) * t * 100 + t * t * 220, y = (1 - t) * (1 - t) * 40 + 2 * (1 - t) * t * 70 + t * t * 46;
        flags += `<rect x="${x.toFixed(1)}" y="${(y + 1).toFixed(1)}" width="12" height="15" fill="${cols[i % 5]}"/>`; }
      return wrap(stp(0,'#8fb8e0') + stp(1,'#eef4f7'), `
      <path d="M0 120 L60 70 L110 110 L170 50 L230 105 L290 60 L350 100 L400 80 V160 H0Z" fill="#dfe8f0"/>
      <path d="M160 58 L170 50 L182 62 L172 66Z M280 68 L290 60 L300 70 L290 72Z" fill="#fff"/>
      <path d="M0 150 Q80 110 160 140 T320 130 T400 140 V260 H0Z" fill="#4f6e55"/>
      <path d="M270 260 L268 150 Q280 96 330 80 L400 70 V260Z" fill="#4d4a45"/>
      <rect x="300" y="106" width="22" height="20" fill="#f6f1e7"/><rect x="300" y="106" width="22" height="4" fill="#8a1f2b"/><path d="M296 106 L311 97 L326 106Z" fill="#d9a531"/>
      <rect x="326" y="94" width="28" height="26" fill="#f6f1e7"/><rect x="326" y="94" width="28" height="4" fill="#8a1f2b"/><path d="M322 94 L340 84 L358 94Z" fill="#d9a531"/>
      <g fill="#3b2a25"><rect x="305" y="114" width="4" height="5"/><rect x="313" y="114" width="4" height="5"/><rect x="332" y="104" width="4" height="6"/><rect x="342" y="104" width="4" height="6"/></g>
      ${pine(30,230,60)}${pine(60,240,50)}${pine(95,236,64)}${pine(130,248,44)}${pine(220,250,48)}
      <path d="M0 40 Q100 70 220 46" fill="none" stroke="#c9b28a" stroke-width="1"/>${flags}`); }
    case 'agra': return wrap(stp(0,'#c7b8d8') + stp(.55,'#f3c4b5') + stp(1,'#fbe6d8'), `
      <circle cx="80" cy="96" r="18" fill="#fff1e2" opacity=".9"/>
      <rect y="186" width="400" height="74" fill="#8fae7a"/>
      <g fill="#fbf8f2"><rect x="110" y="170" width="180" height="16" fill="#f1ebe0"/>
        <rect x="150" y="118" width="100" height="54"/><path d="M168 118 Q166 80 200 64 Q234 80 232 118Z"/>
        <path d="M152 118 Q152 104 160 100 Q168 104 168 118Z"/><path d="M232 118 Q232 104 240 100 Q248 104 248 118Z"/>
        <rect x="112" y="100" width="7" height="72"/><rect x="281" y="100" width="7" height="72"/><rect x="128" y="108" width="6" height="64" fill="#efe8dc"/><rect x="266" y="108" width="6" height="64" fill="#efe8dc"/>
        <path d="M111 100 Q115.5 90 120 100Z"/><path d="M280 100 Q284.5 90 289 100Z"/></g>
      <rect x="172" y="112" width="56" height="8" fill="#f1ebe0"/><line x1="200" y1="64" x2="200" y2="50" stroke="#d4b25e" stroke-width="2"/>
      <path d="M186 172 V140 Q200 122 214 140 V172Z" fill="#e3dacb"/><path d="M158 168 V150 Q164 142 170 150 V168Z M230 168 V150 Q236 142 242 150 V168Z" fill="#e8e0d2"/>
      <path d="M190 186 L210 186 L232 260 L168 260Z" fill="#a9c6d4"/>
      <g fill="#3f6b4a"><ellipse cx="164" cy="204" rx="4" ry="14"/><ellipse cx="236" cy="204" rx="4" ry="14"/><ellipse cx="146" cy="222" rx="5" ry="18"/><ellipse cx="254" cy="222" rx="5" ry="18"/><ellipse cx="122" cy="244" rx="6" ry="22"/><ellipse cx="278" cy="244" rx="6" ry="22"/></g>`);
    case 'serengeti': return wrap(stp(0,'#e9845a') + stp(.45,'#f7b25a') + stp(1,'#fbe0a6'), `
      <circle cx="270" cy="150" r="42" fill="#ffd27a"/>
      <path d="M0 165 Q100 150 200 160 T400 158 V200 H0Z" fill="#c98a4c" opacity=".6"/>
      <rect y="172" width="400" height="88" fill="#d6a14d"/>
      <g stroke="#b9853a" stroke-width="1.5"><path d="M20 200 l3 -8 M40 210 l-2 -9 M90 196 l3 -7 M150 214 l2 -9 M210 204 l-3 -8 M300 216 l2 -9 M350 200 l-2 -8"/></g>
      ${acacia(90,182,1)}${acacia(330,176,.7)}${giraffeSil(190,186,1)}${giraffeSil(222,190,.85)}
      <g fill="#3c2a1c"><ellipse cx="270" cy="198" rx="6" ry="3"/><ellipse cx="284" cy="200" rx="6" ry="3"/><ellipse cx="300" cy="197" rx="6" ry="3"/><ellipse cx="316" cy="201" rx="6" ry="3"/><ellipse cx="258" cy="202" rx="6" ry="3"/></g>`);
    case 'petra': {
      let cols = ''; for (let i = 0; i < 6; i++) cols += `<rect x="${138 + i * 24}" y="138" width="8" height="80" fill="#e6a582"/><rect x="${135 + i * 24}" y="134" width="14" height="5" fill="#e6a582"/>`;
      return wrap(stp(0,'#f3c7a6') + stp(1,'#f8dfc8'), `
      <rect width="400" height="260" fill="#c4705a"/>
      <path d="M0 40 Q100 30 200 44 T400 38 V58 Q300 66 200 56 T0 62Z" fill="#b3604c"/><path d="M0 230 Q120 220 240 232 T400 228 V246 Q300 254 200 244 T0 250Z" fill="#d08a6b"/>
      <rect x="130" y="130" width="140" height="92" fill="#d98e6a"/>${cols}
      <path d="M126 130 L200 104 L274 130Z" fill="#d98e6a"/><path d="M140 125 L200 110 L260 125" stroke="#c97a58" stroke-width="2" fill="none"/>
      <rect x="140" y="60" width="120" height="44" fill="#d98e6a"/><path d="M140 60 L160 50 L160 60Z M260 60 L240 50 L240 60Z" fill="#cf8463"/>
      <rect x="182" y="56" width="36" height="48" fill="#e6a582"/><path d="M180 56 Q200 36 220 56Z" fill="#d98e6a"/><circle cx="200" cy="34" r="5" fill="#d98e6a"/>
      <rect x="188" y="176" width="24" height="46" fill="#5a2a24"/>
      <path d="M0 0 H110 Q90 80 104 140 Q86 200 96 260 H0Z" fill="#7a3830"/><path d="M400 0 H300 Q318 90 300 150 Q316 210 306 260 H400Z" fill="#7a3830"/>
      <path d="M96 222 H306 L330 260 H70Z" fill="#e8c09a"/>`); }
    case 'morocco': {
      let cr = ''; for (let x = 0; x < 400; x += 14) cr += `<rect x="${x}" y="198" width="8" height="8"/>`;
      return wrap(stp(0,'#6c5c9a') + stp(.55,'#e3896b') + stp(1,'#f8cc92'), `
      <circle cx="110" cy="172" r="30" fill="#ffe2ad" opacity=".9"/>
      <path d="M0 190 L50 160 L90 176 L140 140 L190 170 L240 150 L300 178 L350 156 L400 172 V260 H0Z" fill="#b99db5"/>
      <g fill="#f8eff4"><path d="M132 147 L140 140 L148 147 L140 150Z"/><path d="M232 156 L240 150 L248 156 L240 158Z"/><path d="M343 161 L350 156 L357 161 L350 163Z"/></g>
      <rect y="206" width="400" height="54" fill="#c8704b"/><g fill="#c8704b">${cr}</g>
      <rect x="250" y="80" width="36" height="128" fill="#9b5139"/>
      <g fill="#9b5139"><rect x="250" y="73" width="7" height="8"/><rect x="264.5" y="73" width="7" height="8"/><rect x="279" y="73" width="7" height="8"/></g>
      <rect x="259" y="52" width="18" height="24" fill="#9b5139"/><path d="M259 52 Q268 42 277 52Z" fill="#9b5139"/>
      <line x1="268" y1="44" x2="268" y2="25" stroke="#9b5139" stroke-width="2"/>
      <g fill="#e9b949"><circle cx="268" cy="38" r="3.2"/><circle cx="268" cy="31.5" r="2.6"/><circle cx="268" cy="26" r="2"/></g>
      <rect x="250" y="92" width="36" height="3" fill="#7d3f2c"/>
      <g fill="#6e3526"><path d="M262 120 V108 Q268 101 274 108 V120Z"/><path d="M262 158 V146 Q268 139 274 146 V158Z"/></g>
      ${palm(64, 208, 1)}${palm(352, 210, .85)}`); }
  }
  return '';
}

// New in this app (the prototype has neither): Kathmandu (a stupa with watching eyes, prayer flags, snow peaks) and Washington (the wrap-up).
PAT.newari = `<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'><rect width='44' height='44' fill='#17386a'/><g fill='none' stroke='#c98a3d' stroke-width='2'><rect x='6' y='6' width='32' height='32'/><rect x='13' y='13' width='18' height='18'/><path d='M6 6 L13 13 M38 6 L31 13 M6 38 L13 31 M38 38 L31 31'/></g></svg>`;
PAT.starfield = `<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56'><rect width='56' height='56' fill='#14264d'/><g fill='#f4efe6'><path d='M14 10 l1.6 4 4.2 .3 -3.2 2.7 1 4.1 -3.6 -2.2 -3.6 2.2 1 -4.1 -3.2 -2.7 4.2 -.3z'/><path d='M42 36 l1.3 3.2 3.4 .3 -2.6 2.2 .8 3.3 -2.9 -1.8 -2.9 1.8 .8 -3.3 -2.6 -2.2 3.4 -.3z'/></g><g fill='#b3202a'><rect x='0' y='26' width='56' height='3' opacity='.55'/></g></svg>`;
const EXTRA_SCENES = {
  kathmandu: () => {
    const u = uid();
    return `<svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1">${stp(0, '#7fa6d6')}${stp(.55, '#f4c9a4')}${stp(1, '#fbe6cc')}</linearGradient></defs><rect width="400" height="260" fill="url(#s${u})"/>
      <path d="M0 150 L50 96 L90 128 L150 58 L210 120 L270 84 L330 126 L400 92 V190 H0Z" fill="#e8eef6"/><path d="M150 58 L172 86 L158 84 L150 96 L140 82 L128 90Z" fill="#fff"/>
      <path d="M0 176 Q100 150 200 170 T400 160 V260 H0Z" fill="#6f8f6a"/><rect y="206" width="400" height="54" fill="#b98a5e"/>
      <g fill="#fbf8f2"><path d="M110 206 Q110 130 200 130 Q290 130 290 206Z"/><rect x="176" y="104" width="48" height="30"/><path d="M200 60 L214 104 L186 104Z" fill="#d9a531"/></g>
      <rect x="170" y="98" width="60" height="6" fill="#c8332b"/><g fill="#fff"><circle cx="188" cy="118" r="6"/><circle cx="212" cy="118" r="6"/></g><g fill="#1b2a44"><circle cx="188" cy="118" r="2.6"/><circle cx="212" cy="118" r="2.6"/><path d="M198 120 h4 v8 h-4z"/></g>
      <path d="M200 60 L200 44" stroke="#d9a531" stroke-width="3"/><path d="M100 60 Q200 96 300 56" fill="none" stroke="#7d5a3a" stroke-width="1.2"/>
      <g>${['#2f6db5', '#f4efe6', '#c8332b', '#2e8b57', '#e9b40c'].map((c, i) => `<rect x="${112 + i * 18}" y="${72 + Math.sin(i * 0.9) * 6 + i * 2}" width="12" height="15" fill="${c}"/>`).join('')}${['#e9b40c', '#2e8b57', '#c8332b', '#f4efe6', '#2f6db5'].map((c, i) => `<rect x="${212 + i * 18}" y="${72 + (4 - i) * 2 + Math.sin(i * 0.9) * 6}" width="12" height="15" fill="${c}"/>`).join('')}</g>
      ${palm(40, 214, .8, '#2e4a37')}${palm(360, 216, .7, '#2e4a37')}</svg>`;
  },
  capitol: () => {
    const u = uid();
    let blossoms = ''; for (let i = 0; i < 16; i++) blossoms += `<circle cx="${30 + i * 23}" cy="${196 + (i % 3) * 5}" r="${5 + (i % 4)}" fill="${i % 2 ? '#f6c4d4' : '#f9dce6'}"/>`;
    return `<svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1">${stp(0, '#35508f')}${stp(.55, '#f1a58a')}${stp(1, '#fde3c4')}</linearGradient></defs><rect width="400" height="260" fill="url(#s${u})"/>
      <g fill="#fff" opacity=".85"><circle cx="60" cy="40" r="1.6"/><circle cx="120" cy="24" r="1.2"/><circle cx="330" cy="36" r="1.6"/><circle cx="270" cy="20" r="1.2"/></g>
      <rect y="206" width="400" height="54" fill="#7ea36b"/><rect x="0" y="198" width="400" height="14" fill="#4d7aa8" opacity=".85"/>
      <g fill="#f6f2ea"><rect x="110" y="170" width="150" height="30"/><path d="M130 170 Q130 120 185 120 Q240 120 240 170Z"/><rect x="176" y="96" width="18" height="26"/><path d="M176 96 L185 84 L194 96Z"/>
        <g fill="#e8e1d4"><rect x="118" y="176" width="5" height="24"/><rect x="134" y="176" width="5" height="24"/><rect x="150" y="176" width="5" height="24"/><rect x="216" y="176" width="5" height="24"/><rect x="232" y="176" width="5" height="24"/><rect x="248" y="176" width="5" height="24"/></g></g>
      <g fill="#f6f2ea"><path d="M316 200 L322 60 L328 200Z"/><path d="M322 44 L329 60 H315Z"/></g>
      <path d="M0 214 Q200 204 400 216 V260 H0Z" fill="#6d9560"/>
      <g fill="#5b3a2e"><rect x="40" y="170" width="6" height="40"/><rect x="354" y="176" width="6" height="36"/></g>${blossoms}</svg>`;
  },
};
const SCENE_FALLBACK = (kind) => (EXTRA_SCENES[kind] ? EXTRA_SCENES[kind]() : '');

// ---- what the app uses ----
// The drawn scene of a destination as an SVG string ('' if the name is unknown). Names come from the trip file; the string is built here, never from typed text.
export function sceneSvg(kind) { return scene(kind) || SCENE_FALLBACK(kind); }

// The repeating background tile of a destination as { url, size } for CSS ('' url when the name is unknown). The tile size is read from the drawing itself.
export function patternCss(name) {
  const svg = PAT[name];
  if (!svg) return { url: '', size: '' };
  const w = /width='(\d+)'/.exec(svg)?.[1] ?? '48';
  const h = /height='(\d+)'/.exec(svg)?.[1] ?? w;
  return { url: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, size: `${w}px ${h}px` };
}
export const PATTERN_NAMES = () => Object.keys(PAT);
