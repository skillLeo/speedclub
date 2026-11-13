#!/usr/bin/env node
/**
 * Size report of the member web export (web/public/app, served at /app) for the "Member web JS" budget of docs/09_PREMIUM_2_0.md §12:
 * initial JS ≤ M4.0 baseline + 10 %. Node >= 18, no dependencies (zlib gzip and brotli).
 *
 *   node scripts/perf/bundle-report.mjs [--dir=web/public/app] [--base=/app] [--requests=<json>] [--out=<file.json>] [--label=<text>]
 *
 * Initial JS: every script that index.html loads before the first route renders (<script src> and <link rel=modulepreload|preload
 * as=script>), in document order. Route chunks of Expo Router's async routes load later; with --requests (the JSON that
 * web/tests/perf/app-chunks.mjs writes: {scenarios: {name: [url, ...]}}) the report lists, per scenario, the JS files the browser
 * requested beyond the initial set, with their sizes taken from the files on disk.
 *
 * Sizes: raw bytes, gzip (level 9) and brotli (quality 11) of each file, compressed one file at a time. These are reproducible sizes of
 * the build, not what a given server sends (Apache mod_deflate defaults to gzip level 6, the host decides about brotli).
 *
 * Output: a JSON report (--out) and a Markdown table next to it (.md); without --out both go to stdout.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${arg}`);
    return [match[1], match[2] ?? 'true'];
  }),
);
const dir = resolve(process.cwd(), args.dir ?? join(root, 'web', 'public', 'app'));
const basePath = (args.base ?? '/app').replace(/\/$/, '');
const label = args.label ?? relative(root, dir);

if (!existsSync(join(dir, 'index.html'))) {
  console.error(`bundle-report: no index.html in ${dir} (export first: npm --prefix mobile run export:web, through scripts/dev/qa-run.mjs)`);
  process.exit(2);
}

/** @param {string} folder @returns {string[]} */
function walk(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sizeCache = new Map();
/** @param {string} file */
function sizes(file) {
  if (!sizeCache.has(file)) {
    const data = readFileSync(file);
    sizeCache.set(file, {
      raw: data.length,
      gzip: gzipSync(data, { level: 9 }).length,
      brotli: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }).length,
    });
  }
  return sizeCache.get(file);
}

const sum = (/** @type {{raw:number,gzip:number,brotli:number}[]} */ list) =>
  list.reduce((total, s) => ({ raw: total.raw + s.raw, gzip: total.gzip + s.gzip, brotli: total.brotli + s.brotli }), { raw: 0, gzip: 0, brotli: 0 });

/** A URL or path of the page → the file in the export, or null for one outside it. @param {string} url */
function fileOf(url) {
  let path;
  try {
    path = decodeURIComponent(new URL(url, 'http://page.invalid/').pathname);
  } catch {
    return null;
  }
  if (basePath && path.startsWith(`${basePath}/`)) path = path.slice(basePath.length);
  const file = resolve(dir, `.${path}`);
  return file.startsWith(dir + sep) && existsSync(file) && statSync(file).isFile() ? file : null;
}

const rel = (/** @type {string} */ file) => relative(dir, file).split(sep).join('/');

// Initial JS from index.html, in document order.
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const initialUrls = [];
for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) initialUrls.push(match[1]);
for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
  const tag = match[0];
  const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1] ?? '';
  const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
  const as = tag.match(/\bas=["']([^"']+)["']/i)?.[1] ?? '';
  if (href && (/modulepreload/i.test(rel) || (/\bpreload\b/i.test(rel) && /script/i.test(as)))) initialUrls.push(href);
}
const initialFiles = [...new Set(initialUrls.map(fileOf).filter(/** @returns {f is string} */ (f) => f !== null))];
const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => Buffer.byteLength(m[1]));

const files = walk(dir);
const byType = (/** @type {RegExp} */ pattern) => files.filter((f) => pattern.test(extname(f).toLowerCase()));
const js = byType(/^\.m?js$/);
const groups = {
  js,
  css: byType(/^\.css$/),
  fonts: byType(/^\.(ttf|otf|woff2?)$/),
  images: byType(/^\.(png|jpe?g|webp|avif|gif|svg|ico)$/),
};
const other = files.filter((f) => !Object.values(groups).flat().includes(f));

