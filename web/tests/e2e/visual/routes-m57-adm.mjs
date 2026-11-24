// Visual registry entries of M5.7 admin: ADM-70 Insights overview under Plattform (10 §11, m5.7-contract §9). Same fields as routes.mjs,
// which merges this list. Data: the platform's live totals (view_days, qr_scan_daily, weekly_recaps, engagement_daily) — whatever the
// local database and the e2e runs have counted — so the default cells are volatile (ADR-223); the forced states are fixtures.

export const routesM57Adm = [
  {
    id: 'ADM-70',
    volatile: true,
    path: '/admin/insights',
    phase: 3,
    auth: 'staff-content',
    states: ['default', 'loading', 'empty', 'error'],
    ready: '[data-testid="ADM-70"][data-qa-state="ready"] [data-testid="ADM-70.kpis"], [data-testid="ADM-70"]:not([data-qa-state="ready"])',
    notes: 'Insights as the content editor (content.view): the period switch 7 · 30 · 90 Tage (30 chosen), the privacy line "Nur Summen der ganzen Plattform …" and "Aufrufe gezählt seit …"; four KPI tiles (Aufrufe, Sticker-Scans for the period; Build-Erinnerungen and Gedrosselte Pushes for the last 7 days, "über 3 pro Woche"); the line chart "Wie oft werden Profile und Autos angesehen?" (Aufrufe in the accent, Sticker-Scans neutral) beside the bars "Woher kommen die Aufrufe?" (App · Web · Sticker-Scan · Geteilter Link); the Wochenrückblicke table (KW · dates, Verschickt / Übersprungen / Nicht erreichbar, right-aligned) with its legend. empty = "Noch keine Daten"; loading = tiles and charts in their skeletons; error = the retry block.',
  },
  {
    id: 'ADM-70-7',
    volatile: true,
    path: '/admin/insights?days=7',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: '[data-testid="ADM-70"][data-qa-state] [data-testid="ADM-70.period"]',
    notes: 'The 7-day period: seven day labels on the line chart, the source bars as "Summe der letzten 7 Tage", recap weeks of this and last week only.',
  },
  {
    id: 'ADM-70-90',
    volatile: true,
    path: '/admin/insights?days=90',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: '[data-testid="ADM-70"][data-qa-state] [data-testid="ADM-70.period"]',
    notes: 'The 90-day period: the line chart with at most eight date ticks, recap weeks back to 12 (the retention).',
  },
];
