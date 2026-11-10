import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';

/** Back, or after a direct link with nothing to go back to, the given place. */
export function useBack(fallback: Href): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [fallback, router]);
}

/** The route parameter as one string: Expo Router hands repeated parameters over as an array. */
export function paramOf(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() !== '' ? first : undefined;
}
