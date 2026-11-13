/**
 * The sign-ins behind ProviderButtons (AUTH-02, AUTH-12): Apple, Google and passkey. Each one fetches what the server needs first
 * (the provider nonce, or the passkey ceremony), runs the platform prompt, and hands the answer on:
 * - a session: adopted; SessionHost routes it (the open step, AUTH-14, or where the guest wanted to go);
 * - a two-factor challenge (password and e-mail accounts with TOTP; providers skip it unless linking, ADR-429 g): AUTH-11;
 * - `link_required`: AUTH-16 with the code that went to the existing account.
 * Cancelled stays silent; anything else is a toast with the cause (AUTH-02 states).
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import {
  fetchPasskeySignInOptions,
  fetchProviderNonce,
  useAppleSignIn,
  useGoogleSignIn,
  usePasskeySignIn,
  type PasswordlessAnswer,
} from '@/api/queries/passwordless';
import { haptics } from '@/lib/haptics';
import { toast } from '@/ui/toast';

import { holdLinkStep } from '../linkStep';
import { armPasskeyOffer, disarmPasskeyOffer } from '../passkeyOffer';
import { holdTwoFactorChallenge } from '../twoFactorChallenge';
import { appleProvider } from './apple';
import { googleProvider } from './google';
import { getPasskey, isPasskeyCancelled, passkeysAvailable } from './passkeys';
import { ProviderUnavailable, type ProviderId } from './types';

export type SignInProvider = ProviderId | 'passkey';

/** Which of the three this build, platform and app-config offer now. E-mail is always there. */
export function useProviderAvailability(): { apple: boolean; google: boolean; passkey: boolean } {
  const apple = useFlag('auth.apple');
  const google = useFlag('auth.google');
  const passkeys = useFlag('auth.passkeys');
  return {
    apple: apple && appleProvider.isAvailable(),
    google: google && googleProvider.isAvailable(),
    passkey: passkeys && passkeysAvailable(),
  };
}

/** Where an answer goes next. Exported for the code and link screens, which share it. */
export function useAnswerRouting(): (answer: PasswordlessAnswer) => void {
  const router = useRouter();
  return (answer) => {
    if (answer.kind === 'two_factor') {
      holdTwoFactorChallenge(answer.challenge, answer.expiresIn);
      router.push('/two-factor');
    } else if (answer.kind === 'link_required') {
      holdLinkStep(answer.link);
      router.push('/auth/link');
    }
    // A session: SessionHost takes it from here.
  };
}

export function useProviderSignIn(routeId: string) {
  const { t } = useTranslation('auth');
  const passkeysOn = useFlag('auth.passkeys');
  const apple = useAppleSignIn();
  const google = useGoogleSignIn();
  const passkey = usePasskeySignIn();
  const route = useAnswerRouting();
  const [busy, setBusy] = useState<SignInProvider | null>(null);

  const failed = (provider: SignInProvider, error: unknown) => {
    disarmPasskeyOffer();
    if (isPasskeyCancelled(error)) return;
    haptics.error();
    const name = t(`providers.name.${provider}`);
    if (error instanceof ProviderUnavailable || (error instanceof ApiError && error.code === 'feature_disabled')) {
      toast(t('providers.unavailable', { provider: name }), { testID: `${routeId}.toast` });
    } else if (error instanceof ApiError && error.code === 'passkey_invalid') {
      toast(t('providers.passkeyInvalid'), { testID: `${routeId}.toast` });
    } else if (error instanceof ApiError && error.kind !== 'network') {
      toast(t('providers.failedBecause', { provider: name, reason: error.message }), { testID: `${routeId}.toast` });
    } else {
      toast(t('providers.failed', { provider: name }), { testID: `${routeId}.toast` });
    }
  };

  const run = async (provider: SignInProvider): Promise<void> => {
    if (busy) return;
    setBusy(provider);
    try {
      let answer: PasswordlessAnswer | null = null;
      if (provider === 'passkey') {
        const options = await fetchPasskeySignInOptions();
        const credential = await getPasskey(options.options);
        answer = await passkey.mutateAsync({ ceremonyId: options.ceremony_id, credential });
      } else {
        await armPasskeyOffer(passkeysOn);
        const nonce = await fetchProviderNonce(provider);
        if (provider === 'apple') {
          const credential = await appleProvider.signIn(nonce);
          if (credential) answer = await apple.mutateAsync({ ...credential, rawNonce: nonce });
        } else {
          const credential = await googleProvider.signIn(nonce);
          if (credential) answer = await google.mutateAsync({ idToken: credential.idToken, nonce });
        }
        // Cancelled in the provider's sheet: silent (AUTH-02).
        if (!answer) disarmPasskeyOffer();
      }
      if (answer) route(answer);
    } catch (error) {
      failed(provider, error);
    } finally {
      setBusy(null);
    }
  };

  return { busy, run };
}
