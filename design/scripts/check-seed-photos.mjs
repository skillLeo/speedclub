#!/usr/bin/env node
// check-seed-photos: the seed photo gate for design/seed-photos (docs/03_DESIGN_SYSTEM.md). Node >= 18, no dependencies.
//
// 1. Every photo in the folder has exactly one manifest.json entry and exactly one CREDITS.md table row, and every
//    entry and row names a photo that exists. Nothing else lives in the folder besides CREDITS.md and manifest.json.
// 2. Every photo is a baseline or progressive JPEG (checked from its bytes, not its name), at most 2400 px on the long
//    edge, without EXIF (so no GPS either), XMP or IPTC metadata. The manifest's width/height match the file.
// 3. Every manifest entry carries the fields the seeders read, with a known kind/category and the Unsplash or Pexels
//    licence; every CREDITS row has a subject, a photographer, a source URL and a licence.
// 4. Every manifest entry has a ThumbHash (base64) from design/scripts/process-photos.mjs (09 §4.6). Its output folder
//    processed/ (gitignored) is the one folder allowed next to the photos.
//
// Usage: node design/scripts/check-seed-photos.mjs [--dir <seed photo folder>]     exit 0 = ok, 1 = problems
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const dir = resolve(dirFlag >= 0 && args[dirFlag + 1] ? args[dirFlag + 1] : join(here, '..', 'seed-photos'));

const MAX_EDGE = 2400;
// Finder/Explorer junk and the folder placeholder are not photos.
const OS_JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.gitkeep']);
const OWN_FILES = new Set(['CREDITS.md', 'manifest.json']);
// The graded AVIF/WebP/JPEG renditions of process-photos.mjs (gitignored).
const OUTPUT_DIR = 'processed';
const LICENCES = new Set(['Unsplash License', 'Pexels License']);
const KINDS = new Set(['exterior', 'interior', 'engine', 'wheel', 'detail', 'cover']);
const CATEGORIES = new Set(['exterior', 'interior', 'engine', 'wheels', 'detail', 'other']);
const REQUIRED = ['file', 'kind', 'make', 'model', 'generation', 'colour', 'angle', 'plate_blurred', 'photographer', 'source_url', 'licence',
  'category', 'focal', 'alt_de', 'alt_en', 'night', 'width', 'height'];
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{2}\.jpg$/;

const problems = [];
const fail = (message) => problems.push(message);
const count = (list) => list.reduce((map, item) => map.set(item, (map.get(item) ?? 0) + 1), new Map());

/** Reads the JPEG markers up to the first scan: dimensions from SOFn, metadata from the APPn segments. */
function inspectJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return { error: 'not a JPEG (no SOI marker)' };
  const info = { width: 0, height: 0, exif: false, xmp: false, iptc: false };
  let offset = 2;

  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return { error: `corrupt marker at byte ${offset}` };
    const marker = buffer[offset + 1];
    if (marker === 0xff) { offset += 1; continue; } // fill byte
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan: no more metadata segments
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; } // standalone markers
    const length = buffer.readUInt16BE(offset + 2);
    const body = buffer.subarray(offset + 4, offset + 2 + length);

    if (marker === 0xe1) {
      if (body.subarray(0, 6).toString('latin1') === 'Exif\0\0') info.exif = true;
      if (body.subarray(0, 29).toString('latin1').startsWith('http://ns.adobe.com/xap/1.0/')) info.xmp = true;
    }
    if (marker === 0xed && body.subarray(0, 14).toString('latin1').startsWith('Photoshop 3.0')) info.iptc = true;
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      info.height = body.readUInt16BE(1);
      info.width = body.readUInt16BE(3);
    }
    offset += 2 + length;
  }

  if (!info.width || !info.height) return { error: 'no frame header (SOF) found' };
  return info;
}

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`check-seed-photos: ${dir} is not a folder`);
  process.exit(1);
}

// --- folder ---------------------------------------------------------------------------------------------------------
const entries = readdirSync(dir).filter((name) => !OS_JUNK.has(name) && name !== OUTPUT_DIR);
const photos = entries.filter((name) => !OWN_FILES.has(name));
for (const name of OWN_FILES) if (!entries.includes(name)) fail(`${name} is missing`);
for (const name of photos) {
  if (!statSync(join(dir, name)).isFile()) fail(`${name}: only files belong in the folder`);
  else if (!name.endsWith('.jpg')) fail(`${name}: not a .jpg photo (only photos, CREDITS.md and manifest.json belong here)`);
  else if (!NAME.test(name)) fail(`${name}: name is not <make>-<model>-<nn>.jpg in lowercase`);
}
const photoSet = new Set(photos);

// --- manifest -------------------------------------------------------------------------------------------------------
let manifest = [];
try {
  const parsed = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  manifest = Array.isArray(parsed) ? parsed : [];
  if (!Array.isArray(parsed)) fail('manifest.json is not an array');
} catch (error) {
  if (existsSync(join(dir, 'manifest.json'))) fail(`manifest.json does not parse: ${error.message}`);
}
const manifestFiles = manifest.map((entry) => entry?.file);
for (const [file, times] of count(manifestFiles)) if (times > 1) fail(`manifest.json lists ${file} ${times} times`);
for (const file of new Set(manifestFiles)) if (!photoSet.has(file)) fail(`manifest.json lists ${file}, which is not in the folder`);
for (const file of photos) if (!manifestFiles.includes(file)) fail(`${file} has no manifest.json entry`);

