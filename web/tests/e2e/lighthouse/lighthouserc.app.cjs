// Lighthouse CI for the member web app (/app), docs/09_PREMIUM_2_0.md §12 "Member web /app (Lighthouse mobile)": Performance ≥ 80,
// LCP ≤ 2.5 s, CLS ≤ 0.05, TBT ≤ 300 ms. A MEASUREMENT, not a gate yet (M4.0 baseline): no assert section, run collect and upload
// only, never autorun (autorun would assert lighthouse:recommended):
//
//   cd web && npx lhci collect --config=tests/e2e/lighthouse/lighthouserc.app.cjs
//   cd web && npx lhci upload --config=tests/e2e/lighthouse/lighthouserc.app.cjs
//   node scripts/perf/lighthouse-summary.mjs --dir=web/.lighthouseci
//
// (each through scripts/dev/qa-run.mjs). Everything else is the public-page gate's setup (lighthouserc.cjs): the mobile preset, 3 runs,
// the same browser flags and, without SPEEDCLUB_BASE_URL, the front tls-front.mjs (HTTPS, HTTP/2, gzip, files of the export from the
// Apache on :8080).
//
// Pages: SPEEDCLUB_LHCI_APP=dev (set below unless given), so tls-front sends documents and API calls to the Apache on :8080 as well.
// Its production-like PHP instance (php -S) cannot serve a deep /app route: the built-in server takes public/app/index.html as the
// script for /app/*, Laravel's base path becomes /app and /app/v/{slug} answers the Blade page /v/{slug} with its assets under /app
// (404s) (M4.0, verified with php -S on this checkout). /app/ itself measured the same in both modes (M4.0 baseline). The Apache answers
// /app/* with SpaController, a static index.html; the API calls of the app then run with the dev server's debug on and no caches.
//
// URLs: /app/ (what a guest lands on) and /app/v/{flagship slug} (VEH-01 of the flagship build, docs/HANDOFF.md §4), from
// SPEEDCLUB_DEMO_SLUG or demo-targets.json. M4.18 turns this into a gate by adding the §12 assertions.
process.env.SPEEDCLUB_LHCI_APP ??= 'dev';

const base = require('./lighthouserc.cjs');

const collect = base.ci.collect;
const origin = new URL(collect.url[0]).origin;
const slug = new URL(collect.url[1]).pathname.replace(/^\/v\//, '');

module.exports = {
  ci: {
    collect: {
      ...collect,
      url: [`${origin}/app/`, `${origin}/app/v/${slug}`],
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci/reports-app',
    },
  },
};
