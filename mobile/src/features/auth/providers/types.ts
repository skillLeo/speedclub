/**
 * The provider adapters of 09 §8.1 (ADR-410): one file per provider, the SDK calls behind this interface, so a library swap
 * (Google free → Universal edition, or the native Apple module once installed) touches only the adapter.
 *
 * `signIn` resolves null when the member cancelled (AUTH-02: cancelled stays silent) and throws ProviderUnavailable when this
 * build or platform cannot run the provider; any other error is a real failure (toast with its cause).
 */
export type ProviderId = 'apple' | 'google';

export type AppleCredential = {
  identityToken: string;
  authorizationCode: string | null;
  /** Only on the first authorisation (09 §8.1). */
  fullName: string | null;
  email: string | null;
};

export type GoogleCredential = { idToken: string };

export type ProviderAdapter<Credential> = {
  id: ProviderId;
  /** Whether this build and platform can offer the provider at all (the flag is checked by the caller). */
  isAvailable: () => boolean;
  /**
   * `nonce`: what the provider SDK receives. Apple gets the SHA-256 hex of the server's raw nonce, Google the raw nonce itself;
   * the adapter for the provider does that, the caller always passes the raw value.
   */
  signIn: (rawNonce: string) => Promise<Credential | null>;
};

export class ProviderUnavailable extends Error {
  constructor(readonly provider: ProviderId) {
    super(`${provider}_unavailable`);
    this.name = 'ProviderUnavailable';
  }
}

/** Loads a provider's script once on the member web. Resolves when it ran; rejects when it could not load. */
const scripts = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  const known = scripts.get(src);
  if (known) return known;
  const loading = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('no_document'));
      return;
    }
    const element = document.createElement('script');
    element.src = src;
    element.async = true;
    element.onload = () => resolve();
    element.onerror = () => {
      scripts.delete(src);
      reject(new Error('script_failed'));
    };
    document.head.appendChild(element);
  });
  scripts.set(src, loading);
  return loading;
}
