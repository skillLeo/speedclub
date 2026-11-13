// Member web (/app) Lighthouse gate, 09 §12 (mobile preset): Performance ≥ 80, LCP ≤ 2.5 s, CLS ≤ 0.05, TBT ≤ 300 ms.
// The same collection as lighthouserc.app.cjs (the M4.0 measurement), plus these assertions. Run by
// `scripts/verify.ps1 -Phase 4` through `npm --prefix web run lhci:app`. It is expected to fail until the Phase 4 performance
// work lands (M4.0 baseline: Performance 38, LCP 17.5 s, TBT 673 ms; docs/reports/phase-4/baseline/numbers.md).
// Medians over the collected runs, like the measurement.
const app = require('./lighthouserc.app.cjs');

module.exports = {
  ci: {
    ...app.ci,
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.8, aggregationMethod: 'median-run' }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500, aggregationMethod: 'median-run' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05, aggregationMethod: 'median-run' }],
        'total-blocking-time': ['error', { maxNumericValue: 300, aggregationMethod: 'median-run' }],
      },
    },
  },
};
