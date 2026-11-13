/**
 * M4.6 Auth 2.0 (09 §8.1/§8.2, ADR-429): the passwordless sign-ins. E-mail code (AUTH-12/13 and the magic link), Apple and Google
 * ID tokens with their server nonce, the account link of AUTH-16, the passkey sign-in, and the AGB step of AUTH-09b.
 *
 * Every sign-in answer goes through `adoptSession` like the password sign-in, so SessionHost routes it the same way: the open
 * onboarding step (`next_step`), else where the guest wanted to go.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api, ApiError } from '@/api/client';
import type { components } from '@/api/schema';
import i18n from '@/i18n';
import { isWeb } from '@/lib/platform';
import { sessionSignal } from '@/state/session';


import { adoptSession, deviceFields, meKey, readSignIn, refreshMe, revokePendingLogoutBeforeSignIn, withFreshCsrf } from './auth';
import { apiDetailed } from './errorDetails';

type Schemas = components['schemas'];
export type PasswordlessSession = Schemas['PasswordlessSessionResource'];
export type SignInNext = Schemas['SignInNext'];
export type SocialProvider = Schemas['SocialProvider'];
export type LinkRequired = Schemas['LinkRequiredResource'];
export type PasskeyOptions = Schemas['PasskeyOptionsResource'];

/** WebAuthn L3 JSON of a credential (`PublicKeyCredential.toJSON()`), as the server deserialises it. */
export type PasskeyCredentialJSON = {
  id: string;
  rawId: string;
  type: 'public-key';
  response: Record<string, unknown>;
  clientExtensionResults?: Record<string, unknown>;
  authenticatorAttachment?: string | null;
};

/**
 * What a passwordless sign-in answers: the session (adopted), the AUTH-11 challenge, or for a provider whose address belongs to an
 * existing account the AUTH-16 link step.
 */
export type PasswordlessAnswer =
  | { kind: 'session'; isNew: boolean; next: SignInNext }
  | { kind: 'two_factor'; challenge: string; expiresIn: number }
  | { kind: 'link_required'; link: LinkRequired };

const locale = (): 'de' | 'en' => (i18n.language?.startsWith('en') ? 'en' : 'de');
const platform = (): Schemas['DevicePlatform'] | undefined => (isWeb ? 'web' : undefined);

type SessionOrChallenge = PasswordlessSession | Schemas['TwoFactorChallengeResource'] | Schemas['AuthSessionResource'];

async function answerOf(data: SessionOrChallenge | LinkRequired): Promise<PasswordlessAnswer> {
  if ('link_required' in data) return { kind: 'link_required', link: data };
  const read = readSignIn(data);
  if (read.kind === 'two_factor') return read;
  await adoptSession(read.session);
  const session = data as Partial<PasswordlessSession>;
  return { kind: 'session', isNew: session.is_new === true, next: session.next ?? 'done' };
}

// -- E-mail code (AUTH-12, AUTH-13)

export type EmailStartInput = { email: string; attemptId: string };

/** Always 202 `{attempt_id, resend_after}`, the same for every address. A resend is the same call with the same attempt. */
export function useStartEmailCode() {
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ email, attemptId }: EmailStartInput) => {
      const os = platform();
      const { data } = await apiDetailed(
        api.POST('/auth/email/start', {
          body: { email, attempt_id: attemptId, locale: locale(), ...(os ? { platform: os } : {}) },
        }),
      );
      return data;
    },
  });
}

export type EmailVerifyInput = { email: string; attemptId: string } & ({ code: string } | { magicToken: string });

/**
 * POST auth/email/verify with `attempt_id`, which selects the passwordless flow (ADR-429 a). Wrong code: 422 `invalid_code` with
 * `attempts_left`; expired: 422 `code_expired`; locked: 429 `email_code_locked` with `retry_after` (read with errorDetails).
 */
export function useVerifyEmailCode() {
  return useMutation({
    networkMode: 'always',
    gcTime: 0,
    mutationFn: async (input: EmailVerifyInput) => {
      const device = await deviceFields();
      await revokePendingLogoutBeforeSignIn();
      const proof = 'code' in input ? { code: input.code } : { magic_token: input.magicToken };
      // The generated request type predates the passwordless fields (attempt_id, magic_token); the server documents them.
      const body = { email: input.email, attempt_id: input.attemptId, locale: locale(), ...proof, ...device };
      const { data } = await withFreshCsrf(() =>
        apiDetailed(api.POST('/auth/email/verify', { body: body as unknown as Schemas['VerifyEmailRequest'] })),
      );
      return answerOf(data);
    },
  });
}

