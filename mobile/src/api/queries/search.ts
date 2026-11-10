/**
 * DISC-02 P1-lite: text search over public builds and discoverable members (m1.8 API handover). The overview carries the
 * first 10 vehicles and 5 members with the real totals; `search/vehicles` and `search/users` continue after the last item
 * shown, from the overview's `next_cursor`.
 *
 * Results are not persisted for an offline start (`meta.persist`): every query typed would grow the stored cache, and the
 * device keeps only the recent search terms (§3.7). A query whose key changes is cancelled, because the fetch hands the
 * signal on: typing fast never lets an older answer replace a newer one.
 */
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api, apiData } from '@/api/client';
import { retryUnlessAnswered, usePublicViewer } from '@/api/queries/vehicles';
import type { components, operations } from '@/api/schema';
import { activeChips, type SearchFilters, type SearchSort } from '@/features/discover/filters';

export type SearchOverview = components['schemas']['SearchOverviewResource'];
export type SearchMember = components['schemas']['MemberSearchResource'];
export type SearchVehicle = components['schemas']['FeedVehicleResource'];
export type SearchKind = 'vehicles' | 'members';
export type Facets = components['schemas']['FacetsResource'];
export type Interpretation = components['schemas']['InterpretationResource'];

type VehicleQuery = NonNullable<operations['v1.search.vehicles']['parameters']['query']>;
/** The filter part of a search request, in the API's names (lists bracketed, m2.3 handover §2). */
export type FilterQuery = Omit<VehicleQuery, 'q' | 'sort' | 'per_page' | 'cursor'>;

/** What DISC-02 asks for besides the text: the filters of the URL and an explicit sort (contract §1). */
export type SearchCriteria = { readonly filters: SearchFilters; readonly sort: SearchSort | null };

/**
 * The filters as the API's query: lists as bracketed arrays, diameters as numbers. The enum lists carry what the URL said; a value
 * the API does not know comes back as a 422 on that filter, which the screen shows.
 */
export function filterQuery(filters: SearchFilters): FilterQuery {
  const query: FilterQuery = {};
  if (filters.make) query.make = filters.make;
  if (filters.model) query.model = filters.model;
  if (filters.generation) query.generation = filters.generation;
  if (filters.year.min !== null) query.year_min = filters.year.min;
  if (filters.year.max !== null) query.year_max = filters.year.max;
  if (filters.power.min !== null) query.power_min = filters.power.min;
  if (filters.power.max !== null) query.power_max = filters.power.max;
  if (filters.drivetrain.length) query['drivetrain[]'] = [...filters.drivetrain] as NonNullable<FilterQuery['drivetrain[]']>;
  if (filters.gearbox.length) query['gearbox[]'] = [...filters.gearbox] as NonNullable<FilterQuery['gearbox[]']>;
  if (filters.fuel.length) query['fuel[]'] = [...filters.fuel] as NonNullable<FilterQuery['fuel[]']>;
  if (filters.wheel_diameter.length) query['wheel_diameter[]'] = filters.wheel_diameter.map(Number);
  for (const key of ['wheel_brand', 'suspension_type', 'suspension_brand', 'exhaust_brand', 'mod_category'] as const) {
    if (filters[key].length) query[`${key}[]`] = [...filters[key]];
  }
  return query;
}

/** A stable key for the criteria: the chips in their order and the sort. Empty when there are none. */
export function criteriaKey(criteria: SearchCriteria | undefined): string {
  if (!criteria) return '';
  const chips = activeChips(criteria.filters).map((chip) => chip.id);
  return chips.length === 0 && !criteria.sort ? '' : `${chips.join('|')}#${criteria.sort ?? ''}`;
}

function hasCriteriaKey(key: string): boolean {
  return key !== '';
}

/** What the API accepts (`q` at most 100 characters). */
export const SEARCH_MAX_LENGTH = 100;
/** Per page after the overview; the API allows 1 to 50. */
export const SEARCH_PAGE_SIZE = 20;

/** The query as it is sent and kept in the URL: trimmed, inner runs of space as one, at most 100 characters. */
export function normalizeQuery(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH).trim();
}

export const searchKeys = {
  all: ['search'] as const,
  overview: (viewer: string, q: string, criteria: string = '') => ['search', viewer, q, criteria] as const,
  more: (viewer: string, q: string, criteria: string, kind: SearchKind, cursor: string) => ['search', viewer, q, criteria, kind, cursor] as const,
  facets: (viewer: string, q: string, criteria: string) => ['search', viewer, 'facets', q, criteria] as const,
  interpret: (viewer: string, q: string) => ['search', viewer, 'interpret', q] as const,
};

