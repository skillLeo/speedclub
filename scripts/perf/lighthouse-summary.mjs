#!/usr/bin/env node
/**
 * Medians of a Lighthouse CI collect (docs/09_PREMIUM_2_0.md §12 and §9; M4.0 baseline, reused by M4.18). Node >= 18, no dependencies.
 *
 *   node scripts/perf/lighthouse-summary.mjs [--dir=web/.lighthouseci] [--out=<file.json>]
 *
 * Reads every lhr-*.json that `lhci collect` left in --dir, groups the runs by requested URL and reports, per URL, the median of each
 * value on its own (so the medians of one URL may come from different runs) and every run's values: Performance, Accessibility, Best
 * Practices and SEO scores (0–100), LCP, FCP, TBT, Speed Index (ms), CLS and total byte weight (bytes).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.match(/^--([^=]+)(?:=(.*))?$/)?.slice(1) ?? [a, 'true']));
const dir = resolve(process.cwd(), args.dir ?? join(root, 'web', '.lighthouseci'));

const files = readdirSync(dir).filter((f) => /^lhr-.*\.json$/.test(f)).sort();
if (files.length === 0) {
  console.error(`lighthouse-summary: no lhr-*.json in ${dir}`);
  process.exit(2);
}

const score = (/** @type {any} */ lhr, /** @type {string} */ id) => (lhr.categories?.[id]?.score == null ? null : Math.round(lhr.categories[id].score * 100));
const audit = (/** @type {any} */ lhr, /** @type {string} */ id) => lhr.audits?.[id]?.numericValue ?? null;

/** @type {Map<string, any[]>} */
const byUrl = new Map();
for (const file of files) {
  const lhr = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const run = {
    file,
    fetch_time: lhr.fetchTime,
    final_url: lhr.finalDisplayedUrl ?? lhr.finalUrl,
    lighthouse: lhr.lighthouseVersion,
    form_factor: lhr.configSettings?.formFactor,
    throttling: lhr.configSettings?.throttlingMethod,
    runtime_error: lhr.runtimeError?.code ?? null,
    performance: score(lhr, 'performance'),
    accessibility: score(lhr, 'accessibility'),
    best_practices: score(lhr, 'best-practices'),
    seo: score(lhr, 'seo'),
    lcp_ms: audit(lhr, 'largest-contentful-paint'),
    fcp_ms: audit(lhr, 'first-contentful-paint'),
    tbt_ms: audit(lhr, 'total-blocking-time'),
    si_ms: audit(lhr, 'speed-index'),
    cls: audit(lhr, 'cumulative-layout-shift'),
    total_byte_weight: audit(lhr, 'total-byte-weight'),
  };
  const url = lhr.requestedUrl;
  byUrl.set(url, [...(byUrl.get(url) ?? []), run]);
}

const median = (/** @type {(number|null)[]} */ values) => {
  const list = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (list.length === 0) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
};
const KEYS = ['performance', 'accessibility', 'best_practices', 'seo', 'lcp_ms', 'fcp_ms', 'tbt_ms', 'si_ms', 'cls', 'total_byte_weight'];

const urls = [...byUrl.entries()].map(([url, runs]) => ({
  url,
  runs: runs.length,
  median: Object.fromEntries(KEYS.map((k) => [k, median(runs.map((r) => r[k]))])),
  each: runs,
}));

const report = { tool: 'scripts/perf/lighthouse-summary.mjs', summarised_at: new Date().toISOString(), dir, method: 'median of each value over the runs of one URL', urls };
const fmt = (/** @type {number|null} */ v, digits = 0) => (v === null ? '–' : v.toFixed(digits));
const md = [
  `# Lighthouse medians (${dir})`,
  '',
  '| URL | runs | Perf | A11y | BP | SEO | LCP ms | FCP ms | TBT ms | SI ms | CLS | bytes |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...urls.map(({ url, runs, median: m }) =>
    `| ${url} | ${runs} | ${fmt(m.performance)} | ${fmt(m.accessibility)} | ${fmt(m.best_practices)} | ${fmt(m.seo)} | ${fmt(m.lcp_ms)} | ${fmt(m.fcp_ms)} | ${fmt(m.tbt_ms)} | ${fmt(m.si_ms)} | ${fmt(m.cls, 3)} | ${fmt(m.total_byte_weight)} |`),
  '',
].join('\n');

if (args.out) {
  const out = resolve(process.cwd(), args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(out.replace(/\.json$/, '') + '.md', md);
}
console.log(md);
