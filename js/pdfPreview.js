// A look at a PDF before it is sent (owner's request, 21 Oct 2026): the pages of the file just built (pdf.js lastPdfPages) are drawn on canvases, so the
// leader sees exactly what the guests or the restaurant will receive, page by page, and sends it from there.
// It draws the same drawing instructions the file is made of (rectangles, text in Helvetica, pictures), so nothing is converted twice.

// layout: { pages, width, height, images } from lastPdfPages(). Returns one canvas per page, `pixelWidth` wide.
export async function pdfPageCanvases(layout, pixelWidth = 720) {
  const scale = pixelWidth / layout.width;
  const pictures = new Map();
  for (const img of layout.images) {
    try { pictures.set(img.name, await createImageBitmap(new Blob([img.bytes], { type: 'image/jpeg' }))); } catch { /* a picture that cannot be shown is left out of the preview only */ }
  }
  const grey = (g) => `rgb(${Math.round(g * 255)},${Math.round(g * 255)},${Math.round(g * 255)})`;
  const colour = (item) => (item.rgb ? `rgb(${item.rgb.map((v) => Math.round(v * 255)).join(',')})` : grey(item.gray ?? 0));
  return layout.pages.map((items) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(layout.width * scale);
    canvas.height = Math.round(layout.height * scale);
    canvas.className = 'pdf-page';
    const c = canvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, canvas.width, canvas.height);
    for (const item of items) {
      if (item.type === 'image') {
        const picture = pictures.get(item.name);
        if (picture) c.drawImage(picture, item.x * scale, (layout.height - item.y - item.h) * scale, item.w * scale, item.h * scale);
      } else if (item.type === 'rect') {
        c.fillStyle = colour(item);
        c.fillRect(item.x * scale, (layout.height - item.y - item.h) * scale, item.w * scale, item.h * scale);
      } else {
        c.fillStyle = colour(item);
        c.font = `${item.font.baseFont.includes('Bold') ? 'bold ' : ''}${item.size * scale}px Helvetica, Arial, sans-serif`;
        c.fillText(item.text, item.x * scale, (layout.height - item.y) * scale);
      }
    }
    return canvas;
  });
}
