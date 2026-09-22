// A small PDF writer, built only for Tour Docs's own exports: pages of small ID/Name tables, laid
// out side by side like the paper lists the team already uses (SPEC.md, "5. Export"). No pictures,
// no custom font: it uses Helvetica, which is built into the PDF format itself, so nothing needs to
// be carried in the file (or in the app) to draw the letters.
//
// Written by hand, with no outside library, the same as everything else in Tour Docs. A PDF file is
// mostly plain text (a numbered list of "objects", plus an index at the end saying where each one
// starts); the real work here is laying the little tables out on the page, and writing that index
// correctly.

const PAGE_WIDTH = 842;  // A4, in points (1/72 inch), landscape — wide enough for tables side by side
const PAGE_HEIGHT = 595;
const MARGIN = 22;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const USABLE_HEIGHT = PAGE_HEIGHT - MARGIN * 2;

// ---------- Measuring text (so it is never drawn past the edge of its own column) ----------
//
// These are Helvetica's own published letter widths (1/1000 of the text size, the units PDF uses).
// Every reader already has this font built in, so this table is the only "font" data we carry.
// Accented letters (beyond the plain A-Z the table lists) are not measured exactly: they are given
// an average width instead, which only ever wraps a line a little earlier than strictly needed.
const REGULAR_WIDTHS = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191, 40: 333, 41: 333,
  42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556,
  52: 556, 53: 556, 54: 556, 55: 556, 56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584,
  62: 584, 63: 556, 64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778,
  82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 278,
  92: 278, 93: 278, 94: 469, 95: 556, 96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556,
  102: 278, 103: 556, 104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556, 118: 500, 119: 722,
  120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334, 126: 584,
};
const BOLD_WIDTHS = {
  32: 278, 33: 333, 34: 474, 35: 556, 36: 556, 37: 889, 38: 722, 39: 238, 40: 333, 41: 333,
  42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556,
  52: 556, 53: 556, 54: 556, 55: 556, 56: 556, 57: 556, 58: 333, 59: 333, 60: 584, 61: 584,
  62: 584, 63: 611, 64: 975, 65: 722, 66: 722, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 556, 75: 722, 76: 611, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778,
  82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 333,
  92: 278, 93: 333, 94: 584, 95: 556, 96: 333, 97: 556, 98: 611, 99: 556, 100: 611, 101: 556,
  102: 333, 103: 611, 104: 611, 105: 278, 106: 278, 107: 556, 108: 278, 109: 889, 110: 611,
  111: 611, 112: 611, 113: 611, 114: 389, 115: 556, 116: 333, 117: 611, 118: 556, 119: 778,
  120: 556, 121: 556, 122: 500, 123: 389, 124: 280, 125: 389, 126: 584,
};
const FONT_REGULAR = { resourceName: 'F1', baseFont: 'Helvetica', widths: REGULAR_WIDTHS, defaultWidth: 556 };
const FONT_BOLD = { resourceName: 'F2', baseFont: 'Helvetica-Bold', widths: BOLD_WIDTHS, defaultWidth: 611 };

function textWidth(text, font, size) {
  let units = 0;
  for (const ch of text) units += font.widths[ch.codePointAt(0)] ?? font.defaultWidth;
  return (units / 1000) * size;
}

