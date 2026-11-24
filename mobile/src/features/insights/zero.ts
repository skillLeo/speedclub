import type { Insights } from '@/api/queries/insights';

import { berlinDayKey } from './beacon';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 30;

/**
 * Insights with nothing counted (the forced empty state of the visual matrix, `qaState=empty`): 30 days of zeros up to today, the
 * scope of the real answer when there is one. Nothing here is a number anybody earned.
 */
export function zeroInsights(base: Insights | undefined, today: Date, headline: string): Insights {
  const days = Array.from({ length: DAYS }, (_, index) => ({
    date: berlinDayKey(new Date(today.getTime() - (DAYS - 1 - index) * DAY_MS)),
    views: 0,
    scans: 0,
  }));
  const pair = { this_week: 0, last_week: 0 };
  return {
    scope: base?.scope ?? 'account',
    vehicle: base?.vehicle ?? null,
    as_of: base?.as_of ?? today.toISOString(),
    counting_since: null,
    headline,
    views: { ...pair, delta_percent: null, trend: 'same', total_30_days: 0 },
    days,
    sources: (base?.sources ?? []).map((row) => ({ ...row, views: 0, percent: null })),
    sticker_scans: base?.sticker_scans ? { ...pair, total_30_days: 0, total: 0 } : null,
    spots: pair,
    follows: { profile: base?.follows.profile ? pair : null, vehicles: pair },
    saves: pair,
    reactions: { ...pair, by_type: [] },
    breakdown: [],
  };
}
