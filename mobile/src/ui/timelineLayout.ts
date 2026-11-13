/** 09 §5 Timeline: the pure parts, so Jest covers them. */

/** The photo grid of an entry is 3-up (09 §5). */
export const TIMELINE_PHOTOS_MAX = 3;

/** Consecutive entries with the same date under one heading, in their order (the API sorts newest first). */
export function timelineGroups<T extends { date: string }>(entries: readonly T[]): { date: string; entries: T[] }[] {
  const groups: { date: string; entries: T[] }[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.date === entry.date) last.entries.push(entry);
    else groups.push({ date: entry.date, entries: [entry] });
  }
  return groups;
}
