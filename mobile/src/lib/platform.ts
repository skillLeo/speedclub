import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

export const isWeb = Platform.OS === 'web';
export const isIOS = Platform.OS === 'ios';
export const isAndroid = Platform.OS === 'android';
export const isNative = !isWeb;

/** A mouse or trackpad: hover and a fine pointer. A phone or tablet browser matches neither. */
export const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

type MatchMediaHost = { matchMedia?: (query: string) => MediaQueryList };

/** The fine-pointer media query of this window; null natively and where the browser has no matchMedia. */
export function finePointerQuery(web: boolean = isWeb, host: MatchMediaHost | undefined = globalThis as MatchMediaHost): MediaQueryList | null {
  if (!web || typeof host?.matchMedia !== 'function') return null;
  return host.matchMedia(FINE_POINTER_QUERY);
}

/** Whether the device points with a mouse or trackpad now: copy about arrow keys and hover is for it, touch gets drag and pinch. */
export function hasFinePointer(web: boolean = isWeb, host?: MatchMediaHost): boolean {
  return finePointerQuery(web, host)?.matches ?? false;
}

function subscribeFinePointer(onChange: () => void): () => void {
  const query = finePointerQuery();
  if (!query) return () => undefined;
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const finePointerNow = () => hasFinePointer();

/**
 * R5DQ-02: whether to speak of arrow keys or of fingers. Chosen by input, not by platform: the member web on an iPhone is touch.
 * False natively; live on the web (a tablet with a keyboard and trackpad attached switches over).
 */
export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribeFinePointer, finePointerNow, () => false);
}
