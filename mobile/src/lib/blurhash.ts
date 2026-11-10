/**
 * Blurhash decoding, after the MIT reference implementation (github.com/woltapp/blurhash, TypeScript), which expo-image
 * also bundles but does not export.
 *
 * Why it is here: on web, expo-image draws a blurhash placeholder into a canvas, hands it over as a `blob:` URL and revokes
 * that URL when the placeholder unmounts. When the real photo wins the race, WebKit is still loading the blob and fails with
 * "WebKitBlobResource error 1". A `data:` URL has no lifetime, so the web build passes one instead (see `ui/imagePlaceholder`).
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const AC_LEVELS = 19;
const AC_CENTRE = 9;
const MAX_AC_DIVISOR = 166;
const BYTES_PER_PIXEL = 4;
const OPAQUE = 255;
const CHANNEL_MAX = 255;
const MIN_LENGTH = 6;
const MAX_COMPONENTS = 9;
const BYTE = 8;
const TWO_BYTES = 16;
const BYTE_MASK = 0xff;

type Rgb = [number, number, number];

function decode83(text: string): number {
  let value = 0;
  for (const char of text) {
    const digit = DIGITS.indexOf(char);
    if (digit < 0) throw new Error(`Invalid blurhash character "${char}"`);
    value = value * DIGITS.length + digit;
  }
  return value;
}

function sRGBToLinear(value: number): number {
  const v = value / CHANNEL_MAX;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSRGB(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return v <= 0.0031308 ? Math.trunc(v * 12.92 * CHANNEL_MAX + 0.5) : Math.trunc((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * CHANNEL_MAX + 0.5);
}

function signPow(value: number, exponent: number): number {
  return Math.sign(value) * Math.pow(Math.abs(value), exponent);
}

function decodeDC(value: number): Rgb {
  return [sRGBToLinear(value >> TWO_BYTES), sRGBToLinear((value >> BYTE) & BYTE_MASK), sRGBToLinear(value & BYTE_MASK)];
}

function decodeAC(value: number, maximum: number): Rgb {
  const r = Math.floor(value / (AC_LEVELS * AC_LEVELS));
  const g = Math.floor(value / AC_LEVELS) % AC_LEVELS;
  const b = value % AC_LEVELS;
  return [
    signPow((r - AC_CENTRE) / AC_CENTRE, 2) * maximum,
    signPow((g - AC_CENTRE) / AC_CENTRE, 2) * maximum,
    signPow((b - AC_CENTRE) / AC_CENTRE, 2) * maximum,
  ];
}

/** Components across and down, or null when the string is not a well-formed blurhash. */
function sizeOf(hash: string): { numX: number; numY: number } | null {
  if (hash.length < MIN_LENGTH) return null;
  try {
    const sizeFlag = decode83(hash.charAt(0));
    const numY = Math.floor(sizeFlag / MAX_COMPONENTS) + 1;
    const numX = (sizeFlag % MAX_COMPONENTS) + 1;
    if (hash.length !== 4 + 2 * numX * numY) return null;
    decode83(hash);
    return { numX, numY };
  } catch {
    return null;
  }
}

export function isBlurhashValid(hash: string): boolean {
  return sizeOf(hash) !== null;
}

/** RGBA pixels, row by row, ready for `ImageData`. Throws on a malformed hash. */
export function decodeBlurhash(hash: string, width: number, height: number, punch = 1): Uint8ClampedArray {
  const size = sizeOf(hash);
  if (!size) throw new Error(`Invalid blurhash "${hash}"`);
  const { numX, numY } = size;
  const maximum = ((decode83(hash.charAt(1)) + 1) / MAX_AC_DIVISOR) * punch;

  const colors: Rgb[] = [decodeDC(decode83(hash.substring(2, 6)))];
  for (let i = 1; i < numX * numY; i++) {
    colors.push(decodeAC(decode83(hash.substring(4 + i * 2, 6 + i * 2)), maximum));
  }

  const pixels = new Uint8ClampedArray(width * height * BYTES_PER_PIXEL);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < numY; j++) {
        const basisY = Math.cos((Math.PI * y * j) / height);
        for (let i = 0; i < numX; i++) {
          const basis = Math.cos((Math.PI * x * i) / width) * basisY;
          const color = colors[i + j * numX] as Rgb;
          r += color[0] * basis;
          g += color[1] * basis;
          b += color[2] * basis;
        }
      }
      const offset = (y * width + x) * BYTES_PER_PIXEL;
      pixels[offset] = linearToSRGB(r);
      pixels[offset + 1] = linearToSRGB(g);
      pixels[offset + 2] = linearToSRGB(b);
      pixels[offset + 3] = OPAQUE;
    }
  }
  return pixels;
}

/** The size expo-image decodes a blurhash at by default, so the placeholder looks the same. */
export const BLURHASH_SIZE = 32;
const CACHE_LIMIT = 128;
const dataUrls = new Map<string, string | null>();

function draw(hash: string): string | null {
  if (typeof document === 'undefined' || !isBlurhashValid(hash)) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = BLURHASH_SIZE;
    canvas.height = BLURHASH_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const image = context.createImageData(BLURHASH_SIZE, BLURHASH_SIZE);
    image.data.set(decodeBlurhash(hash, BLURHASH_SIZE, BLURHASH_SIZE));
    context.putImageData(image, 0, 0);
    const url = canvas.toDataURL('image/png');
    return url.startsWith('data:image/png') ? url : null;
  } catch {
    return null;
  }
}

/**
 * The blurhash as a 32 × 32 PNG `data:` URL, or null without a DOM canvas or for a malformed hash. Memoised per hash in a
 * small LRU, so a list re-render or a recycled cell does not draw again and gets the same string back.
 */
export function blurhashToDataUrl(hash: string): string | null {
  if (dataUrls.has(hash)) {
    const cached = dataUrls.get(hash) ?? null;
    dataUrls.delete(hash);
    dataUrls.set(hash, cached);
    return cached;
  }
  const url = draw(hash);
  dataUrls.set(hash, url);
  if (dataUrls.size > CACHE_LIMIT) {
    const oldest = dataUrls.keys().next().value;
    if (oldest !== undefined) dataUrls.delete(oldest);
  }
  return url;
}

/** For tests only. */
export function clearBlurhashCache(): void {
  dataUrls.clear();
}