for (const entry of manifest) {
  const file = entry?.file ?? '(entry without file)';
  for (const key of REQUIRED) if (!(key in (entry ?? {}))) fail(`manifest ${file}: field "${key}" is missing`);
  if (entry?.kind !== undefined && !KINDS.has(entry.kind)) fail(`manifest ${file}: unknown kind "${entry.kind}"`);
  if (entry?.category !== undefined && !CATEGORIES.has(entry.category)) fail(`manifest ${file}: unknown category "${entry.category}"`);
  if (entry?.licence !== undefined && !LICENCES.has(entry.licence)) fail(`manifest ${file}: licence "${entry.licence}" is not allowed`);
  if (entry?.kind && entry.kind !== 'cover' && entry.kind === 'exterior' && !entry.make) fail(`manifest ${file}: an exterior needs a make`);
  if (typeof entry?.plate_blurred !== 'boolean') fail(`manifest ${file}: plate_blurred must be true or false`);
  if (typeof entry?.photographer !== 'string' || !entry.photographer.trim()) fail(`manifest ${file}: photographer is empty`);
  if (typeof entry?.source_url !== 'string' || !/^https:\/\/(unsplash\.com\/photos|www\.pexels\.com\/photo)\//.test(entry.source_url)) {
    fail(`manifest ${file}: source_url is not an Unsplash or Pexels photo page`);
  }
  for (const key of ['alt_de', 'alt_en']) if (typeof entry?.[key] !== 'string' || !entry[key].trim()) fail(`manifest ${file}: ${key} is empty`);
  const thumbhash = typeof entry?.thumbhash === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(entry.thumbhash) ? Buffer.from(entry.thumbhash, 'base64') : null;
  if (thumbhash === null || thumbhash.length < 5 || thumbhash.length > 40) {
    fail(`manifest ${file}: thumbhash is missing or not a ThumbHash (run node design/scripts/process-photos.mjs)`);
  }
  const { x, y } = entry?.focal ?? {};
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) fail(`manifest ${file}: focal x/y must be between 0 and 1`);
}

// --- CREDITS --------------------------------------------------------------------------------------------------------
const rows = [];
if (existsSync(join(dir, 'CREDITS.md'))) {
  for (const line of readFileSync(join(dir, 'CREDITS.md'), 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells[0] === 'File' || /^-+$/.test(cells[0] ?? '')) continue; // header and separator
    rows.push(cells);
  }
}
const creditFiles = rows.map((cells) => cells[0]);
for (const [file, times] of count(creditFiles)) if (times > 1) fail(`CREDITS.md has ${times} rows for ${file}`);
for (const file of new Set(creditFiles)) if (!photoSet.has(file)) fail(`CREDITS.md has a row for ${file}, which is not in the folder`);
for (const file of photos) if (!creditFiles.includes(file)) fail(`${file} has no CREDITS.md row`);
for (const cells of rows) {
  const [file, subject, photographer, url, licence] = cells;
  if (cells.length !== 5) fail(`CREDITS ${file}: expected 5 columns, found ${cells.length}`);
  if (!subject || !photographer || !url) fail(`CREDITS ${file}: subject, photographer and source URL are required`);
  if (!LICENCES.has(licence) && licence !== 'Client-owned') fail(`CREDITS ${file}: licence "${licence}" is not allowed`);
  const entry = manifest.find((item) => item?.file === file);
  if (entry && url && entry.source_url !== url) fail(`${file}: CREDITS.md and manifest.json name different source URLs`);
  if (entry && photographer && entry.photographer !== photographer) fail(`${file}: CREDITS.md and manifest.json name different photographers`);
}

// --- files ----------------------------------------------------------------------------------------------------------
let checked = 0;
for (const file of photos.filter((name) => name.endsWith('.jpg'))) {
  const info = inspectJpeg(readFileSync(join(dir, file)));
  checked += 1;
  if (info.error) { fail(`${file}: ${info.error}`); continue; }
  if (Math.max(info.width, info.height) > MAX_EDGE) fail(`${file}: ${info.width}×${info.height} px, the long edge exceeds ${MAX_EDGE} px`);
  if (info.exif) fail(`${file}: contains EXIF metadata`);
  if (info.xmp) fail(`${file}: contains XMP metadata`);
  if (info.iptc) fail(`${file}: contains IPTC metadata`);
  const entry = manifest.find((item) => item?.file === file);
  if (entry && (entry.width !== info.width || entry.height !== info.height)) {
    fail(`${file}: manifest says ${entry.width}×${entry.height}, the file is ${info.width}×${info.height}`);
  }
}

const where = relative(process.cwd(), dir) || '.';
if (problems.length) {
  console.error(`check-seed-photos: ${problems.length} problem(s) in ${where}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`check-seed-photos: ok — ${checked} photos in ${where}, each with one manifest entry and one CREDITS row; all JPEG, ≤ ${MAX_EDGE} px, no EXIF/XMP/IPTC.`);
