#!/usr/bin/env node
// check-fonts: the fast fonts gate (ADR-402, docs/09_PREMIUM_2_0.md §4.2). Node >= 18, no dependencies, no Python.
//
// 1. Every file under design/fonts matches manifest.json (bytes + SHA-256); nothing unlisted, nothing missing.
// 2. manifest.json, fonts.lock.json and design/scripts/requirements-fonts.txt agree: same sources, recipe, faces and tool
//    pins; the release TTFs and the licence texts are the pinned bytes.
// 3. The font properties the build recorded hold: file name = PostScript name, family = CSS family, weight/width
//    classes, full coverage of each file's character set, functional tnum, kern, no variation tables, and fonts.css has
//    one font-display: swap rule per woff2.
// 4. Every copy the products ship (COPIES: the Blade/admin woff2, the GD/dompdf TTFs, the native TTFs, the member web woff2, and the
//    OFL texts beside each) is byte for byte the manifest entry of the same file name; a copy folder holds nothing else.
// The deep check (re-reads every font, re-derives web/ and fonts.css from ttf/) is
// `python3 -I design/scripts/build-fonts.py --check`.
//
// Usage: node design/scripts/check-fonts.mjs [--dir <fonts folder>] [--root <repo folder>]     exit 0 = ok, 1 = problems
//   --root: where the copies of step 4 are looked up (default: this repo); for a scratch copy of the repo.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Created by Finder/Explorer and gitignored; never part of the font set.
const OS_JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const FONT_KINDS = new Set(['ttf', 'woff2', 'woff2-latin-ext']);
// Step 4: each folder the products load fonts from, relative to the repo, and which design/fonts folder each file type comes from.
// Sub-folders are separate entries (resources/fonts/2.0, assets/fonts/web), so a folder is read flat.
const COPIES = [
  { folder: 'web/resources/fonts/2.0', from: { '.woff2': 'web', '.txt': 'licences' } },
  { folder: 'web/resources/fonts', from: { '.ttf': 'ttf', '.txt': 'licences' } },
  { folder: 'mobile/assets/fonts', from: { '.ttf': 'ttf', '.txt': 'licences' } },
  { folder: 'mobile/assets/fonts/web', from: { '.woff2': 'web', '.txt': 'licences' } },
];

const problems = [];
let copies = 0;
const fail = (message) => problems.push(message);
const show = (path) => relative(process.cwd(), path) || '.';
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
// Key-order-insensitive equality, like Python's dict comparison in build-fonts.py.
const canon = (v) =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
      : JSON.stringify(v);
const same = (a, b) => canon(a) === canon(b);

