// Lighthouse CI, docs/07_QA_AND_RELEASE.md section 1, budgets from docs/05_ARCHITECTURE.md section 21.
// Mobile profile is the Lighthouse default. INP cannot be measured without real interaction, so
// Total Blocking Time is the lab stand-in, with the same 200 ms limit.
//
// URLs: `/`, `/v/{demo-slug}`, `/u/{demo-username}`. The demo values come from the deterministic
// DemoSeeder: SPEEDCLUB_DEMO_SLUG and SPEEDCLUB_DEMO_USERNAME, else tests/e2e/lighthouse/demo-targets.json.
//
// Server: SPEEDCLUB_BASE_URL (staging, production) is measured as given. Without it, lhci starts and stops tls-front.mjs, the local
// checkout served as production runs it: HTTPS + HTTP/2 + gzip on https://localhost:8443, pages from a PHP instance with
// APP_ENV=production, APP_DEBUG=false and `artisan optimize` caches of its own (05_ARCHITECTURE section 19), files from the Apache on
// :8080. The dev server itself keeps debug on and no caches. The certificate is self-signed, hence --ignore-certificate-errors.
//
// Browser: one renderer process (no site isolation, at most one renderer). Our pages send COOP same-origin, so Chrome loads them
// in a new renderer process after Lighthouse's about:blank, and on a busy PC that process can join the trace too late: the
// navigationStart event is missing and the run dies with NO_NAVSTART. In the about:blank renderer, which is traced from the
// start, that cannot happen. Chrome on Android, which the mobile profile stands for, does not isolate every site either.
// Lighthouse simulates network and CPU (Lantern), so the process model does not enter the metrics.
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('@playwright/test');

const explicitBase = process.env.SPEEDCLUB_BASE_URL;
const tlsPort = Number(process.env.SPEEDCLUB_LHCI_TLS_PORT || 8443);
const baseUrl = (explicitBase || `https://localhost:${tlsPort}`).replace(/\/$/, '');
const tlsFront = explicitBase
  ? {}
  : {
      // `node` from PATH: on Windows the command goes through cmd.exe, which mangles a quoted program path followed by a quoted argument.
      startServerCommand: `node "${join(__dirname, 'tls-front.mjs')}"`,
      startServerReadyPattern: 'tls-front ready',
      // artisan optimize, the PHP start and one warm-up request each for `/` and robots.txt.
      startServerReadyTimeout: 180000,
    };
const targetsFile = join(__dirname, 'demo-targets.json');
const fromFile = existsSync(targetsFile) ? JSON.parse(readFileSync(targetsFile, 'utf8')) : {};
const slug = process.env.SPEEDCLUB_DEMO_SLUG || fromFile.slug;
const username = process.env.SPEEDCLUB_DEMO_USERNAME || fromFile.username;

if (!slug || !username) {
  throw new Error(
    'Lighthouse needs the demo pages from M1.7: set SPEEDCLUB_DEMO_SLUG and SPEEDCLUB_DEMO_USERNAME, ' +
      'or commit tests/e2e/lighthouse/demo-targets.json with {"slug": "...", "username": "..."}.',
  );
}

module.exports = {
  ci: {
    collect: {
      url: [`${baseUrl}/`, `${baseUrl}/v/${slug}`, `${baseUrl}/u/${username}`],
      numberOfRuns: 3,
      chromePath: chromium.executablePath(),
      ...tlsFront,
      settings: {
        chromeFlags: [
          '--headless=new',
          '--no-sandbox',
          '--disable-site-isolation-trials',
          '--disable-features=site-per-process,IsolateOrigins',
          '--renderer-process-limit=1',
          ...(explicitBase ? [] : ['--ignore-certificate-errors']),
        ].join(' '),
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 0.95 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci/reports',
    },
  },
};
