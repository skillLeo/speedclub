#!/usr/bin/env node
// process-photos: the editorial/sample photo pipeline of 09 §4.6 for design/seed-photos (dev machine only, never on a host).
//
// For every photo of manifest.json (licensed seed photos = editorial/sample content only; member uploads never pass through here):
//   1. Grade, the one look of every sample photo: saturation 0.92, contrast +6 % around mid grey, black point lifted by 2.5 % (≤ 3 %).
//      Two passes, so the lift applies to what the contrast clipped (one linear() could not keep the lifted black).
//   2. Write AVIF, WebP and JPEG at widths 480, 960, 1440 and 2048 (never enlarged) into design/seed-photos/processed/ (gitignored):
//      <stem>-<width>.<ext>. Metadata is stripped (sharp's default), sRGB out. The seeders import <stem>-2048.jpg.
//   3. Compute a ThumbHash of the graded image (base64, the form expo-image's `placeholder={{ thumbhash }}` takes) and write it into the
//      manifest entry as `thumbhash`; a missing focal point is filled from sharp's attention strategy (hand-set ones are kept).
//
// Idempotent: processed/.state.json keeps a hash of each input file and of the grade settings; an unchanged photo whose outputs all exist
// is skipped, so a second run writes nothing. manifest.json is only rewritten when a value changed.
//
// Usage: node design/scripts/process-photos.mjs [--dir <seed photo folder>] [--check] [--only <file>] [--concurrency <n>]
//   --check  writes nothing: exit 1 when a photo is new or changed, an output is missing, or a manifest thumbhash is missing or stale.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const dir = resolve(option('--dir') ?? join(here, '..', 'seed-photos'));
const out = join(dir, 'processed');
const check = args.includes('--check');
const only = option('--only');
const concurrency = Math.max(1, Number(option('--concurrency') ?? 2));

// 09 §4.6. Changing any value here re-processes every photo (the settings are part of each photo's hash).
export const GRADE = { saturation: 0.92, contrast: 0.06, blackLift: 0.025 };
export const WIDTHS = [480, 960, 1440, 2048];
const FORMATS = {
  avif: (image) => image.avif({ quality: 52, effort: 4, chromaSubsampling: '4:2:0' }),
  webp: (image) => image.webp({ quality: 80, effort: 5 }),
  jpg: (image) => image.jpeg({ quality: 84, progressive: true, mozjpeg: true }),
};
const SETTINGS = JSON.stringify({ GRADE, WIDTHS, formats: Object.keys(FORMATS), v: 2 });
const STATE = join(out, '.state.json');

const stem = (file) => file.replace(/\.jpe?g$/i, '');
export const outputName = (file, width, ext) => `${stem(file)}-${width}.${ext}`;
const outputs = (file) => WIDTHS.flatMap((width) => Object.keys(FORMATS).map((ext) => outputName(file, width, ext)));
const hashOf = (buffer) => createHash('sha256').update(SETTINGS).update(buffer).digest('hex');

/**
 * The graded full-size image as raw RGB: saturation and contrast in pass one, the black point lift on its clipped result in pass two.
 * The lift (x → x·(1 − l) + 255·l) also flattens the slope by (1 − l), so pass one steepens by (1 + contrast) / (1 − l): the net slope
 * is exactly 1 + contrast (review of 3bf1d0c: it was 1.06 × 0.975 ≈ 1.034).
 */
export async function grade(input) {
  const a = (1 + GRADE.contrast) / (1 - GRADE.blackLift);
  const first = await sharp(input)
    .rotate()
    .toColourspace('srgb')
    .removeAlpha()
    .modulate({ saturation: GRADE.saturation })
    .linear(a, 128 * (1 - a))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const lift = 255 * GRADE.blackLift;
  const raw = { width: first.info.width, height: first.info.height, channels: first.info.channels };
  const second = await sharp(first.data, { raw }).linear(1 - GRADE.blackLift, lift).raw().toBuffer();

  return { data: second, raw };
}

