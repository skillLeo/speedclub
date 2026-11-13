#!/usr/bin/env node
/**
 * SPEED CLUB - staging/production deploy package (05_ARCHITECTURE §19, "Build").
 *
 *   node scripts/dev/package-web.mjs            (or: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-web.ps1)
 *   Options: --keep (keep the staging directory), --allow-dirty (package although mobile/ has uncommitted changes)
 *
 * Steps:
 *   1. clean copy of the COMMITTED web/ tree (git archive --format=tar HEAD web, then tar -xf) into releases/web/.stage-<stamp>
 *      Before that it stops when .gitignore hides a file in a source folder of web/ (e7f9dfb), and after it when a Phase 3 part
 *      is missing (routes/admin, lang/admin de+en, the release register service). docs/RELEASES.md of HEAD goes in as RELEASES.md.
 *   2. composer install --no-dev -o --no-interaction there
 *   3. npm --prefix <stage>/web ci, then run build, then the stage's node_modules is removed. Never a symlink to web/node_modules:
 *      Vite resolves the link, its manifest keys become ../../../../web/node_modules/..., and Vite::asset() in
 *      components/font-preload.blade.php then answers 500 on every public page. The script fails on such a manifest, and on one
 *      that lacks any of the four Vite entries (admin app + css, public app + css).
 *   4. Expo web export with EXPO_PUBLIC_APP_ENV=production and no other EXPO_PUBLIC_* value (none from the shell, none from a
 *      mobile/.env: the member web talks to its own origin) straight into <stage>/web/public/app, always, through the QA lock
 *      (`node scripts/dev/qa-run.mjs node mobile/scripts/export-web.mjs --out=<stage>/web/public/app`; mobile/dist is shared by
 *      every export). web/public/app is never reused: verify and the visual matrix build it as "local", with the QA overrides.
 *      The export comes from the WORKING COPY of mobile/, so the script stops when mobile/ has uncommitted changes
 *      (--allow-dirty packages them anyway, with a warning). It fails when index.html still holds the qa:start block or any
 *      JS file contains "qaTheme" or "qaFlags" (security round 3, SEC-P3-26: every QA override is compiled out of production).
 *   5. speedclub/PACKAGE_INFO.txt (above public/): commit, mobile/ clean or dirty, legal placeholders, build time
 *   6. zip (own writer: zlib.deflateRawSync + zlib.crc32, no dependencies) to <name>.zip.part, renamed at the end to
 *      releases/web/speedclub-web-<versionName>-<yyyyMMdd-HHmm>.zip + .sha256. With --allow-dirty and a dirty mobile/ the name
 *      ends in -DIRTY.zip, so that a throwaway package cannot be mistaken for a real one later. The script fails when a built
 *      file (public/app, public/build) would be left out or when the member web bundle names an asset the package does not
 *      hold: the server cannot rebuild anything, and every status-code smoke test would still be green.
 *
 * The zip has one top-level folder, speedclub/, whose public/ is the document root. Zero dependencies, Node >= 22.2 (zlib.crc32).
 * On failure the stage folder (unless --keep) and the .part file are removed.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync,
  statSync, writeFileSync, writeSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = new Set(process.argv.slice(2));
const known = new Set(['--keep', '--allow-dirty']);
for (const a of args) {
  if (!known.has(a)) {
    console.error(`unknown option ${a} (known: ${[...known].join(', ')})`);
    process.exit(2);
  }
}
const win = process.platform === 'win32';
const gitBase = ['-c', `safe.directory=${root}`];

if (typeof zlib.crc32 !== 'function') {
  console.error(`zlib.crc32 is missing in Node ${process.version}; Node 22.2 or newer is required.`);
  process.exit(1);
}

// Set below; die() cleans them up.
let stageRoot = '';
let partPath = '';
let partFd = null;

function die(message, code = 1) {
  console.error(`FAILED: ${message}`);
  if (partFd !== null) { try { closeSync(partFd); } catch { /* already closed */ } partFd = null; }
  if (partPath) rmSync(partPath, { force: true });
  if (stageRoot && !args.has('--keep')) rmSync(stageRoot, { recursive: true, force: true });
  else if (stageRoot) console.error(`stage kept: ${stageRoot}`);
  process.exit(code || 1);
}

