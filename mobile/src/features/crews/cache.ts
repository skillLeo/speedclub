import type { QueryClient } from '@tanstack/react-query';

import { crewKeys } from '@/api/queries/crews';

type Found = { slug?: unknown; cover?: unknown };

/** Every crew-shaped object of a cached answer: a crew, a page of crews, an invite's crew, an array of any of them. */
function find(value: unknown, slug: string, depth = 0): Found | null {
  if (depth > 8 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const hit = find(entry, slug, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.slug === slug && 'cover' in record) return record as Found;
  for (const key of ['pages', 'data', 'crew']) {
    const hit = find(record[key], slug, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * CREW-01's skeleton takes the page's geometry (R4DQ-04): a crew with a cover opens on the photo, one without on the plain bar. The
 * card the member tapped is already in the cache (CREW-00/04/05, the profile chips), so it tells which; null when nothing is known
 * (a deep link), where the plain page is the likelier one.
 */
export function cachedCrewHasCover(client: QueryClient, slug: string): boolean | null {
  if (!slug) return null;
  for (const [, data] of client.getQueriesData({ queryKey: crewKeys.all })) {
    const hit = find(data, slug);
    if (hit) return hit.cover != null;
  }
  return null;
}
