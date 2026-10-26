// Our Album: preparing a photo on the phone before it is sent (shared by the guest app and the staff app). shrinkPhoto draws a picture at a given size and
// quality; preparePhoto (below) decides what the album keeps. Returns { blob, width, height }.
export function shrinkPhoto(file, longSide, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, longSide / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale)); const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve({ blob, width, height }) : reject(new Error('shrink'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('shrink')); };
    img.src = url;
  });
}

// ---------- Quality (owner's request, 26 Oct 2026: the tours are for National Geographic, so photos must stay good) ----------
// What is kept of a photo for the album: a JPEG at the phone's own size (up to 4096 pixels on the long side: an iPhone photo, 4032 pixels, is kept whole) at high
// quality (0.92), lowered a little only if the file would still be over 8 MB. It is always redrawn rather than passed on as it came: that also drops the hidden
// data inside a phone photo (the GPS position of where it was taken), which must not be shared with the whole group, and it turns an iPhone HEIC into a JPEG.
// The small picture for the grid is 640 pixels wide (sharp on a retina screen).
// Returns { full: Blob, width, height, thumb: Blob }.
export const ALBUM_MAX_BYTES = 8 * 1024 * 1024;
const ALBUM_MAX_SIDE = 4096;
export const ALBUM_THUMB_SIDE = 640;

export async function preparePhoto(file) {
  const thumb = (await shrinkPhoto(file, ALBUM_THUMB_SIDE, 0.8)).blob;
  let quality = 0.92;
  let best = await shrinkPhoto(file, ALBUM_MAX_SIDE, quality);
  while (best.blob.size > ALBUM_MAX_BYTES && quality > 0.74) { quality -= 0.06; best = await shrinkPhoto(file, ALBUM_MAX_SIDE, quality); }
  return { full: best.blob, width: best.width, height: best.height, thumb };
}
