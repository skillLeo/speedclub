// Lighthouse CI, docs/07_QA_AND_RELEASE.md section 1. Budgets since M4.16: docs/09_PREMIUM_2_0.md §9 (mobile, 4G): LCP < 2.0 s,
// CLS < 0.05, TBT < 150 ms, Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95 (tighter than 05 §21's 2.5 s / 0.1 /
// 200 ms). Mobile profile is the Lighthouse default. INP cannot be measured without real interaction, so Total Blocking Time is the
// lab stand-in.
//
// URLs: `/`, `/v/{demo-slug}`, `/u/{demo-username}`, `/e/{demo-event}` (09 §9 WEB-09), and with SPEEDCLUB_LHCI_PARTNERS=1 also
// `/b/{demo-business}` and `/brands/{demo-brand}`: those two pages exist only while the flags businesses and parts_catalogue are on
// (off everywhere until ADR-455's design QA), so a run that measures them switches them on around itself (the M4.16 report names the
// command: backend.php enable-m414-flags … disable-m414-flags). The demo values come from the deterministic DemoSeeder:
// SPEEDCLUB_DEMO_SLUG, SPEEDCLUB_DEMO_USERNAME, SPEEDCLUB_DEMO_EVENT, SPEEDCLUB_DEMO_BUSINESS, SPEEDCLUB_DEMO_BRAND, else
// tests/e2e/lighthouse/demo-targets.json. The demo event is the member-organised demo meet, not a sample: samples are noindex by
// design (09 §8.19), which Lighthouse scores as an SEO failure.
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
const event = process.env.SPEEDCLUB_DEMO_EVENT || fromFile.event;
const business = process.env.SPEEDCLUB_DEMO_BUSINESS || fromFile.business;
const brand = process.env.SPEEDCLUB_DEMO_BRAND || fromFile.brand;
const partners = process.env.SPEEDCLUB_LHCI_PARTNERS === '1';

if (!slug || !username) {
  throw new Error(
    'Lighthouse needs the demo pages from M1.7: set SPEEDCLUB_DEMO_SLUG and SPEEDCLUB_DEMO_USERNAME, ' +
      'or commit tests/e2e/lighthouse/demo-targets.json with {"slug": "...", "username": "..."}.',
  );
}

module.exports = {
  ci: {
    collect: {
      url: [
        `${baseUrl}/`,
        `${baseUrl}/v/${slug}`,
        `${baseUrl}/u/${username}`,
        ...(event ? [`${baseUrl}/e/${event}`] : []),
        ...(partners && business ? [`${baseUrl}/b/${business}`] : []),
        ...(partners && brand ? [`${baseUrl}/brands/${brand}`] : []),
      ],
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
        'largest-contentful-paint': ['error', { maxNumericValue: 2000 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
        'total-blocking-time': ['error', { maxNumericValue: 150 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci/reports',
    },
  },
};
