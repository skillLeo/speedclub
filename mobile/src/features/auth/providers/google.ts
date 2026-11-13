/**
 * Google sign-in (09 §8.1, ADR-410, behind `auth.google`).
 *
 * - Member web: Google Identity Services (FedCM prompt) → ID token with the server's nonce. Needs the web client ID
 *   (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, OA-26); without it the provider is unavailable.
 * - Native: `@react-native-google-signin/google-signin` (free edition now, Universal edition once licensed — ADR-410) is not
 *   installed in this build; the lead installs it with `npx expo install @react-native-google-signin/google-signin` and adds its
 *   config plugin. Until then the native adapter reports unavailable and the button stays hidden.
 *
 * Google receives the raw nonce; the server compares the token's `nonce` claim with it (SEC-M46-05).
 */
import { isWeb } from '@/lib/platform';

import { loadScript, ProviderUnavailable, type GoogleCredential, type ProviderAdapter } from './types';

const GIS = 'https://accounts.google.com/gsi/client';

type PromptMoment = {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  getDismissedReason?: () => string;
};

type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        nonce: string;
        callback: (response: { credential?: string }) => void;
        use_fedcm_for_prompt: boolean;
        cancel_on_tap_outside: boolean;
        auto_select: boolean;
        context: 'signin';
      }) => void;
      prompt: (listener?: (moment: PromptMoment) => void) => void;
      cancel: () => void;
    };
  };
};

function webClientId(): string | null {
  return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || null;
}

async function signInOnWeb(rawNonce: string): Promise<GoogleCredential | null> {
  const clientId = webClientId();
  if (!clientId) throw new ProviderUnavailable('google');
  await loadScript(GIS);
  const google = (globalThis as { google?: GoogleIdentity }).google;
  if (!google?.accounts?.id) throw new ProviderUnavailable('google');
  return new Promise<GoogleCredential | null>((resolve) => {
    let settled = false;
    const settle = (value: GoogleCredential | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    google.accounts.id.initialize({
      client_id: clientId,
      nonce: rawNonce,
      callback: (response) => settle(response.credential ? { idToken: response.credential } : null),
      use_fedcm_for_prompt: true,
      cancel_on_tap_outside: true,
      auto_select: false,
      context: 'signin',
    });
    google.accounts.id.prompt((moment) => {
      // Not shown (no Google session, blocked third-party sign-in) or closed: the member stays on the screen, silently.
      if (moment.isNotDisplayed?.() || moment.isSkippedMoment?.()) settle(null);
      if (moment.isDismissedMoment?.() && moment.getDismissedReason?.() !== 'credential_returned') settle(null);
    });
  });
}

export const googleProvider: ProviderAdapter<GoogleCredential> = {
  id: 'google',
  isAvailable: () => isWeb && webClientId() !== null,
  signIn: (rawNonce) => (isWeb ? signInOnWeb(rawNonce) : Promise.reject(new ProviderUnavailable('google'))),
};
