/**
 * A cursor list whose first page is refreshed on its own (ADR-155 g, BH-42), shared by Neue Builds and the Home stream (M2.2).
 *
 * Two queries, so a long scroll costs neither storage nor requests later on:
 * - the first page is an ordinary query: kept for an offline start, refreshed when stale (one request);
 * - the pages after it continue from the first page's `next_cursor`. They are never stored on the device (`meta.persist`) and
 *   never fetched again by themselves (`enabled: false`): only the end of the list asks for the next one. Pull to refresh starts
 *   the continuation over.
 *
 * When the first page changes underneath, an item that moved up into it is not listed twice: `flattenPages` keeps its first place.
 * What it pushed out is read back once (`closeSeam`).
 */
import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { retryUnlessAnswered } from '@/api/queries/vehicles';

export type CursorPage<T> = { data: T[]; meta: { next_cursor?: string | null } };

/** The pages after the first one, with the cursor each was read from. The first cursor is the seam with the first page. */
type Tail<P> = { pages: P[]; pageParams: (string | null)[] };

/** How far a moved seam is followed before the pages start over: about three pages of new items since the first was read. */
export const MAX_SEAM_PAGES = 3;

/**
 * BH-42: the first page was read again, and its end moved past items on no loaded page. Reads from its new end until the tail's
 * items come back and puts those pages in front, so the list keeps its length under the member's finger. Too far away, or with no
 * cursor left to follow, the tail starts over from the new first page.
 *
 * The anchor is the tail's first item that is not in the new first page. An item only ever moves up (a change) or goes away
 * (unpublished, private, blocked), so the walk is done once the anchor comes back. An anchor that went away never does: the first
 * page holding a later item of the tail closes the seam instead, once the walk has shown that the anchor is nowhere within reach.
 */
async function closeSeam<T, P extends CursorPage<T>>(
  client: QueryClient,
  tailKey: QueryKey,
  head: P,
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<P>,
  idOf: (item: T) => string,
  signal: AbortSignal,
): Promise<void> {
  const tail = client.getQueryData<Tail<P>>(tailKey);
  const inHead = new Set(head.data.map(idOf));
  const tailIds = (tail?.pages ?? []).flatMap((page) => page.data.map(idOf)).filter((id) => !inHead.has(id));
  const anchor = tailIds[0];
  const later = new Set(tailIds.filter((id) => id !== anchor));
  const pages: P[] = [];
  const pageParams: string[] = [];
  /** How many of the pages read end on a later item of the tail: where the seam closes if the anchor is gone. */
  let behindGoneAnchor: number | null = null;
  const prepend = (count: number) =>
    client.setQueryData<Tail<P>>(tailKey, (old) =>
      old ? { pages: [...pages.slice(0, count), ...old.pages], pageParams: [...pageParams.slice(0, count), ...old.pageParams] } : old,
    );
  let next: string | null = head.meta.next_cursor ?? null;
  while (next !== null && anchor !== undefined && pages.length < MAX_SEAM_PAGES) {
    const page: P = await fetchPage(next, signal);
    if (signal.aborted) return;
    pages.push(page);
    pageParams.push(next);
    if (page.data.some((item) => idOf(item) === anchor)) {
      prepend(pages.length);
      return;
    }
    if (behindGoneAnchor === null && page.data.some((item) => later.has(idOf(item)))) behindGoneAnchor = pages.length;
    next = page.meta.next_cursor ?? null;
  }
  if (!signal.aborted && behindGoneAnchor !== null) {
    prepend(behindGoneAnchor);
    return;
  }
  await client.resetQueries({ queryKey: tailKey, exact: true });
}

export type SeamedListOptions<T, P extends CursorPage<T>> = {
  headKey: QueryKey;
  tailKey: QueryKey;
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<P>;
  idOf: (item: T) => string;
  enabled?: boolean;
  /**
   * An answer that says the continuation's cursor no longer holds (Für dich: 409 `feed_stale` after an hourly re-rank, ADR-195).
   * The list then starts over from a fresh first page instead of showing the error under the last item.
   */
  isStaleCursor?: (error: unknown) => boolean;
};

