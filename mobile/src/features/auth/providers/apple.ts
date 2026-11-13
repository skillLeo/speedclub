/**
 * Sign in with Apple (09 §8.1, behind `auth.apple`).
 *
 * - Member web: Sign in with Apple JS in a popup. Needs the Services ID (`EXPO_PUBLIC_APPLE_SERVICES_ID`) and its return URL
 *   (`EXPO_PUBLIC_APPLE_REDIRECT_URI`, registered with Apple) — owner action OA-38. Without them the provider is unavailable.
 * - iOS: `expo-apple-authentication` (not installed in this build; the lead installs it with
 *   `npx expo install expo-apple-authentication`). Until then the native adapter reports unavailable and the button stays hidden.
 * - Android: only Apple's web flow, which needs a Services ID and a server return endpoint; hidden (09 §8.1).
 *
 * Nonce binding: Apple receives the SHA-256 hex of the server's raw nonce; the server checks the token's nonce against it.
 */
import * as Crypto from 'expo-crypto';

import { isWeb } from '@/lib/platform';

import { loadScript, ProviderUnavailable, type AppleCredential, type ProviderAdapter } from './types';

const APPLE_JS = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/de_DE/appleid.auth.js';

type AppleSignInResponse = {
  authorization?: { id_token?: string; code?: string };
  user?: { email?: string; name?: { firstName?: string; lastName?: string } };
};

type AppleIdGlobal = {
  auth: {
    init: (config: { clientId: string; scope: string; redirectURI: string; nonce: string; usePopup: boolean; state?: string }) => void;
    signIn: () => Promise<AppleSignInResponse>;
  };
};

/** What Apple JS rejects with when the member closed the popup or said no. */
const CANCELLED = new Set(['popup_closed_by_user', 'user_cancelled_authorize', 'user_trigger_new_signin_flow']);

function webConfig(): { clientId: string; redirectURI: string } | null {
  const clientId = process.env.EXPO_PUBLIC_APPLE_SERVICES_ID ?? '';
  const redirectURI = process.env.EXPO_PUBLIC_APPLE_REDIRECT_URI ?? '';
  return clientId && redirectURI ? { clientId, redirectURI } : null;
}

/** SHA-256 of the raw nonce, lowercase hex, as Apple expects it. */
export function hashNonce(rawNonce: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce, { encoding: Crypto.CryptoEncoding.HEX });
}

export function joinName(name: { firstName?: string; lastName?: string } | undefined): string | null {
  const joined = [name?.firstName, name?.lastName].filter((part) => part && part.trim()).join(' ').trim();
  return joined || null;
}

async function signInOnWeb(rawNonce: string): Promise<AppleCredential | null> {
  const config = webConfig();
  if (!config) throw new ProviderUnavailable('apple');
  await loadScript(APPLE_JS);
  const appleId = (globalThis as { AppleID?: AppleIdGlobal }).AppleID;
  if (!appleId) throw new ProviderUnavailable('apple');
  appleId.auth.init({ ...config, scope: 'name email', nonce: await hashNonce(rawNonce), usePopup: true });
  let response: AppleSignInResponse;
  try {
    response = await appleId.auth.signIn();
  } catch (error) {
    const code = (error as { error?: unknown } | null)?.error;
    if (typeof code === 'string' && CANCELLED.has(code)) return null;
    throw error;
  }
  const identityToken = response.authorization?.id_token;
  if (!identityToken) throw new Error('apple_no_token');
  return {
    identityToken,
    authorizationCode: response.authorization?.code ?? null,
    fullName: joinName(response.user?.name),
    email: response.user?.email ?? null,
  };
}

export const appleProvider: ProviderAdapter<AppleCredential> = {
  id: 'apple',
  isAvailable: () => isWeb && webConfig() !== null,
  signIn: (rawNonce) => (isWeb ? signInOnWeb(rawNonce) : Promise.reject(new ProviderUnavailable('apple'))),
};