// Cuts text short with "…" so it always fits maxWidth on one line: a table cell never wraps (that
// would break the row heights every column is lined up on), it just shortens if it has to.
function fitOneLine(text, font, size, maxWidth) {
  if (textWidth(text, font, size) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`, font, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

// Splits text into lines that each fit maxWidth, breaking between words. A single word longer than
// a whole line is left on its own line rather than cut mid-word (a rare case, e.g. a long tour name).
function wrapText(text, font, size, maxWidth) {
  const words = text.split(' ').filter((w) => w !== '');
  if (words.length === 0) return [''];
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textWidth(candidate, font, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return lines;
}

// ---------- The shape of one small ID/Name table ----------
//
// Tables are laid out on a grid of same-sized "tiles", side by side and then down the page, so
// several tours line up neatly next to each other, the same way the team's own paper lists do —
// small and tight, so a whole half-day (several tours) fits on the one page it belongs to (see
// "one page per half-day" below). A table with more guests than fit in one tile (ROWS_PER_TILE)
// simply continues in the next tile (its numbering carries on, e.g. 41, 42, 43...), rather than
// becoming one very tall column; in practice a tile is tall enough that this rarely happens.

const TILE_WIDTH = 124;
const TILE_GAP = 8;
const NUM_COL_W = 12;   // the "#" column, right-aligned
const ID_COL_W = 26;    // the guest's own ID (ref), left-aligned
// the rest of the tile width is the Name column

const ROWS_PER_TILE = 40;
const ROW_H = 9;
const TITLE_SIZE = 8;
const DETAIL_SIZE = 6;
const HEAD_SIZE = 6.5;
const CELL_SIZE = 7;
// Fixed so every tile is exactly the same height, whether or not it actually has a title to show
// (a continuing tile leaves this space blank): title (up to 2 lines) + detail line + column headings.
const TITLE_BLOCK_H = TITLE_SIZE * 1.2 * 2 + DETAIL_SIZE * 1.3 + 4;
const COLHEAD_H = HEAD_SIZE * 1.3 + 3;
const TILE_HEADER_H = TITLE_BLOCK_H + COLHEAD_H;
const TILE_HEIGHT = TILE_HEADER_H + ROWS_PER_TILE * ROW_H + 4;

// Splits one table's rows into same-sized chunks of ROWS_PER_TILE, each becoming one tile. Only the
// first chunk carries the table's own title and detail line; later chunks just carry the column
// headings and keep counting from where the last one left off.
function tilesFor(table) {
  const tiles = [];
  for (let start = 0; start < table.rows.length || start === 0; start += ROWS_PER_TILE) {
    tiles.push({
      heading: start === 0 ? table.heading : null,
      detail: start === 0 ? table.detail : null,
      count: start === 0 ? table.count : null,
      firstNumber: start + 1,
      rows: table.rows.slice(start, start + ROWS_PER_TILE),
    });
    if (table.rows.length === 0) break; // an empty table still gets its one (empty) tile
  }
  return tiles;
}

// ---------- Laying tiles out onto pages ----------
//
// A "doc" looks like:
//   { title, updatedLine, groups: [ { heading, tables: [ { heading, detail, count, rows }, ... ] }, ... ] }
// `groups` are the half-days (only shown as their own heading when there is more than one); `rows`
// are { id, name } pairs, already in the order they should be printed.
function layoutPages(doc) {
  const pages = [];
  let page = [];
  let y = PAGE_HEIGHT - MARGIN; // where the next thing (a text line, or a fresh row of tiles) starts

  function startPage() {
    if (page.length > 0) pages.push(page);
    page = [];
    y = PAGE_HEIGHT - MARGIN;
  }
  // Reserves `height` below the current y, moving to a fresh page first if it would run off the
  // bottom — but never on an empty page (that would loop forever if one row is taller than a page).
  function ensureRoom(height) {
    if (page.length > 0 && y - height < MARGIN) startPage();
  }
  function text(str, px, py, { font = FONT_REGULAR, size = CELL_SIZE, gray = 0, align = 'left', maxWidth } = {}) {
    const shown = maxWidth ? fitOneLine(str, font, size, maxWidth) : str;
    const drawX = align === 'right' ? px - textWidth(shown, font, size) : px;
    page.push({ type: 'text', x: drawX, y: py, font, size, gray, text: shown });
  }
  function rule(rx, ry, w, gray = 0.75) {
    page.push({ type: 'rect', x: rx, y: ry, w, h: 0.75, gray });
  }

  // The doc's own title and "Updated ..." line, at the top of every half-day's own page (small, so
  // it does not eat into the room the tables need).
  function writeDocHead() {
    const titleLines = wrapText(doc.title, FONT_BOLD, 12, USABLE_WIDTH);
    for (const line of titleLines) { text(line, MARGIN, y, { font: FONT_BOLD, size: 12 }); y -= 14; }
    text(doc.updatedLine, MARGIN, y, { size: 7.5, gray: 0.4 });
    y -= 14;
  }
  writeDocHead();

  // Places tiles left to right, wrapping to further rows (and pages) as needed, then leaves y just
  // below the row(s) it used.
  const perRow = Math.max(1, Math.floor((USABLE_WIDTH + TILE_GAP) / (TILE_WIDTH + TILE_GAP)));
  function placeTileRow(tiles) {
    for (let i = 0; i < tiles.length; i += perRow) {
      ensureRoom(TILE_HEIGHT);
      tiles.slice(i, i + perRow).forEach((tile, col) => drawTile(tile, MARGIN + col * (TILE_WIDTH + TILE_GAP), y, { text, rule }));
      y -= TILE_HEIGHT + 6;
    }
  }

  // Every half-day is meant to be read (and printed) as its own single page, so — other than the
  // very first — each one starts a fresh page rather than flowing into whatever room the previous
  // half-day happened to leave at the bottom of its own.
  doc.groups.forEach((group, i) => {
    if (i > 0) { startPage(); writeDocHead(); }
    if (group.heading) {
      ensureRoom(16);
      text(group.heading, MARGIN, y, { font: FONT_BOLD, size: 10, gray: 0.15 });
      y -= 16;
    }
    // All of this half-day's tables are packed into the same flowing grid: a short table (say, "Day
    // at leisure") sits right next to the next one instead of wasting the rest of its own row, and
    // only a table with more guests than fit in one tile spills into more tiles of its own, still
    // read left to right in order (as SPEC.md's "one list per activity" — just several per row).
    placeTileRow(group.tables.flatMap(tilesFor));
  });
  startPage(); // flush whatever is left onto the final page
  return pages;
}

// Draws one tile (a table, or one chunk of a long one) with its top-left corner at (left, top).
// The title block and the column-heading block each always take up their own full, fixed height
// (TITLE_BLOCK_H, COLHEAD_H — see the constants above) whether or not there is actually a title to
// show, so every tile in a row is exactly the same height and the rows of every tile line up.
function drawTile(tile, left, top, { text, rule }) {
  if (tile.heading) {
    const heading = tile.count ? `${tile.heading}  (${tile.count})` : tile.heading;
    const lines = wrapText(heading, FONT_BOLD, TITLE_SIZE, TILE_WIDTH).slice(0, 2);
    lines.forEach((line, i) => text(line, left, top - TITLE_SIZE * 1.2 * (i + 1), { font: FONT_BOLD, size: TITLE_SIZE }));
    if (tile.detail) text(tile.detail, left, top - TITLE_SIZE * 1.2 * 2 - DETAIL_SIZE, { size: DETAIL_SIZE, gray: 0.45, maxWidth: TILE_WIDTH });
  }
  const headY = top - TITLE_BLOCK_H; // baseline of the "#  ID  Name" column headings
  text('#', left + NUM_COL_W, headY, { font: FONT_BOLD, size: HEAD_SIZE, gray: 0.4, align: 'right' });
  text('ID', left + NUM_COL_W + 8, headY, { font: FONT_BOLD, size: HEAD_SIZE, gray: 0.4 });
  text('Name', left + NUM_COL_W + 8 + ID_COL_W, headY, { font: FONT_BOLD, size: HEAD_SIZE, gray: 0.4 });
  rule(left, headY - 3, TILE_WIDTH);

  const firstRowY = top - TILE_HEADER_H - ROW_H;
  const nameX = left + NUM_COL_W + 8 + ID_COL_W;
  const nameW = TILE_WIDTH - NUM_COL_W - 8 - ID_COL_W - 4;
  tile.rows.forEach((row, i) => {
    const rowY = firstRowY - i * ROW_H;
    text(String(tile.firstNumber + i), left + NUM_COL_W, rowY, { size: CELL_SIZE, align: 'right' });
    text(row.id || '', left + NUM_COL_W + 8, rowY, { size: CELL_SIZE, maxWidth: ID_COL_W });
    text(row.name, nameX, rowY, { size: CELL_SIZE, maxWidth: nameW });
  });
}

// ---------- Writing the bytes of the PDF file itself ----------

class ByteWriter {
  constructor() { this.bytes = []; }
  get length() { return this.bytes.length; }
  ascii(str) { for (let i = 0; i < str.length; i++) this.bytes.push(str.charCodeAt(i)); return this; }
  raw(byteArray) { for (const b of byteArray) this.bytes.push(b); return this; }
  append(other) { return this.raw(other.bytes); }
  toUint8Array() { return new Uint8Array(this.bytes); }
}

// WinAnsiEncoding matches plain Latin-1 for every accented letter (Grünewald, Sørensen, ...), but a
// handful of ordinary punctuation marks sit at a different byte than their Unicode codepoint — the
// app's own title text uses an em dash ("—"), and a long name is shortened with "…": without this
// table they would silently turn into "?" instead of the punctuation actually asked for.
const WINANSI_EXTRA = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

// A PDF "literal string" is written between ( and ): its own parentheses and backslashes must be
// escaped. Every character is written as a single byte using WinAnsiEncoding.
// A character with no WinAnsi byte (an emoji, another script) is shown as "?" rather than break the file.
function winAnsiBytes(text) {
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const byte = WINANSI_EXTRA[code] ?? (code <= 0xff ? code : 0x3f);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c); // \( \) \\
    bytes.push(byte);
  }
  return bytes;
}

function buildContentStream(items) {
  const out = new ByteWriter();
  for (const item of items) {
    if (item.type === 'rect') {
      out.ascii(`${item.gray} g\n${item.x.toFixed(2)} ${item.y.toFixed(2)} ${item.w.toFixed(2)} ${item.h.toFixed(2)} re\nf\n`);
      continue;
    }
    out.ascii(`${item.gray} g\n`);
    out.ascii('BT\n');
    out.ascii(`/${item.font.resourceName} ${item.size} Tf\n`);
    out.ascii(`1 0 0 1 ${item.x.toFixed(2)} ${item.y.toFixed(2)} Tm\n(`);
    out.raw(winAnsiBytes(item.text));
    out.ascii(') Tj\nET\n');
  }
  return out;
}

// Turns pages of drawing instructions (from layoutPages) into the bytes of an actual .pdf file: a
// short list of numbered "objects" (the catalog, the page list, one page and one content stream per
// page, and the two fonts), followed by an index ("xref") telling a reader exactly where each starts.
function serializePdf(pages) {
  const nPages = pages.length;
  const pagesObj = 2;
  const firstPageObj = 3;                     // page i -> firstPageObj + i*2, its content -> +1
  const fontRegularObj = firstPageObj + nPages * 2;
  const fontBoldObj = fontRegularObj + 1;
  const lastObj = fontBoldObj;

  const out = new ByteWriter();
  const offsetOf = new Array(lastObj + 1);

  function object(num, writeBody) {
    offsetOf[num] = out.length;
    out.ascii(`${num} 0 obj\n`);
    writeBody();
    out.ascii('\nendobj\n');
  }

  out.ascii('%PDF-1.4\n');

  object(1, () => out.ascii(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`));

  const kids = pages.map((_, i) => `${firstPageObj + i * 2} 0 R`).join(' ');
  object(pagesObj, () => out.ascii(`<< /Type /Pages /Kids [${kids}] /Count ${nPages} >>`));

  pages.forEach((items, i) => {
    const pageObj = firstPageObj + i * 2;
    const contentObj = pageObj + 1;
    const content = buildContentStream(items);

    object(pageObj, () => out.ascii(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] `
      + `/Resources << /Font << /F1 ${fontRegularObj} 0 R /F2 ${fontBoldObj} 0 R >> >> /Contents ${contentObj} 0 R >>`
    ));
    object(contentObj, () => { out.ascii(`<< /Length ${content.length} >>\nstream\n`); out.append(content); out.ascii('\nendstream'); });
  });

  object(fontRegularObj, () => out.ascii(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_REGULAR.baseFont} /Encoding /WinAnsiEncoding >>`));
  object(fontBoldObj, () => out.ascii(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BOLD.baseFont} /Encoding /WinAnsiEncoding >>`));

  const xrefOffset = out.length;
  out.ascii(`xref\n0 ${lastObj + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= lastObj; n++) out.ascii(`${String(offsetOf[n]).padStart(10, '0')} 00000 n \n`);
  out.ascii(`trailer\n<< /Size ${lastObj + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return out.toUint8Array();
}

// The one thing the rest of the app calls: doc (see layoutPages above) -> a ready-to-share PDF Blob.
export function buildListsPdf(doc) {
  const bytes = serializePdf(layoutPages(doc));
  return new Blob([bytes], { type: 'application/pdf' });
}