export type SeamedList<P> = {
  data: { pages: P[] } | undefined;
  error: unknown;
  isPending: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  isFetching: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<unknown>;
};

export function useSeamedList<T, P extends CursorPage<T>>({ headKey, tailKey, fetchPage, idOf, enabled = true, isStaleCursor }: SeamedListOptions<T, P>): SeamedList<P> {
  const client = useQueryClient();
  const head = useQuery({
    queryKey: headKey,
    queryFn: ({ signal }) => fetchPage(null, signal),
    retry: retryUnlessAnswered,
    enabled,
  });
  const headCursor = head.data?.meta.next_cursor ?? null;
  const tail = useInfiniteQuery({
    queryKey: tailKey,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    initialPageParam: headCursor,
    getNextPageParam: (last: P) => last.meta.next_cursor ?? undefined,
    enabled: false,
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });

  const pages = useMemo<P[] | undefined>(() => (head.data ? [head.data, ...(tail.data?.pages ?? [])] : undefined), [head.data, tail.data]);
  const hasNextPage = tail.data ? tail.hasNextPage : headCursor !== null;
  const { fetchNextPage: fetchTail } = tail;
  // The keys are rebuilt by the caller on every render: their content is what counts.
  const tailHash = JSON.stringify(tailKey);
  const stableTailKey = useMemo<QueryKey>(() => JSON.parse(tailHash) as QueryKey, [tailHash]);
  // fetchPage and idOf are module functions of the caller; the seam follows the data, not their identity.
  const reader = useRef({ fetchPage, idOf });
  useEffect(() => {
    reader.current = { fetchPage, idOf };
  });
  const fetchNextPage = useCallback(async () => {
    if (!head.data || !hasNextPage) return;
    await fetchTail();
  }, [fetchTail, hasNextPage, head.data]);
  // Each answer of the first page looks again, so a read that failed offline is made up for by the next refresh.
  const seam = tail.data?.pageParams[0];
  const headData = head.data;
  useEffect(() => {
    if (!headData || seam === undefined || seam === (headData.meta.next_cursor ?? null)) return undefined;
    const controller = new AbortController();
    const { fetchPage: read, idOf: id } = reader.current;
    closeSeam(client, stableTailKey, headData, read, id, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [client, headData, seam, stableTailKey]);
  const { refetch: refetchHead } = head;
  const refetch = useCallback(async () => {
    await client.resetQueries({ queryKey: stableTailKey, exact: true });
    return refetchHead();
  }, [client, refetchHead, stableTailKey]);
  // A stale cursor (the server re-ranked under the member's finger) starts the list over, once per failed read.
  const tailError = tail.error;
  const staleRef = useRef(isStaleCursor);
  useEffect(() => {
    staleRef.current = isStaleCursor;
  });
  useEffect(() => {
    if (tailError && staleRef.current?.(tailError)) void refetch();
  }, [refetch, tailError]);

  return {
    data: pages ? { pages } : undefined,
    error: head.error,
    isPending: head.isPending,
    fetchStatus: head.fetchStatus,
    isFetching: head.isFetching || tail.isFetching,
    hasNextPage,
    isFetchingNextPage: tail.isFetchingNextPage,
    isFetchNextPageError: tail.isFetchNextPageError,
    fetchNextPage,
    refetch,
  };
}

/** The pages as one list. An item that moved up between two pages would come twice: the first place wins. */
export function flattenPages<T>(pages: readonly { data: readonly T[] }[] | undefined, idOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const list: T[] = [];
  for (const page of pages ?? []) {
    for (const item of page.data) {
      const id = idOf(item);
      if (seen.has(id)) continue;
      seen.add(id);
      list.push(item);
    }
  }
  return list;
}