function parseArgs(argv) {
  let dir = resolve(here, '../fonts');
  let root = resolve(here, '../..');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = resolve(argv[(i += 1)]);
    else if (argv[i] === '--root' && argv[i + 1]) root = resolve(argv[(i += 1)]);
    else {
      console.error(`check-fonts: unknown argument ${argv[i]}\nUsage: node design/scripts/check-fonts.mjs [--dir <fonts folder>] [--root <repo folder>]`);
      process.exit(1);
    }
  }
  return { dir, root };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${show(path)}: ${error.code === 'ENOENT' ? 'missing' : error.message}`);
    return null;
  }
}

function walk(root, dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (OS_JUNK.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const name = relative(root, full).split(sep).join('/');
    if (entry.isSymbolicLink()) fail(`${name}: symlinks are not allowed`);
    else if (entry.isDirectory()) walk(root, full, out);
    else out.push(name);
  }
  return out;
}

const { dir, root } = parseArgs(process.argv.slice(2));
const manifest = existsSync(dir) ? readJson(join(dir, 'manifest.json')) : (fail(`${show(dir)}: no such folder`), null);
const lock = manifest ? readJson(join(dir, 'fonts.lock.json')) : null;
const files = new Map((manifest?.files ?? []).map((f) => [f.path, f]));

if (manifest && lock) {
  // 1. files against manifest.json
  const seen = new Set();
  for (const name of walk(dir)) {
    if (name === 'manifest.json') continue;
    seen.add(name);
    const entry = files.get(name);
    if (!entry) {
      fail(`${name}: not listed in manifest.json`);
      continue;
    }
    const data = readFileSync(join(dir, name));
    if (data.length !== entry.bytes) fail(`${name}: ${data.length} bytes, manifest.json says ${entry.bytes}`);
    else if (sha256(data) !== entry.sha256) fail(`${name}: SHA-256 differs from manifest.json`);
  }
  for (const name of files.keys()) if (!seen.has(name)) fail(`${name}: listed in manifest.json but missing`);

  // 2. manifest.json, lock and requirements agree
  if (manifest.schema !== 1 || lock.schema !== 1) fail('manifest.json and fonts.lock.json must both be schema 1');
  if (!same(manifest.build, lock.build)) fail('manifest.json build recipe differs from fonts.lock.json build (rebuild)');
  for (const [family, members] of [['inter', 'faces'], ['archivo', 'instances']]) {
    const { [members]: _members, ...source } = lock[family] ?? {};
    if (!same(manifest.sources?.[family], source)) fail(`manifest.json sources.${family} differs from fonts.lock.json (rebuild)`);
  }
  const pick = (f) => ({ postScriptName: f.postScriptName, cssFamily: f.cssFamily, weight: f.weight, widthClass: f.widthClass });
  const lockFaces = [...(lock.inter?.faces ?? []), ...(lock.archivo?.instances ?? [])];
  if (!same((manifest.faces ?? []).map(pick), lockFaces.map(pick))) {
    fail("manifest.json faces differ from the lock's faces and instances (rebuild)");
  }
  for (const face of manifest.faces ?? []) {
    const ps = face.postScriptName;
    const want = { ttf: `ttf/${ps}.ttf`, woff2: `web/${ps}.woff2`, ...(lock.build?.latinExtFiles ? { woff2LatinExt: `web/${ps}-latin-ext.woff2` } : {}) };
    if (!same(face.files, want)) fail(`manifest.json faces[${ps}].files should be ${JSON.stringify(want)}`);
    for (const path of Object.values(want)) if (!files.has(path)) fail(`${path}: expected by the lock, not in manifest.json files`);
  }
  for (const face of lock.inter?.faces ?? []) {
    const entry = files.get(`ttf/${face.postScriptName}.ttf`);
    if (entry && entry.sha256 !== face.sha256) fail(`ttf/${face.postScriptName}.ttf is not the pinned release file`);
  }
  for (const licence of [lock.inter?.licence, lock.archivo?.licence]) {
    const entry = files.get(`licences/${licence?.as}`);
    if (!entry || entry.sha256 !== licence?.sha256) fail(`licences/${licence?.as}: missing or not the pinned licence text`);
  }
  if (!files.has('fonts.lock.json')) fail('fonts.lock.json is not listed in manifest.json');
  const requirements = lock.tools?.requirements ?? [];
  for (const requirement of requirements) {
    const [name, version] = requirement.split('==');
    if (!/^[A-Za-z0-9._-]+==[^=\s]+$/.test(requirement)) fail(`fonts.lock.json tools.requirements must pin with '==': ${requirement}`);
    else if (manifest.tools?.[name] !== version) fail(`manifest.json was built with ${name} ${manifest.tools?.[name]}, the lock pins ${version}`);
  }
  const requirementsFile = join(here, 'requirements-fonts.txt');
  const pinned = existsSync(requirementsFile)
    ? readFileSync(requirementsFile, 'utf8').split(/\r?\n/).map((line) => line.replace(/#.*/, '').trim()).filter(Boolean)
    : [];
  if (!same([...pinned].sort(), [...requirements].sort())) {
    fail(`${show(requirementsFile)} and fonts.lock.json tools.requirements pin different tools`);
  }

  // 3. recorded font properties
  const faces = new Map((manifest.faces ?? []).map((f) => [f.postScriptName, f]));
  const charset = { ttf: 'spec', woff2: (lock.build?.primaryCharsets ?? []).join('+'), 'woff2-latin-ext': 'latinExt' };
  const familyWeights = (manifest.faces ?? []).map((f) => `${f.cssFamily} ${f.weight}`);
  if (new Set(familyWeights).size !== familyWeights.length) fail(`duplicate CSS family + weight in manifest.json faces`);
  for (const entry of manifest.files ?? []) {
    if (!FONT_KINDS.has(entry.kind)) continue;
    const font = entry.font ?? {};
    const names = font.names ?? {};
    const folder = entry.kind === 'ttf' ? 'ttf/' : 'web/';
    const stem = entry.path.slice(folder.length).replace(/\.(ttf|woff2)$/, '').replace(/-latin-ext$/, '');
    const face = faces.get(stem);
    if (!entry.path.startsWith(folder) || !face) {
      fail(`${entry.path}: not a file of a face in manifest.json`);
      continue;
    }
    if (names.postScriptName !== stem) fail(`${entry.path}: PostScript name ${names.postScriptName}, the file name says ${stem}`);
    if (names.family !== face.cssFamily) fail(`${entry.path}: family ${names.family} is not the CSS family ${face.cssFamily}`);
    if (font.usWeightClass !== face.weight || font.usWidthClass !== face.widthClass) {
      fail(`${entry.path}: usWeightClass/usWidthClass ${font.usWeightClass}/${font.usWidthClass}, expected ${face.weight}/${face.widthClass}`);
    }
    if (font.coverage?.charset !== charset[entry.kind]) fail(`${entry.path}: covers ${font.coverage?.charset}, expected ${charset[entry.kind]}`);
    if (font.coverage?.missing !== '') fail(`${entry.path}: missing characters ${font.coverage?.missing}`);
    if (!Array.isArray(font.variationTables) || font.variationTables.length) fail(`${entry.path}: variation tables left`);
    if (entry.kind !== 'woff2-latin-ext' && font.tnum?.functional !== true) fail(`${entry.path}: tnum not functional`);
    for (const feature of entry.kind === 'woff2-latin-ext' ? ['kern'] : ['tnum', 'kern']) {
      if (!(font.features ?? []).includes(feature)) fail(`${entry.path}: no ${feature}`);
    }
  }
  const css = existsSync(join(dir, 'fonts.css')) ? readFileSync(join(dir, 'fonts.css'), 'utf8') : '';
  const rules = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  const woff2 = [...files.values()].filter((f) => f.kind === 'woff2' || f.kind === 'woff2-latin-ext').map((f) => f.path);
  if (rules.length !== woff2.length) fail(`fonts.css: ${rules.length} @font-face rules for ${woff2.length} woff2 files`);
  const prefix = lock.build?.cssUrlPrefix ?? '';
  for (const rule of rules) {
    const url = rule.match(/url\("([^"]+)"\)/)?.[1] ?? '';
    if (!/font-display:\s*swap/.test(rule)) fail(`fonts.css: the rule for ${url} lacks font-display: swap`);
    if (!url.startsWith(prefix) || !woff2.includes(`web/${url.slice(prefix.length)}`)) fail(`fonts.css: ${url} is not a woff2 in manifest.json`);
  }

  // 4. the shipped copies against manifest.json
  for (const { folder, from } of COPIES) {
    const path = join(root, folder);
    if (!existsSync(path)) {
      fail(`${folder}: missing (a copy of design/fonts the products load)`);
      continue;
    }
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (OS_JUNK.has(entry.name) || entry.isDirectory()) continue;
      const copy = `${folder}/${entry.name}`;
      const kind = Object.keys(from).find((extension) => entry.name.endsWith(extension));
      const source = kind ? `${from[kind]}/${entry.name}` : null;
      const listed = source ? files.get(source) : undefined;
      if (entry.isSymbolicLink()) fail(`${copy}: symlinks are not allowed`);
      else if (!listed) fail(`${copy}: no file of that name in design/fonts (${source ?? Object.keys(from).join(', ') + ' only'})`);
      else {
        const data = readFileSync(join(path, entry.name));
        copies += 1;
        if (data.length !== listed.bytes || sha256(data) !== listed.sha256) {
          const how = data.length === listed.bytes ? 'SHA-256 differs' : `${data.length} bytes, manifest.json says ${listed.bytes}`;
          fail(`${copy}: differs from design/fonts/${source} (${how}); copy it again from design/fonts`);
        }
      }
    }
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`check-fonts: ${problem}`);
  console.error(`check-fonts: FAILED with ${problems.length} problem(s) in ${show(dir)}`);
  process.exit(1);
}
console.log(`check-fonts: ${files.size} files in ${show(dir)} match manifest.json; fonts.lock.json, requirements-fonts.txt and the manifest agree; ${copies} shipped copies in ${COPIES.length} folders are the manifest's bytes`);
