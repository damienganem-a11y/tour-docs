// Guests' faces (v0.153.0, owner's request of 11 Nov 2026): a small photo of each guest, so a colleague can find "Anna A." in a lobby, and the
// allergy list can show who is who at a glance.
//   - One small square picture per guest (192 x 192 pixels, about 10 KB), made on this phone from the camera or a photo. Never the full photo.
//   - Stored on the guest in the trip (guest.photo), so every colleague's phone has it, offline too.
//   - Like allergies: never in the journal (it only says "photo added"), never in an export, never in the guest app; included in backups; ERASED
//     when the trip is archived, together with the allergies.

export const FACE_SIZE = 192;
export const FACE_MAX_CHARS = 60000; // a face is a JPEG of about 10 KB; anything much larger is refused

// Is this a face the app made? (a small JPEG written as text)
export function isFace(photo) {
  return typeof photo === 'string' && photo.startsWith('data:image/jpeg;base64,') && photo.length <= FACE_MAX_CHARS;
}

// The middle square of a picture, in pixels: { x, y, side }. Pure, so it can be tested.
export function centreSquare(width, height) {
  const side = Math.min(width, height);
  // A portrait photo keeps more of its top half: faces are rarely in the exact middle of a phone photo.
  const y = height > width ? Math.round((height - side) * 0.3) : Math.round((height - side) / 2);
  return { x: Math.round((width - side) / 2), y, side };
}

// Makes a face from a file chosen on the phone (camera or library). Returns the JPEG as text.
export async function faceFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('That picture could not be read. Try another one.'));
      image.src = url;
    });
    const { x, y, side } = centreSquare(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = FACE_SIZE; canvas.height = FACE_SIZE;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
    g.drawImage(image, x, y, side, side, 0, 0, FACE_SIZE, FACE_SIZE);
    let quality = 0.78; let data = canvas.toDataURL('image/jpeg', quality);
    while (data.length > FACE_MAX_CHARS && quality > 0.4) { quality -= 0.12; data = canvas.toDataURL('image/jpeg', quality); }
    if (!isFace(data)) throw new Error('That picture could not be made small enough. Try another one.');
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The two letters shown when a guest has no photo ("AA" for Anna Alder).
export const initialsOf = (guest) => `${(guest?.first ?? '').trim().slice(0, 1)}${(guest?.last ?? '').trim().slice(0, 1)}`.toUpperCase() || '?';
