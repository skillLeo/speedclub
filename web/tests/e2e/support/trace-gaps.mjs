#!/usr/bin/env node
/**
 * Reads a Playwright trace of a failed test and says whether the browser froze (RISK-4, microsoft/playwright#43818):
 *
 *   node web/tests/e2e/support/trace-gaps.mjs web/tests/e2e/test-results/<test>/trace.zip
 *
 * Prints the test's steps that took longer than a second, the gaps between screencast frames longer than 1.5 s, and the
 * slowest requests. The render probe of support/fixtures.ts only sees a freeze that is still under way when the test
 * ends; a freeze that ended before (WebKit on Windows resumes after seconds now and then) shows here, as a gap in the
 * frames while the steps stand still and the app's next request leaves late. A gap of a few seconds without such a
 * freeze is the browser waiting for the server, which the slow requests show.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('usage: node web/tests/e2e/support/trace-gaps.mjs <trace.zip | unzipped trace directory>');
  process.exit(2);
}

let dir = input;
let cleanup = () => {};
if (statSync(input).isFile()) {
  dir = mkdtempSync(join(tmpdir(), 'trace-gaps-'));
  // bsdtar reads zip archives: Windows' own (Git Bash puts GNU tar, which cannot, first on the PATH), macOS, most Linux.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', input, '-C', dir]);
  cleanup = () => rmSync(dir, { recursive: true, force: true });
}

/** @param {string} file @returns {Record<string, any>[]} */
const events = (file) =>
  readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });

try {
  /** @type {Map<string, {title: string, start: number, end?: number, error?: string}>} */
  const steps = new Map();
  /** @type {number[]} */
  const frames = [];
  let t0 = Infinity;
  for (const file of readdirSync(dir).filter((f) => f === 'test.trace')) {
    for (const e of events(file)) {
      if (e.type === 'before') {
        steps.set(e.callId, { title: String(e.title ?? e.method ?? ''), start: e.startTime });
        t0 = Math.min(t0, e.startTime);
      } else if (e.type === 'after') {
        const step = steps.get(e.callId);
        if (step) {
          step.end = e.endTime;
          step.error = e.error?.message?.split('\n')[0];
        }
      }
    }
  }
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.trace'))) {
    for (const e of events(file)) if (e.type === 'screencast-frame') frames.push(e.timestamp);
  }
  const at = (/** @type {number} */ ms) => `${((ms - t0) / 1000).toFixed(1).padStart(6)} s`;

  console.log('steps over 1 s:');
  for (const step of [...steps.values()].sort((a, b) => a.start - b.start)) {
    const took = step.end === undefined ? 'open' : `${((step.end - step.start) / 1000).toFixed(1)} s`;
    if (step.end === undefined || step.end - step.start > 1000 || step.error)
      console.log(`  ${at(step.start)}  ${took.padStart(7)}  ${step.title}${step.error ? `  ERROR ${step.error}` : ''}`);
  }

  frames.sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < frames.length; i++) {
    const gap = /** @type {number} */ (frames[i]) - /** @type {number} */ (frames[i - 1]);
    if (gap > 1500) gaps.push(`  from ${at(/** @type {number} */ (frames[i - 1]))}: ${(gap / 1000).toFixed(1)} s without a frame`);
  }
  console.log(`screencast: ${frames.length} frames${frames.length ? `, the last at ${at(/** @type {number} */ (frames.at(-1)))}` : ''}`);
  console.log(gaps.length ? gaps.join('\n') : '  no gap over 1.5 s');

  /** @type {{line: string, ms: number}[]} */
  const requests = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.network'))) {
    for (const e of events(file)) {
      const s = e.snapshot;
      if (s?.request?.url) requests.push({ line: `${s.response?.status ?? '-'} ${s.request.method} ${new URL(s.request.url).pathname}`, ms: Number(s.time) || 0 });
    }
  }
  console.log('slowest requests:');
  for (const r of requests.sort((a, b) => b.ms - a.ms).slice(0, 8)) console.log(`  ${String(Math.round(r.ms)).padStart(6)} ms  ${r.line}`);
} finally {
  cleanup();
}
