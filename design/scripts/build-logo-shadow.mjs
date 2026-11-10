#!/usr/bin/env node
/**
 * mobile/assets/brand/logo-wide-shadow.png: the soft shadow that protects the white wordmark on a Welcome photo chosen in
 * the admin (FS-1, AUTH-02; DQ-109, DQ-139). It is derived from the client's file and never redrawn: the logo's own
 * alpha, spread a little and blurred, in black. Following the letters, it reads as the logo's shadow and never as a shape
 * of its own, as a band or an ellipse behind the logo did.
 *
 * Two layers: a close one (the ink spread by 3 and blurred by 10, at most 50 %; DQ-143 tightened it from 6 and 14, with the
 * gain raised so the black under the ink stays as it was) carries the contrast up to the last brush
 * tip without reading as an outline, and a wide one (blurred by 32, at most 22 %) lets it fade out. Sizes are in points of a 320-wide logo; the file is
 * drawn at 2x. The canvas has PAD on every side, where the shadow has faded to nothing: the app draws it centred on the
 * logo, PAD wider on each side (WelcomeScreen LOGO_SHADOW_PAD, as a share of the logo's width).
 *
 * The script checks what it promises: under every ink pixel of the logo at least 42 % black, which keeps white ink at
 * 3:1 on a white photo, never more than the photo scrim's 72 %, and nothing left at the canvas edge.
 *
 *   node design/scripts/build-logo-shadow.mjs
 */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = join(root, 'mobile', 'assets', 'brand', 'logo-wide-white.png');
const target = join(root, 'mobile', 'assets', 'brand', 'logo-wide-shadow.png');

/** Logo width in points the sizes below refer to, and the scale the file is drawn at. */
const LOGO_POINTS = 320;
const SCALE = 2;
/** Share of the logo's width the canvas adds on each side: 96 pt at 320, three times the wide blur. Keep equal to
 * LOGO_SHADOW_PAD in WelcomeScreen. */
const PAD_SHARE = 0.3;
const CLOSE = { spread: 3, blur: 10, gain: 3, max: 0.5 };
const WIDE = { blur: 32, gain: 1, max: 0.22 };
/** Black over white at this alpha leaves white ink at 3:1; the photo scrim's end colour is 72 % black. */
const MIN_UNDER_INK = 0.42;
const MAX_ALPHA = 0.72;

const logoWidth = LOGO_POINTS * SCALE;
const { width: fileWidth, height: fileHeight } = await sharp(source).metadata();
const logoHeight = Math.round((logoWidth * fileHeight) / fileWidth);
const pad = Math.round(LOGO_POINTS * PAD_SHARE * SCALE);
const width = logoWidth + 2 * pad;
const height = logoHeight + 2 * pad;

const ink = await sharp(source).resize(logoWidth, logoHeight, { kernel: 'lanczos3' }).ensureAlpha().extractChannel(3).raw().toBuffer();
const mask = Buffer.alloc(width * height);
for (let y = 0; y < logoHeight; y += 1) ink.copy(mask, (y + pad) * width + pad, y * logoWidth, (y + 1) * logoWidth);

/** Square max filter: every pixel takes the strongest ink within `radius`. */
function spread(src, radius) {
  const rows = Buffer.alloc(src.length);
  const out = Buffer.alloc(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let max = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k += 1) max = Math.max(max, src[y * width + k]);
      rows[y * width + x] = max;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let max = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k += 1) max = Math.max(max, rows[k * width + x]);
      out[y * width + x] = max;
    }
  }
  return out;
}

const blur = (src, sigma) =>
  sharp(src, { raw: { width, height, channels: 1 } })
    .blur(sigma)
    .extractChannel(0)
    .raw()
    .toBuffer();

const close = await blur(spread(mask, CLOSE.spread * SCALE), CLOSE.blur * SCALE);
const wide = await blur(mask, WIDE.blur * SCALE);

const rgba = Buffer.alloc(width * height * 4);
let underInk = 1;
let strongest = 0;
let edge = 0;
for (let i = 0; i < width * height; i += 1) {
  const near = Math.min(CLOSE.max, (CLOSE.gain * close[i]) / 255);
  const far = Math.min(WIDE.max, (WIDE.gain * wide[i]) / 255);
  const alpha = 1 - (1 - near) * (1 - far);
  const byte = Math.round(alpha * 255);
  rgba[i * 4 + 3] = byte;
  strongest = Math.max(strongest, byte / 255);
  if (mask[i] > 127) underInk = Math.min(underInk, byte / 255);
  const x = i % width;
  const y = Math.floor(i / width);
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = Math.max(edge, byte);
}

const problems = [];
if (underInk < MIN_UNDER_INK) problems.push(`only ${underInk.toFixed(3)} black under the ink, needs ${MIN_UNDER_INK}`);
if (strongest > MAX_ALPHA) problems.push(`${strongest.toFixed(3)} black at most, the scrim allows ${MAX_ALPHA}`);
if (edge > 0) problems.push(`${edge}/255 left at the canvas edge`);
if (problems.length > 0) {
  console.error(`✖ ${problems.join('; ')}`);
  process.exit(1);
}

await sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, palette: false }).toFile(target);
console.log(
  `${target}: ${width} x ${height}, ${Math.round(statSync(target).size / 1024)} KB; under the ink at least ${underInk.toFixed(3)}, at most ${strongest.toFixed(3)}`,
);
