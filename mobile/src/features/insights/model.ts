/**
 * INS-01 and build-goal wording rules (10 §6.1, §6.2, §16; m5.7-contract §3.4, §4.1). Pure, for the tests.
 *
 * Safety (10 §16, contract hard rule 3): fewer views are never a percentage, never a loss word and never red. A decrease reads
 * "Letzte Woche: 98" next to this week's number; only a rise names its percentage.
 */
import type { TFunction } from 'i18next';

import type { BuildGoal, Insights, InsightsTrend } from '@/api/queries/insights';

import { GOAL_SEASONS_AHEAD } from '@/api/queries/insights';

type Format = { number: (value: number) => string };

/** The plain-words line under this week's number. Never a "−" and never "weniger". */
export function deltaLine(
  t: TFunction<'profile'>,
  views: { this_week: number; last_week: number; delta_percent: number | null; trend: InsightsTrend },
  format: Format,
): string {
  if (views.this_week === 0 && views.last_week === 0) return t('insights.delta.none');
  if (views.trend === 'new') return t('insights.delta.new');
  if (views.trend === 'up' && views.delta_percent !== null && views.delta_percent > 0) {
    return t('insights.delta.up', { percent: format.number(views.delta_percent) });
  }
  if (views.trend === 'same' || views.this_week === views.last_week) return t('insights.delta.same');
  // Down, or a rise on a base too small for a percentage: what last week was, as a plain number.
  return t('insights.delta.lastWeek', { value: format.number(views.last_week) });
}

/** Nothing at all in the 30 days: the first state is a sentence and one way on (STK-04's DQ-M54-12), not counters full of zeros. */
export function isQuiet(insights: Insights): boolean {
  const week = (pair: { this_week: number; last_week: number } | null) => (pair ? pair.this_week + pair.last_week : 0);
  return (
    insights.views.total_30_days === 0 &&
    insights.views.this_week === 0 &&
    (insights.sticker_scans?.total_30_days ?? 0) === 0 &&
    week(insights.spots) === 0 &&
    week(insights.follows.profile) === 0 &&
    week(insights.follows.vehicles) === 0 &&
    week(insights.saves) === 0 &&
    week(insights.reactions) === 0
  );
}

/** "Zählung seit 16. Nov.": only when counting started inside the 30 days the chart shows. */
export function countingSinceInside(insights: Insights): string | null {
  const since = insights.counting_since;
  const first = insights.days[0]?.date;
  if (!since || !first) return null;
  return since > first ? since : null;
}

/** The sources with views, most first (the server's order), with their share; all four while none has any. */
export function topSources(insights: Insights): Insights['sources'] {
  const withViews = insights.sources.filter((row) => row.views > 0);
  return withViews.length > 0 ? withViews : insights.sources;
}

/** "Stark 9 · Sauber 6 · Tief 4": the types with a count this week, in the server's order. */
export function reactionSummary(insights: Insights, format: Format): string | null {
  const parts = insights.reactions.by_type.filter((row) => row.count > 0 && row.label).map((row) => `${row.label} ${format.number(row.count)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The current year in Berlin. */
export function berlinYear(date: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric' }).format(date));
}

/** The last month of a car season (it runs into October); from November the year's season is over for a new goal. */
export const SEASON_LAST_MONTH = 10;

/** The month (1–12) in Berlin. */
export function berlinMonth(date: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', month: 'numeric' }).format(date));
}

/** DQ-P5-035 c: the first season the goal sheet offers: this year's until October, the next one from November. */
export function firstGoalSeason(date: Date): number {
  const year = berlinYear(date);
  return berlinMonth(date) > SEASON_LAST_MONTH ? year + 1 : year;
}

/**
 * The seasons the goal sheet offers: from `first` (this year, or next year once this season is over) to ten years after this year (the
 * server's range), plus a stored season before `first` so the owner sees what is set (the server accepts it unchanged).
 */
export function goalSeasons(year: number, stored: number | null, first: number = year): number[] {
  const seasons: number[] = [];
  for (let season = first; season <= year + GOAL_SEASONS_AHEAD; season += 1) seasons.push(season);
  return stored !== null && stored < first ? [stored, ...seasons] : seasons;
}

/** Whether a visitor sees the goal: set and not over (contract §4.1, D-5). The owner sees it in every case. */
export function goalVisibleTo(goal: BuildGoal | null | undefined, owner: boolean): goal is BuildGoal {
  if (!goal) return false;
  return owner || !goal.passed;
}

/** The goal as the page shows it right after a change, before the server's answer (the label is the app's own). */
export function optimisticGoal(season: number | null, year: number, label: string): BuildGoal | null {
  return season === null ? null : { season, label, passed: season < year };
}
