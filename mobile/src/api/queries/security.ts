/**
 * SET-19 Anmeldung & Passkeys and the reauth sheet (09 §8.1, §8.2, §7.2): the member's passkeys and linked providers, and POST
 * me/reauth with its three methods. Every change here needs recent authentication, so it runs through `withRecentAuth`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import type { components } from '@/api/schema';
import { sessionSignal, useSessionStore } from '@/state/session';

import { withFreshCsrf } from './auth';
import { apiDetailed } from './errorDetails';
import type { PasskeyCredentialJSON, PasskeyOptions, SocialProvider } from './passwordless';
import { withRecentAuth } from './recentAuth';

type Schemas = components['schemas'];
export type Passkey = Schemas['PasskeyResource'];
export type LinkedProvider = Schemas['SocialAccountResource'];

export const passkeysKey = ['security', 'passkeys'] as const;
export const providersKey = ['security', 'providers'] as const;

function useSignedIn(): boolean {
  return useSessionStore((state) => state.status === 'member');
}

export function usePasskeys(enabled = true) {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: passkeysKey,
    queryFn: async ({ signal }) => (await apiDetailed(api.GET('/me/passkeys', { signal }))).data,
    enabled: signedIn && enabled,
  });
}

export function useLinkedProviders(enabled = true) {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: providersKey,
    queryFn: async ({ signal }) => (await apiDetailed(api.GET('/me/providers', { signal }))).data,
    enabled: signedIn && enabled,
  });
}

/** POST me/passkeys/options (recent auth): the creation options for the platform prompt. */
export function fetchPasskeyCreationOptions(): Promise<PasskeyOptions> {
  return withRecentAuth(async () => (await apiDetailed(api.POST('/me/passkeys/options', { signal: sessionSignal() }))).data);
}

export type AddPasskeyInput = {
  /** Asks the platform for a new credential with the server's options; throws when the member cancels. */
  create: (options: PasskeyOptions) => Promise<PasskeyCredentialJSON>;
  name?: string | null;
};

/** Options (recent auth), the platform prompt, then POST me/passkeys. 422 `passkey_invalid` when the response fails. */
export function useAddPasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ create, name }: AddPasskeyInput) => {
      const options = await fetchPasskeyCreationOptions();
      const credential = await create(options);
      const body = { ceremony_id: options.ceremony_id, credential, ...(name ? { name } : {}) };
      return withRecentAuth(
        async () =>
          (
            await apiDetailed(
              // The generated type flattens `response` to a list; the server takes the WebAuthn object.
              api.POST('/me/passkeys', { body: body as unknown as Schemas['StorePasskeyRequest'], signal: sessionSignal() }),
            )
          ).data,
      );
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: passkeysKey }),
  });
}

export function useRenamePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      withRecentAuth(
        async () =>
          (
            await apiDetailed(
              api.PATCH('/me/passkeys/{memberPasskey}', { params: { path: { memberPasskey: id } }, body: { name }, signal: sessionSignal() }),
            )
          ).data,
      ),
    onSuccess: (passkey) => {
      queryClient.setQueryData<Passkey[]>(passkeysKey, (rows) => rows?.map((row) => (row.id === passkey.id ? passkey : row)));
    },
  });
}

/** 409 `last_sign_in_method` when it is the last way in. */
export function useDeletePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      withRecentAuth(async () => {
        await apiDetailed(api.DELETE('/me/passkeys/{memberPasskey}', { params: { path: { memberPasskey: id } }, signal: sessionSignal() }));
        return id;
      }),
    onSuccess: (id) => {
      queryClient.setQueryData<Passkey[]>(passkeysKey, (rows) => rows?.filter((row) => row.id !== id));
    },
  });
}

export type LinkProviderInput = { provider: SocialProvider; idToken: string; rawNonce: string; authorizationCode?: string | null };

export function useLinkProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, idToken, rawNonce, authorizationCode }: LinkProviderInput) =>
      withRecentAuth(
        async () =>
          (
            await apiDetailed(
              api.POST('/me/providers', {
                body: { provider, id_token: idToken, raw_nonce: rawNonce, authorization_code: authorizationCode ?? null },
                signal: sessionSignal(),
              }),
            )
          ).data,
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: providersKey }),
  });
}

/** 409 `last_sign_in_method` when nothing else remains. */
export function useUnlinkProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: SocialProvider) =>
      withRecentAuth(async () => {
        await apiDetailed(api.DELETE('/me/providers/{provider}', { params: { path: { provider } }, signal: sessionSignal() }));
        return provider;
      }),
    onSuccess: (provider) => {
      queryClient.setQueryData<LinkedProvider[]>(providersKey, (rows) => rows?.filter((row) => row.provider !== provider));
    },
  });
}

// -- POST me/reauth

/** A code to the account's address for the email_code method. `attempt_id` is made by the app. */
export async function startReauthCode(attemptId: string) {
  const { data } = await withFreshCsrf(() =>
    apiDetailed(api.POST('/me/reauth/email', { body: { attempt_id: attemptId }, signal: sessionSignal() })),
  );
  return data;
}

/** The member's own passkeys as allowCredentials. */
export async function fetchReauthPasskeyOptions(): Promise<PasskeyOptions> {
  const { data } = await withFreshCsrf(() => apiDetailed(api.POST('/me/reauth/passkey-options', { signal: sessionSignal() })));
  return data;
}

export type ReauthProof =
  | { method: 'password'; password: string; twoFactorCode?: string }
  | { method: 'email_code'; attemptId: string; code: string; twoFactorCode?: string }
  | { method: 'passkey'; ceremonyId: string; credential: PasskeyCredentialJSON };

function reauthBody(proof: ReauthProof): Schemas['ReauthRequest'] {
  switch (proof.method) {
    case 'password':
      return { method: 'password', password: proof.password, ...(proof.twoFactorCode ? { two_factor_code: proof.twoFactorCode } : {}) };
    case 'email_code':
      return {
        method: 'email_code',
        attempt_id: proof.attemptId,
        code: proof.code,
        ...(proof.twoFactorCode ? { two_factor_code: proof.twoFactorCode } : {}),
      };
    case 'passkey':
      // The generated type flattens the credential to a list; the server takes the WebAuthn object.
      return { method: 'passkey', ceremony_id: proof.ceremonyId, credential: proof.credential as unknown as string[] };
  }
}

/** Marks this token or session as recently authenticated for 10 minutes. 422 on the field when wrong. */
export function useReauthenticate() {
  return useMutation({
    networkMode: 'always',
    gcTime: 0,
    mutationFn: async (proof: ReauthProof) => {
      const { data } = await withFreshCsrf(() => apiDetailed(api.POST('/me/reauth', { body: reauthBody(proof), signal: sessionSignal() })));
      return data;
    },
  });
}
