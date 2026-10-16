/**
 * An image's size in pixels read from its file's header (TR-164), so the phone never decodes a whole
 * image only to learn its shape: Android's `Image.getSize` decodes it at full size, a second time
 * beside the thumbnail's own decode. PNG, JPEG (turned as its EXIF orientation shows it), GIF and
 * WebP; null for anything else, or a header cut short.
 */

export interface PixelSize {
  width: number;
  height: number;
}

function sizeOrNull(width: number, height: number): PixelSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF = [0x47, 0x49, 0x46, 0x38];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

export function imagePixelSize(bytes: Uint8Array): PixelSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (startsWith(bytes, PNG)) return bytes.length < 24 ? null : sizeOrNull(view.getUint32(16), view.getUint32(20));
  if (startsWith(bytes, GIF)) return bytes.length < 10 ? null : sizeOrNull(view.getUint16(6, true), view.getUint16(8, true));
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return webpSize(bytes, view);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes, view);
  return null;
}

function webpSize(bytes: Uint8Array, view: DataView): PixelSize | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
  // Lossy: 14-bit sizes after the key frame's start code.
  if (chunk === "VP8 ") return sizeOrNull(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  // Lossless: 14-bit sizes less one, packed after the signature byte.
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return sizeOrNull((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  // Extended: 24-bit canvas sizes less one.
  if (chunk === "VP8X") {
    const width = view.getUint16(24, true) | (view.getUint8(26) << 16);
    const height = view.getUint16(27, true) | (view.getUint8(29) << 16);
    return sizeOrNull(width + 1, height + 1);
  }
  return null;
}

/** Start-of-frame markers that carry the size; 0xc4 (Huffman tables), 0xc8 and 0xcc share the range but do not. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpegSize(bytes: Uint8Array, view: DataView): PixelSize | null {
  let offset = 2;
  let turned = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    // Fill bytes before a marker.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    if (marker === 0xe1) turned = exifTurned(bytes, view, offset + 4, offset + 2 + length) || turned;
    if (isStartOfFrame(marker)) {
      if (offset + 9 > bytes.length) return null;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return turned ? sizeOrNull(height, width) : sizeOrNull(width, height);
    }
    offset += 2 + length;
  }
  return null;
}

/** Whether an EXIF block's orientation (5 to 8) shows the image turned a quarter, so its width and height swap. */
function exifTurned(bytes: Uint8Array, view: DataView, start: number, end: number): boolean {
  const limit = Math.min(end, bytes.length);
  // "Exif\0\0", then a TIFF header: byte order, 42, the first directory's offset.
  if (limit < start + 14 || !startsWith(bytes, [0x45, 0x78, 0x69, 0x66, 0, 0], start)) return false;
  const tiff = start + 6;
  const little = bytes[tiff] === 0x49;
  if (!little && bytes[tiff] !== 0x4d) return false;
  const directory = tiff + view.getUint32(tiff + 4, little);
  if (directory + 2 > limit) return false;
  const entries = view.getUint16(directory, little);
  for (let index = 0; index < entries; index++) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > limit) return false;
    if (view.getUint16(entry, little) === 0x0112) {
      const orientation = view.getUint16(entry + 8, little);
      return orientation >= 5 && orientation <= 8;
    }
  }
  return false;
}