const entry = (/** @type {string} */ f) => ({ file: rel(f), ...sizes(f) });
const initial = initialFiles.map(entry);

/** @type {Record<string, unknown>} */
let scenarios = {};
if (args.requests) {
  const log = JSON.parse(readFileSync(resolve(process.cwd(), args.requests), 'utf8'));
  for (const [name, urls] of Object.entries(log.scenarios ?? {})) {
    const requested = [...new Set(/** @type {string[]} */ (urls).map(fileOf).filter((f) => f !== null && /\.m?js$/.test(f)))];
    const lazy = requested.filter((f) => !initialFiles.includes(f)).map(entry);
    scenarios[name] = {
      url: log.urls?.[name] ?? null,
      js_requested: requested.length,
      lazy_chunks: lazy,
      lazy_total: sum(lazy),
      js_total_with_initial: sum(requested.map((f) => sizes(f))),
      initial_not_requested: initialFiles.filter((f) => !requested.includes(f)).map(rel),
    };
  }
}

const report = {
  tool: 'scripts/perf/bundle-report.mjs',
  measured_at: new Date().toISOString(),
  label,
  dir: relative(root, dir) || dir,
  compression: 'gzip level 9, brotli quality 11, per file',
  index_html: { ...sizes(join(dir, 'index.html')), inline_script_bytes: inlineScripts.reduce((a, b) => a + b, 0) },
  initial_js: { files: initial, total: sum(initial.map((e) => e)) },
  scenarios,
  totals: {
    js: { files: js.length, ...sum(js.map(sizes)) },
    css: { files: groups.css.length, ...sum(groups.css.map(sizes)) },
    fonts: { files: groups.fonts.length, ...sum(groups.fonts.map(sizes)) },
    images: { files: groups.images.length, ...sum(groups.images.map(sizes)) },
    other: { files: other.length, ...sum(other.map(sizes)) },
  },
  top10_js: js.map(entry).sort((a, b) => b.raw - a.raw).slice(0, 10),
};

const kb = (/** @type {number} */ n) => (n / 1024).toFixed(1);
const row = (/** @type {string} */ name, /** @type {{raw:number,gzip:number,brotli:number}} */ s, extra = '') => `| ${name} | ${kb(s.raw)} | ${kb(s.gzip)} | ${kb(s.brotli)} |${extra}`;
const md = [
  `# Member web bundle (${label})`,
  '',
  `Measured ${report.measured_at} with ${report.tool}; KiB, ${report.compression}.`,
  '',
  '## Initial JS (index.html, before the first route renders)',
  '',
  '| File | raw | gzip | brotli |',
  '|---|---:|---:|---:|',
  ...initial.map((e) => row(e.file, e)),
  row('**Total initial JS**', report.initial_js.total),
  '',
  ...Object.entries(scenarios).flatMap(([name, s]) => {
    const data = /** @type {any} */ (s);
    return [
      `## Route chunks requested: ${name}${data.url ? ` (${data.url})` : ''}`,
      '',
      '| File | raw | gzip | brotli |',
      '|---|---:|---:|---:|',
      ...data.lazy_chunks.map((/** @type {any} */ e) => row(e.file, e)),
      row('**Lazy chunks total**', data.lazy_total),
      row('**All JS of this load**', data.js_total_with_initial),
      '',
    ];
  }),
  '## Totals of the export',
  '',
  '| Kind | files | raw | gzip | brotli |',
  '|---|---:|---:|---:|---:|',
  ...Object.entries(report.totals).map(([name, s]) => `| ${name} | ${s.files} | ${kb(s.raw)} | ${kb(s.gzip)} | ${kb(s.brotli)} |`),
  '',
  '## Top 10 JS files',
  '',
  '| File | raw | gzip | brotli |',
  '|---|---:|---:|---:|',
  ...report.top10_js.map((e) => row(e.file, e)),
  '',
].join('\n');

if (args.out) {
  const out = resolve(process.cwd(), args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(out.replace(/\.json$/, '') + '.md', md);
  console.log(md);
  console.log(`bundle-report: wrote ${out}`);
} else {
  console.log(JSON.stringify(report, null, 2));
  console.log(md);
}
