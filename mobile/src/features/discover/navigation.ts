import type { Href } from 'expo-router';

import { normalizeQuery } from '@/api/queries/search';

import { EMPTY_STATE, parseSearchParams, searchParamsOf, type SearchSort } from './filters';

/** The URL flag that asks DISC-02 to read the submitted text for filters once (contract §3), then drop the flag. */
export const UNDERSTAND_PARAM = 'understand';

/**
 * DISC-02 with the query in the URL, so a result list can be linked, reloaded and reached with back. `understand` marks a text
 * that was submitted (Enter, a recent search): DISC-02 then turns what `search/interpret` reads into visible filter chips.
 */
export function searchPath(query: string, options: { understand?: boolean } = {}): Href {
  const q = normalizeQuery(query);
  if (!q) return '/discover/search';
  return { pathname: '/discover/search', params: options.understand ? { q, [UNDERSTAND_PARAM]: '1' } : { q } };
}

/** A Kollektion opens DISC-02 with its filters and sort as visible chips (m2.3 handover §6). */
export function collectionPath(filters: Readonly<Record<string, unknown>>, sort: SearchSort | null): Href {
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) raw[key] = value.map(String).join(',');
    else if (typeof value === 'string' || typeof value === 'number') raw[key] = String(value);
  }
  const state = { ...EMPTY_STATE, filters: parseSearchParams(raw).filters, sort };
  const params = searchParamsOf(state);
  return Object.keys(params).length > 0 ? { pathname: '/discover/search', params } : { pathname: '/discover/search', params: { sort: 'newest' } };
}

/** DISC-03 of a make, by its slug. */
export function makePath(make: string): Href {
  return { pathname: '/discover/make/[make]', params: { make } };
}

/** DISC-04 of a model, by its composite key (`bmw--m4`, handover §1), optionally at one generation. */
export function modelPath(key: string, generation?: string | null): Href {
  return { pathname: '/discover/model/[model]', params: generation ? { model: key, generation } : { model: key } };
}
