/**
 * Maps load their tiles from OpenFreeMap and MapLibre from a CDN: third parties that see the reader's IP address. On a page that
 * only shows a place (EVT-02 snippet, the EVT-03 picker) the map therefore waits for a tap ("Karte anzeigen"); choosing the map
 * view of EVT-01 is that tap already. The answer holds for the app session, never longer, and is never sent anywhere.
 */
import { useSyncExternalStore } from 'react';

let granted = false;
const listeners = new Set<() => void>();

export function grantMapConsent(): void {
  if (granted) return;
  granted = true;
  for (const listener of listeners) listener();
}

/** Tests only. */
export function resetMapConsent(): void {
  granted = false;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMapConsent(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => granted,
    () => granted,
  );
}
