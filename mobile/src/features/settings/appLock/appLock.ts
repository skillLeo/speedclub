/**
 * SET-20 App-Sperre (09 §7.9, §8.3), native only and device-local (no endpoint): when on, the app locks after it was in the
 * background for the chosen time, on a cold start and on a deep-link entry; AUTH-15 unlocks it with the device. The privacy cover
 * hides the content in the app switcher; it is on with the lock and optional without it.
 */
import { create } from 'zustand';

import { isWeb } from '@/lib/platform';
import { getStored, setStored } from '@/lib/storage';

/** "Sperren nach": Sofort · 1 Min. · 5 Min. · 15 Min., in seconds. */
export const LOCK_AFTER_OPTIONS = [0, 60, 300, 900] as const;
export type LockAfter = (typeof LOCK_AFTER_OPTIONS)[number];

export type AppLockSettings = { enabled: boolean; after: LockAfter; cover: boolean };

export const APP_LOCK_DEFAULTS: AppLockSettings = { enabled: false, after: 0, cover: false };

type State = {
  settings: AppLockSettings;
  hydrated: boolean;
  /** AUTH-15 is up. */
  locked: boolean;
  /** The app is in the switcher or behind another app: the cover is up. */
  covered: boolean;
};

export const useAppLockStore = create<State>(() => ({ settings: APP_LOCK_DEFAULTS, hydrated: false, locked: false, covered: false }));

/** A stored value as settings; anything unexpected falls back to the defaults (never a lock the member cannot see). */
export function parseAppLock(raw: string | null): AppLockSettings {
  if (!raw) return APP_LOCK_DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof AppLockSettings, unknown>>;
    const after = LOCK_AFTER_OPTIONS.find((option) => option === value.after) ?? APP_LOCK_DEFAULTS.after;
    const enabled = value.enabled === true;
    return { enabled, after, cover: enabled || value.cover === true };
  } catch {
    return APP_LOCK_DEFAULTS;
  }
}

/** Reads the device's choice once. A lock that is on locks the cold start at once (09 §8.3). */
export async function hydrateAppLock(signedIn: boolean): Promise<AppLockSettings> {
  if (isWeb) {
    useAppLockStore.setState({ hydrated: true });
    return APP_LOCK_DEFAULTS;
  }
  const settings = parseAppLock(await getStored('sc.appLock'));
  useAppLockStore.setState({ settings, hydrated: true, locked: settings.enabled && signedIn });
  return settings;
}

export function saveAppLock(next: AppLockSettings): void {
  // The cover always goes with the lock.
  const settings = { ...next, cover: next.enabled || next.cover };
  useAppLockStore.setState({ settings });
  void setStored('sc.appLock', JSON.stringify(settings));
}

/** Whether coming back after `awaySeconds` in the background locks the app. */
export function locksAfter(settings: AppLockSettings, awaySeconds: number): boolean {
  return settings.enabled && awaySeconds >= settings.after;
}

export function unlockApp(): void {
  useAppLockStore.setState({ locked: false });
}

/** Sign-out or a session that ended: nothing to protect, and a lock would stand in the way of signing in. */
export function releaseAppLock(): void {
  useAppLockStore.setState({ locked: false, covered: false });
}
