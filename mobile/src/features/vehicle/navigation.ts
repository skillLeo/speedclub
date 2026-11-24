import type { Href } from 'expo-router';

import { useBackOr } from '@/lib/backNavigation';

/**
 * Back, or after a direct link with nothing to go back to, the given place. R4B-007: also when the only route below is the tab
 * root Expo Router added for the direct link (`lib/backNavigation`).
 */
export function useBack(fallback: Href): () => void {
  return useBackOr(fallback);
}

/** The route parameter as one string: Expo Router hands repeated parameters over as an array. */
export function paramOf(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() !== '' ? first : undefined;
}

/** M5.3 "Plan anlegen": GAR-10 for a new mod with the status Geplant preset; the editor asks for the system first. */
export function planHref(vehicleId: string) {
  return { pathname: '/garage/[id]/mods/[modId]', params: { id: vehicleId, modId: 'new', status: 'planned' } } as const;
}
