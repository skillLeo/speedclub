#!/usr/bin/env node
/**
 * API latency over HTTP for the budgets of docs/09_PREMIUM_2_0.md §12 (M4.0 baseline, reused by M4.18). Node >= 18, no dependencies.
 *
 *   SPEEDCLUB_PERF_PASSWORD=... node scripts/perf/api-p95.mjs --base=http://localhost:8081 [options]
 *
 * Run it against a production-like copy seeded with the demo and database/seeders/PerfScaleSeeder.php (2,000 vehicles, 5,000 updates),
 * never against the dev server on :8080 (debug on, no caches). Through scripts/dev/qa-run.mjs, so no other QA run overlaps.
 *
 * Sign-in: the real member API (POST /api/v1/auth/login with device fields, as the native app signs in) answers a bearer token; the run
 * signs out at the end, which revokes it. The password comes from SPEEDCLUB_PERF_PASSWORD (or DEMO_MEMBER_PASSWORD) and is never printed.
 *
 * Per endpoint: --warmup requests (default 5, not counted), then --samples sequential requests (default 50). The time of one request is
 * from fetch() to the last byte of the body (client wall clock, keep-alive, no If-None-Match, so every answer is a full 200). Every
 * answer that is not 2xx, or a network error, counts as an error and is not in the percentiles. Percentiles use the nearest-rank method.
 *
 * Rate limits: the probes stay inside the app's own limiters (config/speedclub.php rate_limits: browse 300, search 60, public_read 300 per
 * minute) by pacing: before a request that would put more than (limit - margin) requests of one limiter into any 61 s window, the script
 * waits outside the measurement. Requests of an earlier run in the same window are unknown to the pacing: a 429 then is waited out
 * (Retry-After) and the same request is sent again; the result reports these as throttled_retries, apart from errors.
 *
 * Options:
 *   --base=<url>        API origin (default http://localhost:8081)
 *   --email=<address>   member to sign in as (default lukas.sc@speedclub.test, the measuring member of PerfScaleSeeder)
 *   --slug=<slug>       vehicle for the detail probe (default: web/tests/e2e/lighthouse/demo-targets.json, the flagship R34)
 *   --username=<name>   profile for the profile probe (default: the same file, lukas.sc)
 *   --make=<slug>       make filter of the Discover probe (default bmw)
 *   --q=<text>          free text of the Discover probe (default golf)
 *   --warmup=<n> --samples=<n>
 *   --only=<id,id>      run some endpoints only
 *   --out=<path>        JSON result (default: none); a Markdown table is written next to it (.md)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${arg}`);
    return [match[1], match[2] ?? 'true'];
  }),
);

const targetsFile = join(root, 'web', 'tests', 'e2e', 'lighthouse', 'demo-targets.json');
const targets = existsSync(targetsFile) ? JSON.parse(readFileSync(targetsFile, 'utf8')) : {};
const base = (args.base ?? 'http://localhost:8081').replace(/\/$/, '');
const email = args.email ?? 'lukas.sc@speedclub.test';
const slug = args.slug ?? targets.slug;
const username = args.username ?? targets.username;
const make = args.make ?? 'bmw';
const q = args.q ?? 'golf';
const warmup = Number(args.warmup ?? 5);
const samples = Number(args.samples ?? 50);
const only = args.only ? new Set(args.only.split(',')) : null;
const password = process.env.SPEEDCLUB_PERF_PASSWORD || process.env.DEMO_MEMBER_PASSWORD;
const USER_AGENT = 'SpeedClubPerf/1.0 (api-p95)';

if (!password) {
  console.error('api-p95: set SPEEDCLUB_PERF_PASSWORD (the demo member password, e.g. by shell substitution from web/.env); it is never printed.');
  process.exit(2);
}
if (!slug || !username) {
  console.error('api-p95: no vehicle slug or username (--slug, --username or web/tests/e2e/lighthouse/demo-targets.json).');
  process.exit(2);
}

/** Limits per minute of config/speedclub.php rate_limits, per member (search, browse) or per address (public_read). */
const LIMITS = { browse: 300, search: 60, public_read: 300 };
const MARGIN = 5;
const WINDOW_MS = 61_000;

