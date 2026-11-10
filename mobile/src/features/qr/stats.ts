/**
 * QR-02 [SIG `sig.qr_stats`] (FS-9): the scans row reads the 14 daily counts of `qr/stats` as mini bars and the milestone line
 * of 02_PRODUCT_SPEC §7 (10, 50, 100, 500, 1000 scans). No identities, only counts.
 */

/** The milestones of the in-app `qr_milestone` notification, ascending. */
export const QR_MILESTONES = [10, 50, 100, 500, 1000] as const;

export type BarScale = {
  /** The tallest bar, the chart's own height. */
  max: number;
  /** A day without scans: a stub, so the 14 days still read as a series. */
  empty: number;
  /** The lowest bar of a day with scans, so one scan never looks like none. */
  min: number;
};

/**
 * The height of each day's bar. The busiest day fills the chart; every other day is in proportion to it, never below `min`
 * when it had a scan. A series without scans is all stubs. Rounded to whole points, so bars of equal counts line up.
 */
export function miniBarHeights(counts: readonly number[], scale: BarScale): number[] {
  const safe = counts.map((count) => (Number.isFinite(count) && count > 0 ? count : 0));
  const top = Math.max(0, ...safe);
  return safe.map((count) => {
    if (count === 0 || top === 0) return scale.empty;
    return Math.max(scale.min, Math.round((count / top) * scale.max));
  });
}

export type Milestone = {
  /** The highest milestone the total has reached, or null below the first. */
  reached: number | null;
  /** The next one, or null once the last is reached. */
  next: number | null;
};

/**
 * The milestone line. The server says which milestones the total has reached (`milestones_reached`, ascending); the next one is
 * the first above the highest of them. Without that list the total decides, with the same thresholds.
 */
export function milestoneFor(total: number, reachedList?: readonly number[]): Milestone {
  const value = Number.isFinite(total) && total > 0 ? total : 0;
  const known = (reachedList ?? []).filter((entry) => (QR_MILESTONES as readonly number[]).includes(entry));
  const reached = reachedList ? (known.length > 0 ? Math.max(...known) : null) : (QR_MILESTONES.filter((entry) => value >= entry).at(-1) ?? null);
  const next = QR_MILESTONES.find((entry) => entry > (reached ?? 0)) ?? null;
  return { reached, next };
}
