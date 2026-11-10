// Pixel comparison shared by baseline diffing and the Blade-vs-SPA parity test.
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/** Baseline tolerance, docs/07_QA_AND_RELEASE.md section 3. */
export const MAX_DIFF_PIXEL_RATIO = 0.002;

/**
 * Compares two PNGs. Images of different sizes are compared on their union, so pixels only one
 * image has count as different rather than being ignored.
 * @param {Buffer} a
 * @param {Buffer} b
 * @param {{threshold?:number,writeDiff?:boolean}} [opts] threshold: per-pixel colour distance (pixelmatch)
 * @returns {{ratio:number,differentPixels:number,totalPixels:number,sameSize:boolean,diff:Buffer|null}}
 */
export function comparePng(a, b, { threshold = 0.1, writeDiff = true } = {}) {
  if (a.equals(b)) {
    const { width, height } = PNG.sync.read(a);
    return { ratio: 0, differentPixels: 0, totalPixels: width * height, sameSize: true, diff: null };
  }
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);
  const width = Math.max(imgA.width, imgB.width);
  const height = Math.max(imgA.height, imgB.height);
  const sameSize = imgA.width === imgB.width && imgA.height === imgB.height;
  const padded = (/** @type {PNG} */ img) => {
    if (img.width === width && img.height === height) return img.data;
    const out = new PNG({ width, height });
    out.data.fill(0);
    PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
    return out.data;
  };
  const out = writeDiff ? new PNG({ width, height }) : null;
  const differentPixels = pixelmatch(padded(imgA), padded(imgB), out ? out.data : undefined, width, height, { threshold });
  const totalPixels = width * height;
  return {
    ratio: differentPixels / totalPixels,
    differentPixels,
    totalPixels,
    sameSize,
    diff: out && differentPixels > 0 ? PNG.sync.write(out) : null,
  };
}
