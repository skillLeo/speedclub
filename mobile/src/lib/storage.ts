/**
 * Typed AsyncStorage. On web AsyncStorage writes the plain key and value to localStorage, which is
 * what the inline head script in public/index.html reads for `sc.theme`: keep that value a bare string.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ThemePreference } from '@/theme/tokens.generated';

import type { PowerDisplay } from './units';

export type StorageSchema = {
  'sc.theme': ThemePreference;
  'sc.locale': 'de' | 'en';
  'sc.powerDisplay': PowerDisplay;
  /** Who was signed in: what an offline start shows. Holds no address and no token (src/api/queries/auth.ts). */
  'sc.sessionMember': string;
  /** The theme and locale last agreed with the account, as JSON. Survives sign-out. */
  'sc.settingsSynced': string;
  /**
   * The member and re-consent version pair the server last cleared (`me/consents` answering `required: []`), as JSON: an offline
   * start does not block a member who already accepted (state/consent.ts). Ids and version numbers only.
   */
  'sc.consentCleared': string;
  /** Native: the first launch has shown Welcome. */
  'sc.welcomeSeen': '1';
  /** ONB-01…03 (09 §7.1) were shown on this device (native: first launch; web: first visit of /app). */
  'sc.onboardingSeen': '1';
  /** Native: the SET-10 "Haptisches Feedback" toggle (src/lib/haptics.ts). '1' on, '0' off; missing means on. */
  'sc.haptics': '0' | '1';
  /** SET-10 "Bewegung reduzieren" (M4.10): 'always' reduces motion whatever the system says; missing means "System". */
  'sc.reduceMotion': 'always';
  /** SET-11 display units (M4.10) as JSON: `distance`, `torque`, `weight` (lib/displayUnits.ts). */
  'sc.units': string;
  /**
   * Web: the e-mail code attempt of AUTH-12/13 as JSON (attempt id, address, times; no code, no token), for the magic link in another
   * tab (features/auth/emailAttempt.ts). Native keeps it in the keychain instead.
   */
  'sc.emailAttempt': string;
  /** AUTH-14 was answered on this device: never offered again (features/auth/passkeyOffer.ts). */
  'sc.passkeyOffered': '1';
  /**
   * Native: SET-20 App-Sperre on this device as JSON (`enabled`, `after` in seconds, `cover`); device-local, no endpoint (09 §8.3,
   * features/settings/appLock.ts).
   */
  'sc.appLock': string;
};

export type StorageKey = keyof StorageSchema;

export const THEME_STORAGE_KEY = 'sc.theme' satisfies StorageKey;
export const QUERY_CACHE_STORAGE_KEY = 'sc.queryCache';

/** Returns null when the key is missing or storage is unavailable (private window, blocked data). */
export async function getStored<K extends StorageKey>(key: K): Promise<StorageSchema[K] | null> {
  try {
    return (await AsyncStorage.getItem(key)) as StorageSchema[K] | null;
  } catch {
    return null;
  }
}

export async function setStored<K extends StorageKey>(key: K, value: StorageSchema[K]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Could not store ${key}`, error);
  }
}

export async function removeStored(key: StorageKey): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn(`Could not remove ${key}`, error);
  }
}