async function thumbhash(graded) {
  const { data, info } = await sharp(graded.data, { raw: graded.raw })
    .resize({ width: 100, height: 100, fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64');
}

async function attentionFocal(graded) {
  const side = 200;
  const scale = side / Math.min(graded.raw.width, graded.raw.height);
  const { info } = await sharp(graded.data, { raw: graded.raw })
    .resize({ width: side, height: side, fit: 'cover', position: 'attention' })
    .toBuffer({ resolveWithObject: true });
  const round = (value) => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;

  return {
    x: round((info.attentionX ?? side / 2) / (graded.raw.width * scale)),
    y: round((info.attentionY ?? side / 2) / (graded.raw.height * scale)),
  };
}

async function writeOutputs(file, graded) {
  for (const width of WIDTHS) {
    const resized = await sharp(graded.data, { raw: graded.raw })
      .resize({ width, withoutEnlargement: true, kernel: 'lanczos3' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    for (const [ext, encode] of Object.entries(FORMATS)) {
      const target = join(out, outputName(file, width, ext));
      const temporary = `${target}.tmp`;
      await encode(sharp(resized.data, { raw: { width: resized.info.width, height: resized.info.height, channels: resized.info.channels } })).toFile(temporary);
      renameSync(temporary, target);
    }
  }
}

async function main() {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`process-photos: ${manifestPath} is missing`);
    process.exit(1);
  }

  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
  const nextState = { ...state };
  const problems = [];
  let processed = 0;
  let skipped = 0;

  const queue = manifest.filter((entry) => typeof entry?.file === 'string' && (only === undefined || entry.file === only));

  async function work(entry) {
    const input = join(dir, entry.file);
    if (!existsSync(input)) {
      problems.push(`${entry.file}: listed in the manifest but missing`);
      return;
    }

    const hash = hashOf(readFileSync(input));
    const complete = outputs(entry.file).every((name) => existsSync(join(out, name)));
    const current = state[entry.file]?.hash === hash && complete && typeof entry.thumbhash === 'string'
      && state[entry.file]?.thumbhash === entry.thumbhash;

    if (current) {
      skipped++;
      return;
    }

    if (check) {
      problems.push(`${entry.file}: ${state[entry.file]?.hash !== hash ? 'new or changed' : !complete ? 'outputs missing' : 'thumbhash missing or stale'}`);
      return;
    }

    const graded = await grade(input);
    if (state[entry.file]?.hash !== hash || !complete) await writeOutputs(entry.file, graded);
    entry.thumbhash = await thumbhash(graded);
    if (!entry.focal || typeof entry.focal.x !== 'number' || typeof entry.focal.y !== 'number') entry.focal = await attentionFocal(graded);
    nextState[entry.file] = { hash, thumbhash: entry.thumbhash };
    processed++;
  }

  if (!check) mkdirSync(out, { recursive: true });
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const entry = queue.shift();
      try {
        await work(entry);
      } catch (error) {
        problems.push(`${entry.file}: ${error.message}`);
      }
    }
  });
  await Promise.all(workers);

  // Photos the manifest no longer lists leave the state (their outputs stay until someone deletes the folder: harmless, never imported).
  const listed = new Set(manifest.map((entry) => entry?.file));
  for (const file of Object.keys(nextState)) if (!listed.has(file)) delete nextState[file];

  if (!check) {
    const text = `${JSON.stringify(manifest, null, 4)}\n`;
    if (text !== manifestText) writeFileSync(manifestPath, text);
    writeFileSync(STATE, `${JSON.stringify(nextState, null, 1)}\n`);
  }

  if (problems.length > 0) {
    console.error(`process-photos${check ? ' --check' : ''}: ${problems.length} problem(s)`);
    for (const problem of problems.slice(0, 50)) console.error(`  - ${problem}`);
    if (problems.length > 50) console.error(`  … and ${problems.length - 50} more`);
    process.exit(1);
  }

  console.log(check ? `process-photos --check: ${skipped} photo(s) current` : `process-photos: ${processed} processed, ${skipped} unchanged → ${out}`);
}

// Run only as a script, so the test can import grade() without processing the library.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
