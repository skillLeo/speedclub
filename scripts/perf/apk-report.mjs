#!/usr/bin/env node
/**
 * Size breakdown of a built APK for the "APK size" budget of docs/09_PREMIUM_2_0.md §12 (≤ M4.0 baseline + 25 MB). Node >= 18, no
 * dependencies; reads the archive's central directory through `unzip -v` (Info-ZIP), so no Gradle and no Android SDK are needed.
 *
 *   node scripts/perf/apk-report.mjs <file.apk> [--out=<file.json>]
 *
 * Reports the file size (bytes, MiB, MB) and, per group, the stored (compressed in the APK) and uncompressed bytes: lib/<abi> native
 * libraries per ABI (with the 10 largest .so), classes*.dex, the JS bundle (assets/index.android.bundle), other assets, res,
 * resources.arsc, META-INF (signature) and the rest. A Markdown table goes next to --out (.md).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const outArg = process.argv.slice(2).find((a) => a.startsWith('--out='))?.slice(6);
const apk = positional[0] ? resolve(positional[0]) : null;
if (!apk) {
  console.error('usage: node scripts/perf/apk-report.mjs <file.apk> [--out=<file.json>]');
  process.exit(2);
}

const listing = spawnSync('unzip', ['-v', apk], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (listing.status !== 0) {
  console.error(`apk-report: unzip -v failed: ${listing.stderr}`);
  process.exit(1);
}

/** @type {{name: string, size: number, stored: number}[]} */
const entries = [];
for (const line of listing.stdout.split('\n')) {
  // Length  Method  Size  Cmpr  Date  Time  CRC-32  Name
  const match = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)\s+-?\d+%\s+\S+\s+\S+\s+[0-9a-f]{8}\s+(.+)$/);
  if (match) entries.push({ name: match[4], size: Number(match[1]), stored: Number(match[3]) });
}

/** @param {string} name */
function group(name) {
  const lib = name.match(/^lib\/([^/]+)\//);
  if (lib) return `lib/${lib[1]}`;
  if (/^classes\d*\.dex$/.test(name)) return 'classes*.dex';
  if (name === 'assets/index.android.bundle') return 'assets/index.android.bundle (JS)';
  if (name.startsWith('assets/')) return 'assets (other)';
  if (name.startsWith('res/')) return 'res';
  if (name === 'resources.arsc') return 'resources.arsc';
  if (name.startsWith('META-INF/')) return 'META-INF';
  return 'other';
}

/** @type {Record<string, {files: number, stored: number, size: number}>} */
const groups = {};
for (const entry of entries) {
  const key = group(entry.name);
  groups[key] ??= { files: 0, stored: 0, size: 0 };
  groups[key].files++;
  groups[key].stored += entry.stored;
  groups[key].size += entry.size;
}

const bytes = statSync(apk).size;
const report = {
  tool: 'scripts/perf/apk-report.mjs',
  measured_at: new Date().toISOString(),
  file: basename(apk),
  sha256: createHash('sha256').update(readFileSync(apk)).digest('hex'),
  bytes,
  mib: Math.round((bytes / 2 ** 20) * 100) / 100,
  mb: Math.round((bytes / 1e6) * 100) / 100,
  entries: entries.length,
  uncompressed_bytes: entries.reduce((a, e) => a + e.size, 0),
  groups: Object.fromEntries(Object.entries(groups).sort((a, b) => b[1].stored - a[1].stored)),
  top_native_libs: entries
    .filter((e) => e.name.endsWith('.so'))
    .sort((a, b) => b.stored - a.stored)
    .slice(0, 10),
};

const mib = (/** @type {number} */ n) => (n / 2 ** 20).toFixed(2);
const md = [
  `# APK ${report.file}`,
  '',
  `${report.bytes} bytes = ${report.mib} MiB = ${report.mb} MB · sha256 ${report.sha256} · ${report.entries} entries · measured ${report.measured_at} with ${report.tool}`,
  '',
  '| Group | files | stored MiB | uncompressed MiB |',
  '|---|---:|---:|---:|',
  ...Object.entries(report.groups).map(([name, g]) => `| ${name} | ${g.files} | ${mib(g.stored)} | ${mib(g.size)} |`),
  '',
  '| Largest native libraries | stored MiB | uncompressed MiB |',
  '|---|---:|---:|',
  ...report.top_native_libs.map((e) => `| ${e.name} | ${mib(e.stored)} | ${mib(e.size)} |`),
  '',
].join('\n');

if (outArg) {
  const out = resolve(outArg);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(out.replace(/\.json$/, '') + '.md', md);
}
console.log(md);
