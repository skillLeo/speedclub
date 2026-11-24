/**
 * The bundled scan counts of the non-production override `qaStickers=sample` (mobile/src/lib/qa.ts): STK-01's "diese Woche" and STK-04's
 * 30 days answer from here, so the visual matrix captures a sticker with scans on a host whose demo cars have none. Never shown to a
 * member: `qa` has no overrides in production. Counts only, as the server's (contract §5): no viewer, device or place. The numbers are a
 * plausible car seen at weekend meets (peaks on Saturdays), and the screens badge them "Beispiel".
 */
import { registerStickerQaSource, type StickerStats } from '@/api/queries/stickers';
import { now } from '@/lib/clock';

/** One month of a car that goes to a meet most weekends: quiet weekdays, a peak on Saturday. Oldest first. */
const SAMPLE_COUNTS: readonly number[] = [1, 0, 2, 0, 1, 9, 4, 0, 1, 0, 2, 1, 12, 5, 1, 0, 0, 1, 0, 7, 3, 2, 1, 0, 3, 1, 14, 6, 2, 3];
const SAMPLE_TOTAL = 412;
const SAMPLE_FIRST_SCAN = '2026-03-02';

/** YYYY-MM-DD of a date in German time. */
function berlinDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** A per-car offset into the sample month (DQ-M54-20): two cars never show the same stamped number. */
export function sampleSeed(vehicleId: string): number {
  let sum = 0;
  for (const char of vehicleId) sum += char.charCodeAt(0);
  return sum % SAMPLE_COUNTS.length;
}

export function qaStickerStats(reference: Date = now(), seed: number = 0): StickerStats {
  const counts = SAMPLE_COUNTS.map((_, index) => SAMPLE_COUNTS[(index + seed) % SAMPLE_COUNTS.length] ?? 0);
  const days = counts.map((count, index) => {
    const day = new Date(reference.getTime() - (counts.length - 1 - index) * 24 * 60 * 60 * 1000);
    return { date: berlinDay(day), count };
  });
  const total30 = counts.reduce((sum, count) => sum + count, 0);
  // Monday to today and the whole week before, from the same series.
  const weekday = (reference.getDay() + 6) % 7;
  const thisWeek = counts.slice(counts.length - 1 - weekday).reduce((sum, count) => sum + count, 0);
  const lastWeekEnd = counts.length - 1 - weekday;
  const lastWeek = counts.slice(Math.max(0, lastWeekEnd - 7), lastWeekEnd).reduce((sum, count) => sum + count, 0);
  return {
    days,
    total: SAMPLE_TOTAL,
    total_30_days: total30,
    this_week: thisWeek,
    last_week: lastWeek,
    first_scan_on: SAMPLE_FIRST_SCAN,
    // Shared-link visits are counted from M5.7 on (contract §5): null, as the server sends it today.
    sources: { sticker_scan: total30, link: null },
    milestones_reached: [10, 50, 100],
    sample: true,
  };
}

registerStickerQaSource({
  stats: (vehicleId) => qaStickerStats(now(), sampleSeed(vehicleId)),
  scansThisWeek: (vehicleId) => qaStickerStats(now(), sampleSeed(vehicleId)).this_week,
});