/**
 * The overview for `q`. While the next query loads, the previous answer stays on screen (`isPlaceholderData`), so the
 * list does not flash back to the skeleton on every key press.
 */
export function useSearchOverview(q: string, criteria?: SearchCriteria) {
  const viewer = usePublicViewer();
  const key = criteriaKey(criteria);
  return useQuery({
    queryKey: searchKeys.overview(viewer, q, key),
    queryFn: async ({ signal }) => {
      const query = {
        ...(q ? { q } : {}),
        ...(criteria ? filterQuery(criteria.filters) : {}),
        ...(criteria?.sort ? { sort: criteria.sort } : {}),
      };
      return (await apiData(api.GET('/search', { params: { query }, signal }))).data;
    },
    enabled: q !== '' || hasCriteriaKey(key),
    placeholderData: keepPreviousData,
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

type Page<T> = { data: T[]; meta: { next_cursor: string | null } };

function useMore<T>(
  kind: SearchKind,
  q: string,
  criteria: string,
  cursor: string | null,
  enabled: boolean,
  fetcher: (cursor: string, signal: AbortSignal) => Promise<Page<T>>,
) {
  const viewer = usePublicViewer();
  return useInfiniteQuery({
    queryKey: searchKeys.more(viewer, q, criteria, kind, cursor ?? ''),
    queryFn: ({ pageParam, signal }) => fetcher(pageParam, signal),
    initialPageParam: cursor ?? '',
    getNextPageParam: (last: Page<T>) => last.meta.next_cursor ?? undefined,
    enabled: enabled && cursor !== null && (q !== '' || hasCriteriaKey(criteria)),
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

/**
 * The results after the overview's first items, from its `next_cursor`. Starts only when `enabled` turns true (the end
 * of the list came into view), and never without a cursor.
 */
export function useMoreVehicles(q: string, cursor: string | null, enabled: boolean, criteria?: SearchCriteria) {
  return useMore<SearchVehicle>('vehicles', q, criteriaKey(criteria), cursor, enabled, (page, signal) =>
    apiData(
      api.GET('/search/vehicles', {
        params: {
          query: {
            ...(q ? { q } : {}),
            ...(criteria ? filterQuery(criteria.filters) : {}),
            ...(criteria?.sort ? { sort: criteria.sort } : {}),
            cursor: page,
            per_page: SEARCH_PAGE_SIZE,
          },
        },
        signal,
      }),
    ),
  );
}

/** Members are found by text only (m2.3 handover §2): the filters never narrow them. */
export function useMoreMembers(q: string, cursor: string | null, enabled: boolean) {
  return useMore<SearchMember>('members', q, '', cursor, enabled, (page, signal) =>
    apiData(api.GET('/search/users', { params: { query: { q, cursor: page, per_page: SEARCH_PAGE_SIZE } }, signal })),
  );
}

/**
 * The facet counts for a text and filter set (contract §2, handover §3): disjunctive, so "BMW (12)" stays next to an active
 * "Audi". While the next set loads the last answer stays, so the sheet's counts and its live total do not flash.
 */
export function useSearchFacets(q: string, filters: SearchFilters, enabled: boolean) {
  const viewer = usePublicViewer();
  const key = criteriaKey({ filters, sort: null });
  return useQuery({
    queryKey: searchKeys.facets(viewer, q, key),
    queryFn: async ({ signal }) =>
      (await apiData(api.GET('/search/facets', { params: { query: { ...(q ? { q } : {}), ...filterQuery(filters) } }, signal }))).data,
    enabled,
    placeholderData: keepPreviousData,
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

/**
 * Query understanding (contract §3): what `search/interpret` reads from a submitted text, as chips the screen applies as visible
 * filters. The same text is read once per session.
 */
export function interpretQuery(viewer: string, q: string) {
  return {
    queryKey: searchKeys.interpret(viewer, q),
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      (await apiData(api.GET('/search/interpret', { params: { query: { q } }, signal }))).data,
    staleTime: Infinity,
    retry: false,
    meta: { persist: false },
  } as const;
}

/** The first items and every page loaded after them, each once. */
export function mergeResults<T>(first: readonly T[], pages: readonly { data: readonly T[] }[] | undefined, keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const list: T[] = [];
  for (const item of [...first, ...(pages ?? []).flatMap((page) => page.data)]) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(item);
  }
  return list;
}

/** "124", or "1000+" when the server stopped counting (`count_capped`). */
export function countLabel(count: number, capped: boolean, formatNumber: (value: number) => string): string {
  return capped ? `${formatNumber(count)}+` : formatNumber(count);
}