// -- Apple and Google (behind auth.apple / auth.google)

/** SEC-M46-05: a single-use nonce per provider sign-in. Apple gets its SHA-256 hex, the server always the raw value. */
export async function fetchProviderNonce(provider: SocialProvider): Promise<string> {
  const { data } = await withFreshCsrf(() => apiDetailed(api.POST('/auth/nonce', { body: { provider } })));
  return data.nonce;
}

export type AppleSignInInput = {
  identityToken: string;
  authorizationCode?: string | null;
  rawNonce: string;
  fullName?: string | null;
  email?: string | null;
};

export function useAppleSignIn() {
  return useMutation({
    networkMode: 'always',
    gcTime: 0,
    mutationFn: async (input: AppleSignInInput) => {
      const device = await deviceFields();
      await revokePendingLogoutBeforeSignIn();
      const os = platform();
      const body: Schemas['AppleSignInRequest'] = {
        identity_token: input.identityToken,
        authorization_code: input.authorizationCode ?? null,
        raw_nonce: input.rawNonce,
        full_name: input.fullName ?? null,
        email: input.email ?? null,
        locale: locale(),
        ...(os ? { platform: os } : {}),
        ...device,
      };
      const { data } = await withFreshCsrf(() => apiDetailed(api.POST('/auth/apple', { body })));
      return answerOf(data);
    },
  });
}

export type GoogleSignInInput = { idToken: string; nonce: string };

export function useGoogleSignIn() {
  return useMutation({
    networkMode: 'always',
    gcTime: 0,
    mutationFn: async ({ idToken, nonce }: GoogleSignInInput) => {
      const device = await deviceFields();
      await revokePendingLogoutBeforeSignIn();
      const os = platform();
      const body: Schemas['GoogleSignInRequest'] = { id_token: idToken, nonce, locale: locale(), ...(os ? { platform: os } : {}), ...device };
      const { data } = await withFreshCsrf(() => apiDetailed(api.POST('/auth/google', { body })));
      return answerOf(data);
    },
  });
}

/** AUTH-16: the code mailed to the existing account links the provider and signs in (with two-factor on: the challenge). */
export function useConfirmLink() {
  return useMutation({
    networkMode: 'always',
    gcTime: 0,
    mutationFn: async ({ attemptId, code }: { attemptId: string; code: string }) => {
      const device = await deviceFields();
      await revokePendingLogoutBeforeSignIn();
      const { data } = await withFreshCsrf(() =>
        apiDetailed(api.POST('/auth/link/confirm', { body: { attempt_id: attemptId, code, ...device } })),
      );
      return answerOf(data);
    },
  });
}

// -- Passkey sign-in (behind auth.passkeys)

/** Usernameless options: no allowCredentials, user verification required. */
export async function fetchPasskeySignInOptions(signal?: AbortSignal): Promise<PasskeyOptions> {
  const { data } = await withFreshCsrf(() => apiDetailed(api.POST('/auth/passkeys/options', { signal })));
  return data;
}

export function usePasskeySignIn() {
  return useMutation({
    networkMode: 'always',
    gcTime: 0,
    mutationFn: async ({ ceremonyId, credential }: { ceremonyId: string; credential: PasskeyCredentialJSON }) => {
      const device = await deviceFields();
      await revokePendingLogoutBeforeSignIn();
      const os = platform();
      // The generated type flattens `response` to a list; the server takes the WebAuthn object.
      const body = { ceremony_id: ceremonyId, credential, ...(os ? { platform: os } : {}), ...device };
      const { data } = await withFreshCsrf(() =>
        apiDetailed(api.POST('/auth/passkeys/verify', { body: body as unknown as Schemas['PasskeySignInRequest'] })),
      );
      return answerOf(data);
    },
  });
}

// -- AUTH-09b

export type AcceptTermsInput = { termsVersion: string; privacyVersion: string };

/** Accepts the AGB and Datenschutz versions published now, with the age line. 409 means it was accepted already. */
export function useAcceptOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ termsVersion, privacyVersion }: AcceptTermsInput) => {
      try {
        const { data } = await apiDetailed(
          api.POST('/me/onboarding/accept', {
            body: { terms_version: termsVersion, privacy_version: privacyVersion, age_confirmed: true },
            signal: sessionSignal(),
          }),
        );
        return data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) return null;
        throw error;
      }
    },
    onSuccess: (me) => {
      if (me) refreshMe(me);
      // Accepted before, on another device: auth/me says what comes next.
      else void queryClient.invalidateQueries({ queryKey: meKey });
    },
  });
}
