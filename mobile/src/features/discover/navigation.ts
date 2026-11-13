import type { Href } from 'expo-router';

import { normalizeQuery } from '@/api/queries/search';

import { EMPTY_STATE, parseSearchParams, searchParamsOf, type SearchSort } from './filters';

/** The URL flag that asks DISC-02 to read the submitted text for filters once (contract §3), then drop the flag. */
export const UNDERSTAND_PARAM = 'understand';

/**
 * DISC-02 with the query in the URL, so a result list can be linked, reloaded and reached with back. `understand` marks a text
 * that was submitted (Enter, a recent search): DISC-02 then turns what `search/interpret` reads into visible filter chips.
 */
export function searchPath(query: string, options: { understand?: boolean; scope?: SearchScope } = {}): Href {
  const q = normalizeQuery(query);
  if (!q) return '/discover/search';
  const params: Record<string, string> = { q };
  if (options.understand) params[UNDERSTAND_PARAM] = '1';
  if (options.scope && options.scope !== 'all') params[SCOPE_PARAM] = options.scope;
  return { pathname: '/discover/search', params };
}

/** DISC-01's scope chips (09 §7.5): Alles · Builds · Mitglieder. Treffen, Betriebe and Teile follow with their modules (M4.12, M4.14). */
export const SEARCH_SCOPES = ['all', 'vehicles', 'members'] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];
/** The URL param that carries a scope other than "Alles" to DISC-02. */
export const SCOPE_PARAM = 'scope';

/** A scope from the URL; anything else is "Alles". */
export function searchScopeOf(value: string | null | undefined): SearchScope {
  return (SEARCH_SCOPES as readonly string[]).includes(value ?? '') ? (value as SearchScope) : 'all';
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
