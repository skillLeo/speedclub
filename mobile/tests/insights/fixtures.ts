/** M5.7 INS-01 answers as the server sends them (m5.7-contract §3.2). */
export const CAR = '01m6f7zv1vs5e2xw9a96cbqzyp';

const DAY_MS = 24 * 60 * 60 * 1000;

export function days(views: (index: number) => number, scans: (index: number) => number = () => 0) {
  const start = Date.UTC(2026, 9, 18);
  return Array.from({ length: 30 }, (_, index) => ({
    date: new Date(start + index * DAY_MS).toISOString().slice(0, 10),
    views: views(index),
    scans: scans(index),
  }));
}

export function insights(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'account',
    vehicle: null,
    as_of: '2026-11-16T09:12:00+01:00',
    counting_since: '2026-10-01',
    headline: 'Deine Garage wurde diese Woche 128-mal angesehen – 31 % mehr als letzte Woche.',
    views: { this_week: 128, last_week: 98, delta_percent: 31, trend: 'up', total_30_days: 402 },
    days: days((index) => (index % 5) + 8, (index) => index % 3),
    sources: [
      { source: 'sticker_scan', label: 'Sticker-Scan', views: 180, percent: 45 },
      { source: 'app', label: 'App', views: 120, percent: 29 },
      { source: 'web', label: 'Web', views: 70, percent: 17 },
      { source: 'shared_link', label: 'Geteilter Link', views: 32, percent: 7 },
    ],
    sticker_scans: { this_week: 14, last_week: 9, total_30_days: 51, total: 640 },
    spots: { this_week: 6, last_week: 2 },
    follows: { profile: { this_week: 3, last_week: 1 }, vehicles: { this_week: 2, last_week: 0 } },
    saves: { this_week: 4, last_week: 3 },
    reactions: {
      this_week: 21,
      last_week: 17,
      by_type: [
        { type: 'strong', label: 'Stark', count: 9 },
        { type: 'clean', label: 'Sauber', count: 6 },
        { type: 'low', label: 'Tief', count: 4 },
        { type: 'loud', label: 'Laut', count: 2 },
      ],
    },
    breakdown: [
      { subject: 'profile', vehicle: null, views_this_week: 40 },
      { subject: 'vehicle', vehicle: { id: CAR, slug: 'nissan-skyline-gt-r-r34-5tf974vj', full_title: 'Nissan Skyline GT-R R34', cover: null, is_sample: false }, views_this_week: 88 },
    ],
    ...overrides,
  };
}

/** Nothing counted yet: zeros everywhere, the server's zero sentence. */
export function zero(overrides: Record<string, unknown> = {}) {
  const pair = { this_week: 0, last_week: 0 };
  return insights({
    headline: 'Diese Woche noch keine Aufrufe. Teil deinen Build, damit ihn mehr Leute sehen.',
    counting_since: null,
    views: { this_week: 0, last_week: 0, delta_percent: null, trend: 'same', total_30_days: 0 },
    days: days(() => 0),
    sources: ['sticker_scan', 'app', 'web', 'shared_link'].map((source) => ({ source, label: source, views: 0, percent: null })),
    sticker_scans: null,
    spots: pair,
    follows: { profile: pair, vehicles: pair },
    saves: pair,
    reactions: { ...pair, by_type: [] },
    breakdown: [{ subject: 'profile', vehicle: null, views_this_week: 0 }],
    ...overrides,
  });
}
