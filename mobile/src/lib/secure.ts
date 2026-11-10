/**
 * Device keychain for native auth tokens. The web keeps no token at all (httpOnly session cookies),
 * so every call is a no-op there and nothing sensitive can reach localStorage by accident.
 */
import * as SecureStore from 'expo-secure-store';

import { isWeb } from './platform';

export type SecureKey = 'sc.authToken' | 'sc.authTokenExpiresAt';

export async function getSecure(key: SecureKey): Promise<string | null> {
  if (isWeb) return null;
  return SecureStore.getItemAsync(key);
}

export async function setSecure(key: SecureKey, value: string): Promise<void> {
  if (isWeb) return;
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecure(key: SecureKey): Promise<void> {
  if (isWeb) return;
  await SecureStore.deleteItemAsync(key);
}
