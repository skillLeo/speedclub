/**
 * The spot's city (contract §8, ADR-508, spike §3): optional, foreground only, approximate. The first scan explains why before
 * the system asks (`locationStep`), and a scan never waits for it: without permission, without a fix or without the city file
 * the spot goes without a city.
 *
 * Privacy (hard): the position lives in a local variable of `resolveSpotCity` and dies with it. It is never returned, stored,
 * logged, put in a query key or cache, a store, the outbox or an error. Errors on the way are swallowed whole, because their
 * messages could carry it. OS reverse geocoding is never used (it would send the position to Google or Apple).
 */
import * as Location from 'expo-location';

import type { SpotCity } from '@/api/queries/dex';
import { isWeb } from '@/lib/platform';
import { getStored, setStored } from '@/lib/storage';

import { loadCities, nearestCity, type CityLoaderDeps } from './cities';

/** A last fix is fresh enough for a city if it is at most 10 minutes old and within 3 km (spike §3). */
export const LAST_KNOWN = { maxAge: 10 * 60 * 1000, requiredAccuracy: 3000 } as const;
/** A scan never waits longer than this for a fix. */
export const FIX_TIMEOUT_MS = 6000;

/**
 * What the scanner does about location for this scan:
 *   granted  read the city
 *   explain  show the explanation sheet first (never asked before, the system may still ask)
 *   off      go without a city and never ask (declined in our sheet, or blocked in the system settings); web always
 */
export type LocationStep = 'granted' | 'explain' | 'off';

export async function locationStep(): Promise<LocationStep> {
  if (isWeb) return 'off';
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.granted) return 'granted';
    if ((await getStored('sc.dexLocation')) !== null) return 'off';
    return permission.canAskAgain ? 'explain' : 'off';
  } catch {
    return 'off';
  }
}

/** "Standort erlauben" in the sheet: the system's question, asked once. */
export async function allowLocation(): Promise<boolean> {
  await setStored('sc.dexLocation', 'asked');
  try {
    return (await Location.requestForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** "Ohne Standort" in the sheet: the app does not ask again. */
export async function skipLocation(): Promise<void> {
  await setStored('sc.dexLocation', 'skipped');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export type ResolveDeps = { cities?: CityLoaderDeps; timeoutMs?: number };

/**
 * The city of where the device is now, as id and Bundesland, or null. Asks nothing: call `locationStep` first. The last known
 * fix first (instant), else one approximate fix (`Accuracy.Low`, about 1 km).
 */
export async function resolveSpotCity(deps: ResolveDeps = {}): Promise<SpotCity | null> {
  if (isWeb) return null;
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const cities = await loadCities(deps.cities);
    if (!cities || cities.length === 0) return null;
    const fix =
      (await withTimeout(Location.getLastKnownPositionAsync(LAST_KNOWN), deps.timeoutMs ?? FIX_TIMEOUT_MS)) ??
      (await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }), deps.timeoutMs ?? FIX_TIMEOUT_MS));
    if (!fix) return null;
    return nearestCity(cities, fix.coords.latitude, fix.coords.longitude);
  } catch {
    // Swallowed whole: an error message here could carry the position.
    return null;
  }
}
