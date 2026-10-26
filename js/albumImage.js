// Our Album: shrinking a photo on the phone before it is sent (shared by the guest app and the staff app). A phone photo is several MB; sent as a JPEG of
// at most 2000 pixels on the long side it is about 1 MB, which is quick to send and cheap to keep. Returns { blob, width, height }.
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