// Anything thrown after the stage exists (fs errors, a broken input file) ends the same way as a checked failure.
process.on('uncaughtException', (err) => die(err?.stack ?? String(err)));

function run(label, cmd, cmdArgs, options = {}) {
  console.log(`\n==> ${label}\n    $ ${cmd} ${cmdArgs.join(' ')}`);
  const exe = win && ['npm', 'npx', 'composer'].includes(cmd) ? (cmd === 'composer' ? 'composer.bat' : `${cmd}.cmd`) : cmd;
  const r = spawnSync(exe, cmdArgs, { stdio: 'inherit', shell: win && exe !== cmd, ...options });
  if (r.error) die(`${label}: could not start ${exe}: ${r.error.message}`);
  if (r.status !== 0) die(`${label} (exit ${r.status ?? r.signal})`, r.status || 1);
}

function git(gitArgs) {
  const r = spawnSync('git', [...gitBase, ...gitArgs], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) die(`git ${gitArgs.join(' ')}: ${r.error.message}`);
  if (r.status !== 0) die(`git ${gitArgs.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const version = JSON.parse(readFileSync(join(root, 'mobile', 'version.json'), 'utf8')).versionName;
const outDir = join(root, 'releases', 'web');

const commit = git(['rev-parse', '--short', 'HEAD']);
const commitFull = git(['rev-parse', 'HEAD']);
console.log(`SPEED CLUB web package - version ${version}, commit ${commit}`);
if (git(['status', '--porcelain', '--', 'web']) !== '') {
  console.log('NOTE: web/ has uncommitted changes. They are NOT in the package: web/ is built from the committed tree (HEAD).');
}
// public/app is exported from the working copy of mobile/, not from HEAD.
const mobileDirty = git(['status', '--porcelain', '--', 'mobile']);
if (mobileDirty !== '') {
  const files = mobileDirty.split('\n');
  const list = files.slice(0, 20).map((l) => `      ${l}`).join('\n');
  const more = files.length > 20 ? `\n      ... and ${files.length - 20} more` : '';
  if (!args.has('--allow-dirty')) {
    console.error(`mobile/ has ${files.length} uncommitted change(s). public/app is exported from the working copy, so the package\n`
      + `would not match commit ${commit}. Commit first, or pass --allow-dirty for a throwaway package.\n${list}${more}`);
    process.exit(1);
  }
  console.log('\n################################################################');
  console.log(`WARNING (--allow-dirty): mobile/ has ${files.length} uncommitted change(s). public/app in this package is built from`);
  console.log(`the WORKING COPY of mobile/, not from commit ${commit}. Do not deploy this package.`);
  console.log(`${list}${more}`);
  console.log('################################################################');
}

// web/ comes from `git archive`, so a source file that .gitignore hides is silently missing from the package. That happened twice
// (e7f9dfb: a bare `releases/` hid web/app/Services/Releases, a bare `auth.json` hid web/lang/admin/*/auth.json). Any ignored file
// inside a source folder of web/ stops the build; generated folders (vendor, node_modules, public/app|build|storage, storage,
// bootstrap/cache, test reports) and OS litter are expected to be ignored.
const SOURCE_DIRS = ['app/', 'bootstrap/', 'config/', 'database/', 'lang/', 'public/', 'resources/', 'routes/'];
const GENERATED = /^(bootstrap\/cache\/|public\/(app|build|storage|hot)(\/|$)|database\/.*\.sqlite3?$)/;
const hiddenSources = git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--', 'web'])
  .split('\n')
  .filter(Boolean)
  .map((path) => path.replace(/^web\//, ''))
  .filter((rel) => SOURCE_DIRS.some((dir) => rel.startsWith(dir)) && !GENERATED.test(rel) && !/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(rel));
if (hiddenSources.length > 0) {
  console.error(`${hiddenSources.length} file(s) in a source folder of web/ are hidden by .gitignore, so git archive would leave them out:`);
  for (const rel of hiddenSources.slice(0, 20)) console.error(`      web/${rel}`);
  console.error('Anchor the matching .gitignore rule (see e7f9dfb), commit the files, then build again.');
  process.exit(1);
}

const zipName = `speedclub-web-${version}-${stamp}${mobileDirty !== '' ? '-DIRTY' : ''}.zip`;
const zipPath = join(outDir, zipName);

stageRoot = join(outDir, `.stage-${stamp}`);
const stageWeb = join(stageRoot, 'web');
mkdirSync(outDir, { recursive: true });
rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });

// 1. clean copy of the committed tree (no sh pipe: Windows has none; tar ships with Windows 10+ and macOS)
const tarFile = join(stageRoot, 'web.tar');
run('git archive HEAD web', 'git', [...gitBase, 'archive', '--format=tar', '-o', tarFile, 'HEAD', 'web'], { cwd: root });
run('tar -xf web.tar', 'tar', ['-xf', 'web.tar'], { cwd: stageRoot });
rmSync(tarFile, { force: true });
if (!existsSync(join(stageWeb, 'artisan'))) die('git archive produced no web/artisan');

// Phase 3 parts that a wrong ignore rule or a forgotten `git add` has dropped before (ADR-167: refuse an incomplete package).
for (const rel of ['routes/admin.php', 'routes/staff.php', 'app/Services/Releases/ReleaseRegister.php', 'resources/js/admin/app.ts',
  'resources/css/admin.css', 'app/Console/Commands/DoctorCommand.php']) {
  if (!existsSync(join(stageWeb, rel))) die(`the committed web/ tree has no ${rel}`);
}
const adminRoutes = readdirSync(join(stageWeb, 'routes', 'admin')).filter((f) => f.endsWith('.php'));
if (adminRoutes.length === 0) die('the committed web/ tree has no routes/admin/*.php');
const adminLang = (locale) => {
  const dir = join(stageWeb, 'lang', 'admin', locale);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
};
const [adminDe, adminEn] = [adminLang('de'), adminLang('en')];
if (adminDe.length === 0) die('the committed web/ tree has no lang/admin/de/*.json');
const langGap = [...adminDe.filter((f) => !adminEn.includes(f)).map((f) => `en/${f}`), ...adminEn.filter((f) => !adminDe.includes(f)).map((f) => `de/${f}`)];
if (langGap.length > 0) die(`lang/admin lacks ${langGap.join(', ')} (every admin module has one file per locale, ADR-213)`);
console.log(`    committed tree checked: ${adminRoutes.length} admin route file(s), ${adminDe.length} admin string file(s) per locale, release register service present`);

// ADM-38: speedclub:releases-sync reads the build entries of docs/RELEASES.md. The package carries the committed copy above
// public/ (DEPLOY.md 4: php artisan speedclub:releases-sync --path=RELEASES.md).
writeFileSync(join(stageWeb, 'RELEASES.md'), git(['show', 'HEAD:docs/RELEASES.md']) + '\n');

// 2. production dependencies
run('composer install --no-dev -o', 'composer', ['install', '--no-dev', '-o', '--no-interaction', '--no-progress'], { cwd: stageWeb });

// 3. built assets, from a real install of the committed lock file (see the header: a linked node_modules breaks the manifest)
const stageModules = join(stageWeb, 'node_modules');
run('npm ci', 'npm', ['--prefix', stageWeb, 'ci', '--no-audit', '--no-fund'], { cwd: root });
run('npm --prefix web run build', 'npm', ['--prefix', stageWeb, 'run', 'build'], { cwd: root });
rmSync(stageModules, { recursive: true, force: true });
const manifestPath = join(stageWeb, 'public', 'build', 'manifest.json');
if (!existsSync(manifestPath)) die('vite produced no public/build/manifest.json');
const manifestKeys = Object.keys(JSON.parse(readFileSync(manifestPath, 'utf8')));
const outsideKeys = manifestKeys.filter((key) => key.startsWith('../'));
if (outsideKeys.length > 0) die(`public/build/manifest.json has ${outsideKeys.length} key(s) outside web/, for example ${outsideKeys[0]}: Vite::asset() would answer 500`);
// The faces components/font-preload.blade.php asks for: Inter Regular + Archivo SemiExpanded SemiBold on every public page, Inter
// Regular + Medium in the admin (fonts 2.0, ADR-402).
for (const key of ['resources/fonts/2.0/Inter-Regular.woff2', 'resources/fonts/2.0/ArchivoSemiExpanded-SemiBold.woff2', 'resources/fonts/2.0/Inter-Medium.woff2']) {
  if (!manifestKeys.includes(key)) die(`public/build/manifest.json has no key ${key}: Vite::asset() would answer 500`);
}
// The four Vite inputs (vite.config.ts): the admin (Inertia) and the public Blade pages load them through @vite.
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
for (const input of ['resources/js/admin/app.ts', 'resources/css/admin.css', 'resources/css/public.css', 'resources/js/public/app.ts']) {
  if (!manifest[input]?.isEntry) die(`public/build/manifest.json has no entry ${input}: the ${input.includes('admin') ? 'admin' : 'public pages'} would answer 500`);
}
console.log(`    manifest checked: ${manifestKeys.length} keys, none outside web/, font-preload keys and the four entries (admin + public) present`);

// 4. Expo web export, production, into the stage (never web/public/app)
const stageApp = join(stageWeb, 'public', 'app');
// Only the app environment reaches the bundle: an EXPO_PUBLIC_API_URL from this shell or a local mobile/.env would make the
// deployed web call that address (client.ts prefers it over the browser origin).
const exportEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^EXPO_PUBLIC_/i.test(key)));
Object.assign(exportEnv, { EXPO_PUBLIC_APP_ENV: 'production', EXPO_NO_DOTENV: '1' });
run('Expo web export, EXPO_PUBLIC_APP_ENV=production (QA lock)', 'node',
  ['scripts/dev/qa-run.mjs', 'node', 'mobile/scripts/export-web.mjs', `--out=${stageApp}`],
  { cwd: root, env: exportEnv });
const appIndex = join(stageApp, 'index.html');
if (!existsSync(appIndex)) die('public/app/index.html is missing after the export');
if (readFileSync(appIndex, 'utf8').includes('qa:start')) die('public/app/index.html still contains the qa:start block: not a production export');
const qaFiles = [];
(function scan(dir) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, d.name);
    if (d.isDirectory()) scan(full);
    else if (/\.(m?js|cjs)$/.test(d.name) && /qaTheme|qaFlags/.test(readFileSync(full, 'utf8'))) qaFiles.push(relative(stageWeb, full));
  }
})(stageApp);
if (qaFiles.length > 0) die(`QA overrides ("qaTheme"/"qaFlags") in the production export: ${qaFiles.join(', ')}`);
console.log('    production export checked: no qa:start block in index.html, no "qaTheme" or "qaFlags" in any JS file');
// The export took minutes, perhaps after a wait for the QA lock. What it read must still be what the name and PACKAGE_INFO.txt say.
if (git(['status', '--porcelain', '--', 'mobile']) !== mobileDirty) die('mobile/ changed while the export ran, so the package would not match what it records. Build it again.');

// 5. what this package is, readable on the server without the build log (above public/, so not reachable from the web)
const legalDir = join(stageWeb, 'database', 'data', 'legal');
const legalOpen = readdirSync(legalDir).filter((f) => f.endsWith('.md') && readFileSync(join(legalDir, f), 'utf8').includes('[['));
if (legalOpen.length > 0) {
  console.log(`NOTE: ${legalOpen.length} legal text(s) in this package still hold [[...]] placeholders; no public host may seed from it (DEPLOY 7).`);
}
writeFileSync(join(stageWeb, 'PACKAGE_INFO.txt'), [
  `package: ${zipName}`,
  `version: ${version}`,
  `commit: ${commitFull} (web/ from this commit)`,
  mobileDirty !== ''
    ? `mobile: DIRTY, ${mobileDirty.split('\n').length} uncommitted change(s) in public/app (--allow-dirty). DO NOT DEPLOY.`
    : 'mobile: clean (public/app from this commit)',
  `release register: RELEASES.md (docs/RELEASES.md of this commit; speedclub:releases-sync --path=RELEASES.md)`,
  `legal placeholders: ${legalOpen.length > 0 ? `${legalOpen.length} file(s) with [[...]]: ${legalOpen.join(', ')}` : 'none'}`,
  `built: ${now.toISOString()}`,
  '',
].join('\n'));

// 6. zip
function excluded(rel, isDir) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  // The storage/ and bootstrap/cache directories stay (the app needs them writable); only their runtime files go.
  if (parts[0] === 'storage' && (isDir || base === '.gitignore')) return false;
  // The Expo export keeps the fonts and icons it bundles under public/app/assets/node_modules/, and the app loads them at runtime.
  if (parts.includes('node_modules') && !rel.startsWith('public/app/')) return true;
  if (/^\.env/.test(base) && base !== '.env.example' && base !== '.env.production.example') return true;
  if (parts[0] === 'vendor') return false; // third-party packages ship their own files untouched
  if (parts[0] === 'tests' || parts[0] === 'e2e' || parts.includes('e2e')) return true;
  if (parts.length === 1 && ['.mcp.json', 'AGENTS.md', 'boost.json', 'phpstan.neon', 'pint.json', 'eslint.config.js'].includes(base)) return true; // dev tooling
  if (/^(phpunit|pest)/i.test(base) || /^playwright\.config\./.test(base)) return true;
  if (parts[0] === '.lighthouseci' || rel.startsWith('public/.lighthouseci')) return true;
  if (rel === 'public/storage' || rel === 'public/hot') return true;
  if (/^storage\/logs\//.test(rel)) return true;
  if (/^storage\/framework\/(cache|sessions|views)\//.test(rel)) return true;
  if (/^bootstrap\/cache\/(?!\.gitignore$)/.test(rel)) return true;
  if (/\.(sqlite|sqlite3)$/.test(base)) return true;
  return false;
}

const entries = [];
(function walk(dir) {
  for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, d.name);
    const rel = relative(stageWeb, full).split('\\').join('/');
    let st = lstatSync(full);
    if (excluded(rel, st.isDirectory())) continue;
    let source = full;
    if (st.isSymbolicLink()) { // composer's vendor/bin links: store the target's content
      source = resolve(dirname(full), readlinkSync(full));
      if (!existsSync(source)) continue;
      st = statSync(source);
    }
    if (st.isDirectory()) { entries.push({ rel: `${rel}/`, dir: true, st }); walk(source); } else if (st.isFile()) entries.push({ rel, source, st });
  }
})(stageWeb);

// Nothing built may fall to a rule above, and the bundle must find every asset it names. The server has no way to rebuild them,
// and a missing font is invisible to a status-code check: useFonts reports the error and the app falls back to the system stack.
const packed = new Set(entries.filter((e) => !e.dir).map((e) => e.rel));
function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesIn(join(dir, d.name)) : [join(dir, d.name)]));
}
for (const folder of ['public/app', 'public/build']) {
  const lost = filesIn(join(stageWeb, folder)).map((full) => relative(stageWeb, full).split('\\').join('/')).filter((rel) => !packed.has(rel));
  if (lost.length > 0) die(`${lost.length} built file(s) would be left out of the package, for example ${lost[0]}`);
}
const ASSET_REF = /["'`]\/(?:app\/)?assets\/([^"'`?#\s]+\.[a-z0-9]+)/gi;
const bundleFiles = filesIn(stageApp).filter((full) => /\.(m?js|cjs|css|html)$/.test(full));
const named = new Set(bundleFiles.flatMap((full) => [...readFileSync(full, 'utf8').matchAll(ASSET_REF)].map((m) => m[1])));
const absent = [...named].filter((asset) => !packed.has(`public/app/assets/${asset}`));
if (absent.length > 0) die(`the member web names ${absent.length} asset(s) the package does not hold, for example ${absent[0]}`);
const fontsPacked = [...packed].filter((rel) => /^public\/app\/assets\/.*\.(ttf|otf|woff2?)$/.test(rel)).length;
if (fontsPacked === 0) die('no font file under public/app/assets: Inter, Inter Display and Archivo would not load');
console.log(`    contents checked: every built file packed, ${named.size} asset(s) named by the bundle all present, ${fontsPacked} font file(s)`);

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return [time, day];
}

// Classic zip limits (no ZIP64): checked before anything is written; the archive only gets its final name when complete.
if (entries.length > 65534) die(`${entries.length} entries: zip would need ZIP64; not supported by this writer`);
const LIMIT = 0xfffffff0;
partPath = `${zipPath}.part`;
partFd = openSync(partPath, 'w');
let offset = 0;
const central = [];
const write = (buf) => {
  if (offset + buf.length > LIMIT) die('zip would exceed 4 GB and need ZIP64; not supported by this writer');
  writeSync(partFd, buf);
  offset += buf.length;
};
const zipTop = 'speedclub';
for (const e of entries) {
  const name = Buffer.from(`${zipTop}/${e.rel}`, 'utf8');
  const data = e.dir ? Buffer.alloc(0) : readFileSync(e.source);
  const crc = e.dir ? 0 : zlib.crc32(data);
  const packed = e.dir || data.length === 0 ? Buffer.alloc(0) : zlib.deflateRawSync(data, { level: 9 });
  const method = packed.length > 0 && packed.length < data.length ? 8 : 0;
  const body = method === 8 ? packed : data;
  const [t, d] = dosTime(e.st.mtime);
  const mode = e.dir ? 0o040755 : ((e.st.mode & 0o111) ? 0o100755 : 0o100644);
  // Unix mode in the high word; MS-DOS directory bit (0x10) in the low word for directories.
  const attrs = (((mode << 16) >>> 0) | (e.dir ? 0x10 : 0)) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
  local.writeUInt16LE(t, 10); local.writeUInt16LE(d, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
  central.push({ name, method, t, d, crc, csize: body.length, size: data.length, attrs, offset });
  write(local); write(name); write(body);
}
const cdStart = offset;
for (const c of central) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE((3 << 8) | 20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8);
  h.writeUInt16LE(c.method, 10); h.writeUInt16LE(c.t, 12); h.writeUInt16LE(c.d, 14); h.writeUInt32LE(c.crc, 16);
  h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.size, 24); h.writeUInt16LE(c.name.length, 28);
  h.writeUInt32LE(c.attrs, 38); h.writeUInt32LE(c.offset, 42);
  write(h); write(c.name);
}
const cdSize = offset - cdStart;
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(cdStart, 16);
write(end);
closeSync(partFd);
partFd = null;
renameSync(partPath, zipPath);
partPath = '';

const sha = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
writeFileSync(`${zipPath}.sha256`, `${sha}  ${zipName}\n`);
if (!args.has('--keep')) rmSync(stageRoot, { recursive: true, force: true });

console.log('\n----------------------------------------------------------------');
console.log(`ZIP      : ${zipPath}`);
console.log(`ENTRIES  : ${central.length}`);
console.log(`SIZE     : ${(statSync(zipPath).size / 1048576).toFixed(1)} MB`);
console.log(`SHA-256  : ${sha}`);
console.log(`COMMIT   : ${commit}${mobileDirty !== '' ? ' (mobile/ NOT clean: --allow-dirty, do not deploy)' : ''}`);
console.log('OK');