/**
 * The probes of §12 with the paths of web/routes/api/v1/*.php and the query the app sends (mobile/src/api/queries/*).
 * @type {{id: string, label: string, path: string, limiters: (keyof typeof LIMITS)[], na?: string}[]}
 */
const ENDPOINTS = [
  { id: 'feed_for_you', label: 'Home feed, Für dich (first page)', path: '/api/v1/feed?tab=for_you&per_page=20', limiters: ['browse'] },
  { id: 'feed_following', label: 'Home feed, Folge ich (first page)', path: '/api/v1/feed?tab=following&per_page=20', limiters: ['browse'] },
  { id: 'vehicle_detail', label: `Vehicle detail by slug (${slug})`, path: `/api/v1/public/vehicles/${encodeURIComponent(slug)}`, limiters: ['public_read'] },
  { id: 'discover_make', label: `Discover results, make filter (${make})`, path: `/api/v1/search?make=${encodeURIComponent(make)}`, limiters: ['browse', 'search'] },
  { id: 'discover_text', label: `Discover results, free text (${q})`, path: `/api/v1/search?q=${encodeURIComponent(q)}`, limiters: ['browse', 'search'] },
  { id: 'notifications', label: 'Notifications list (first page)', path: '/api/v1/notifications?per_page=30', limiters: ['browse'] },
  { id: 'profile', label: `Member profile (${username})`, path: `/api/v1/public/users/${encodeURIComponent(username)}`, limiters: ['public_read'] },
  { id: 'events_list', label: 'Events list', path: '', limiters: [], na: 'N/A in v1: events do not exist before Phase 4 (09 §8.7).' },
];

