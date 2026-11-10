#!/usr/bin/env node
/**
 * mobile/assets/brand/welcome-hero.jpg, the bundled photo of FS-1 (AUTH-02). Admin can override it at runtime
 * (branding.welcome_hero).
 *
 * The source is 2:3 with the car at 58 to 80 % of its height, which is where FS-1 puts the buttons. So the sky above goes
 * and the ground below it is continued by mirroring: on a phone the car then ends above the bottom block, the logo sits in
 * the dark alley above it, and what was added lies under the solid part of the scrim. No filter, no brightening (§7).
 *
 *   node design/scripts/build-welcome-hero.mjs
 */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = join(root, 'design', 'seed-photos', 'generic-exterior-01.jpg');
const target = join(root, 'mobile', 'assets', 'brand', 'welcome-hero.jpg');

const SOURCE = { width: 1282, height: 1920 };
/** Of the source: where the crop starts, and how much ground is added below: the car then spans about 42 to 63 % of the
 * result. The mirror reflects only the even ground below 1570, never the car or its shadow: the shadow's soft edge ends
 * at about 1568, and mirroring it drew a dark arc along the bottom of the screen (DQ-118). */
const CROP_TOP = 270;
const GROUND_ADDED = 350;
const OUTPUT_WIDTH = 1170;
const QUALITY = 68;

const extended = await sharp(source)
  .extract({ left: 0, top: CROP_TOP, width: SOURCE.width, height: SOURCE.height - CROP_TOP })
  .extend({ bottom: GROUND_ADDED, extendWith: 'mirror' })
  .toBuffer();

await sharp(extended)
  .resize({ width: OUTPUT_WIDTH, kernel: 'lanczos3' })
  .jpeg({ quality: QUALITY, mozjpeg: true, progressive: true })
  .toFile(target);

const { width, height } = await sharp(target).metadata();
console.log(`${target}: ${width} x ${height}, ${Math.round(statSync(target).size / 1024)} KB`);
