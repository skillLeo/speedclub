/**
 * The theme preference, usable outside React so SET-10 and the account sync share one setter.
 * Web reads it synchronously, because the head script has already painted from the same value.
 */
import { useSyncExternalStore } from 'react';

import { previewTheme, previewToken } from '@/api/preview';
import { isWeb } from '@/lib/platform';
import { qa } from '@/lib/qa';
import { getStored, setStored, THEME_STORAGE_KEY } from '@/lib/storage';

import { DEFAULT_PREFERENCE, isThemePreference } from './theme';
import type { ThemePreference } from './tokens.generated';

function readWebPreference(): ThemePreference | null {
  try {
    const stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * A theme fixed for this tab, over anything stored, synced or published: the QA override, or the theme an ADM-34 preview frame asked
 * for (DQ-613, only with a preview token). Neither is ever stored or sent to the account.
 */
export function fixedThemePreference(): ThemePreference | undefined {
  return qa.theme ?? previewTheme() ?? undefined;
}

let preference: ThemePreference = fixedThemePreference() ?? (isWeb ? readWebPreference() : null) ?? DEFAULT_PREFERENCE;
let hydrated = isWeb;
/** True once setThemePreference ran. That value is newer than anything still in storage. */
let explicit = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getThemePreference = (): ThemePreference => preference;
const isHydrated = (): boolean => hydrated;

/**
 * How long hydration waits for storage. ThemeProvider renders nothing until hydration ends and opening the
 * ready gate would not change that, so the wait needs its own bound. Keep this below READY_GATE_TIMEOUT_MS.
 */
export const THEME_HYDRATION_TIMEOUT_MS = 3_000;

function readStoredPreference(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`Theme preference not read within ${THEME_HYDRATION_TIMEOUT_MS} ms. Using the default.`);
      resolve(null);
    }, THEME_HYDRATION_TIMEOUT_MS);
  });
  return Promise.race([getStored(THEME_STORAGE_KEY), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Loads the stored preference once on native. Never rejects and always ends in time, so the splash can always
 * hide. A read that comes back too late is dropped, and a preference set in the meantime wins over the read.
 */
export async function hydrateThemePreference(): Promise<void> {
  if (hydrated) return;
  const stored = fixedThemePreference() || explicit ? null : await readStoredPreference();
  if (!explicit && isThemePreference(stored)) preference = stored;
  if (isThemePreference(stored)) storedPreference = true;
  hydrated = true;
  emit();
}

/** True once a stored preference was read or the member chose one: a brand default then no longer applies. */
let storedPreference = isWeb && readWebPreference() !== null;

/**
 * M3.5 ADM-28: the brand's default theme from app-config, for an install that has never chosen or stored one. Not stored, so a later
 * change of the default still reaches such installs, and never over a QA theme.
 */
export function setDefaultThemePreference(next: unknown): void {
  if (explicit || storedPreference || fixedThemePreference() || !isThemePreference(next) || next === preference) return;
  preference = next;
  emit();
}

/**
 * Applies a preference immediately and stores it. A QA session and a draft preview tab (ADM-34, its own browser storage is the staff
 * member's) never overwrite the stored value.
 */
export function setThemePreference(next: ThemePreference): void {
  explicit = true;
  preference = next;
  emit();
  if (!fixedThemePreference() && previewToken() === null) void setStored(THEME_STORAGE_KEY, next);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, getThemePreference);
}

export function useThemeHydrated(): boolean {
  return useSyncExternalStore(subscribe, isHydrated, isHydrated);
}
