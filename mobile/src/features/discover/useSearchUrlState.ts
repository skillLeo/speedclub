import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { paramsPatch, parseSearchParams, type SearchState } from './filters';
import { UNDERSTAND_PARAM } from './navigation';

/**
 * DISC-02's state is its URL (contract §8): parsed from the route's params, written back with `setParams`, which replaces
 * the entry rather than pushing one, so back leaves the results and a reload or a shared link shows the same list.
 */
export function useSearchUrlState() {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  // The params object is new on every render; its serialised form is what changes.
  const key = JSON.stringify(params);
  const state = useMemo(() => parseSearchParams(JSON.parse(key) as Record<string, string | string[]>), [key]);
  const update = useCallback(
    (next: SearchState | ((current: SearchState) => SearchState)) => {
      const value = typeof next === 'function' ? next(state) : next;
      // Any write consumes the request to read the text for filters (DISC-01's submit).
      router.setParams({ ...paramsPatch(value), [UNDERSTAND_PARAM]: undefined });
    },
    [router, state],
  );
  return { state, update };
}
