// Reads a picture chosen on the phone (used only by the QR scanner – nothing is uploaded).
// <img> decoding first: works on every iOS version (also HEIC photos) and applies the photo's rotation.

function loadWithImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ src: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

export async function decodeImage(file) {
  try {
    return await loadWithImg(file);
  } catch {
    if (typeof createImageBitmap !== 'function') throw new Error('This photo type is not supported. Please pick a JPG or PNG.');
    const bmp = await createImageBitmap(file);
    return { src: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close?.() };
  }
}