/** @type {Record<string, number[]>} */
const sent = { browse: [], search: [], public_read: [] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pace(/** @type {(keyof typeof LIMITS)[]} */ limiters) {
  for (;;) {
    const now = Date.now();
    let wait = 0;
    for (const name of limiters) {
      sent[name] = sent[name].filter((t) => now - t < WINDOW_MS);
      if (sent[name].length >= LIMITS[name] - MARGIN) wait = Math.max(wait, WINDOW_MS - (now - sent[name][0]) + 50);
    }
    if (wait === 0) break;
    process.stdout.write(`  (pacing ${Math.ceil(wait / 1000)} s for ${limiters.join('+')})\n`);
    await sleep(wait);
  }
  const at = Date.now();
  for (const name of limiters) sent[name].push(at);
}

let token = '';

async function request(path, init = {}) {
  const started = performance.now();
  const response = await fetch(base + path, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'de',
      'User-Agent': USER_AGENT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, ms: performance.now() - started, bytes: body.length, body, retryAfter: response.headers.get('retry-after') };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const round = (n) => (n === null ? null : Math.round(n * 10) / 10);

async function main() {
  const login = await request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, device_name: 'SPEED CLUB perf probe', platform: 'android', app_version: 'perf' }),
  });
  if (login.status !== 200) throw new Error(`Sign-in of ${email} answered HTTP ${login.status}`);
  const data = JSON.parse(login.body.toString('utf8')).data;
  if (!data?.token) throw new Error('Sign-in answered no token (two-factor on, or the cookie session of the SPA).');
  token = data.token;

  const results = [];
  try {
    for (const endpoint of ENDPOINTS) {
      if (only && !only.has(endpoint.id)) continue;
      if (endpoint.na) {
        results.push({ id: endpoint.id, label: endpoint.label, na: endpoint.na });
        console.log(`${endpoint.id}: ${endpoint.na}`);
        continue;
      }
      const times = [];
      const statuses = {};
      let errors = 0;
      let warmupErrors = 0;
      let throttled = 0;
      let bytes = 0;
      for (let i = 0; i < warmup + samples; i++) {
        await pace(endpoint.limiters);
        let outcome;
        for (let attempt = 1; ; attempt++) {
          try {
            outcome = await request(endpoint.path);
          } catch (error) {
            outcome = { status: 0, ms: 0, bytes: 0, error: String(error), retryAfter: 0 };
          }
          if (outcome.status !== 429 || attempt > 3) break;
          throttled++;
          const wait = (Number(outcome.retryAfter) || 60) * 1000 + 1000;
          process.stdout.write(`  (429 from an earlier window: waiting ${Math.ceil(wait / 1000)} s, then the same request again)\n`);
          await sleep(wait);
          await pace(endpoint.limiters);
        }
        if (i < warmup) {
          // A failing warm-up is not timed, but it is counted: it means the endpoint was not ready.
          if (!(outcome.status >= 200 && outcome.status < 300)) warmupErrors++;
          continue;
        }
        statuses[outcome.status] = (statuses[outcome.status] ?? 0) + 1;
        if (outcome.status >= 200 && outcome.status < 300) {
          times.push(outcome.ms);
          bytes = outcome.bytes;
        } else {
          errors++;
        }
      }
      const sorted = [...times].sort((a, b) => a - b);
      const row = {
        id: endpoint.id,
        label: endpoint.label,
        path: endpoint.path,
        samples: times.length,
        warmup,
        errors,
        warmup_errors: warmupErrors,
        throttled_retries: throttled,
        statuses,
        response_bytes: bytes,
        p50_ms: round(percentile(sorted, 50)),
        p95_ms: round(percentile(sorted, 95)),
        p99_ms: round(percentile(sorted, 99)),
        max_ms: round(sorted.at(-1) ?? null),
        mean_ms: round(sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null),
      };
      results.push(row);
      console.log(
        `${row.id.padEnd(16)} p50 ${row.p50_ms} ms  p95 ${row.p95_ms} ms  p99 ${row.p99_ms} ms  max ${row.max_ms} ms  errors ${row.errors}/${samples}  warm-up errors ${row.warmup_errors}  throttled ${row.throttled_retries}  ${row.response_bytes} B`,
      );
    }
  } finally {
    const logout = await request('/api/v1/auth/logout', { method: 'POST' }).catch(() => ({ status: 0 }));
    if (logout.status !== 204) console.warn(`api-p95: sign-out answered HTTP ${logout.status}; the probe token stays until it expires.`);
  }

  const report = {
    tool: 'scripts/perf/api-p95.mjs',
    measured_at: new Date().toISOString(),
    base,
    member: email,
    method: `HTTP, sequential, ${warmup} warm-up + ${samples} measured requests per endpoint, bearer token, client wall clock to last byte, nearest-rank percentiles`,
    machine: { platform: `${os.platform()} ${os.release()}`, arch: os.arch(), cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, memory_gb: Math.round(os.totalmem() / 2 ** 30), node: process.version },
    results,
  };

  if (args.out) {
    const out = resolve(process.cwd(), args.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    const md = [
      `# API p95 (${report.measured_at})`,
      '',
      `Base ${base}, member ${email}. ${report.method}.`,
      '',
      '| Endpoint | p50 ms | p95 ms | p99 ms | max ms | errors | warm-up errors | 429 retried | samples | bytes |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
      ...results.map((r) => (r.na ? `| ${r.label} | N/A | N/A | N/A | N/A | – | – | – | – | – |` : `| ${r.label} | ${r.p50_ms} | ${r.p95_ms} | ${r.p99_ms} | ${r.max_ms} | ${r.errors} | ${r.warmup_errors} | ${r.throttled_retries} | ${r.samples} | ${r.response_bytes} |`)),
      '',
    ].join('\n');
    writeFileSync(out.replace(/\.json$/, '') + '.md', md);
    console.log(`api-p95: wrote ${out}`);
  }

  if (results.some((r) => r.errors > 0 || r.warmup_errors > 0)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`api-p95: ${error.message}`);
  process.exit(1);
});
