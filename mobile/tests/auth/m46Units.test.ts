// M4.6 Auth 2.0: the pure parts — routing, error details, recent auth, the passkey JSON, copy and the HOME-02 rows.
import { ApiError } from '@/api/client';
import { apiDetailed, errorNumber, reauthMethodsOf, withErrorBody } from '@/api/queries/errorDetails';
import { isReauthCancelled, settleRecentAuth, useRecentAuthStore, withRecentAuth } from '@/api/queries/recentAuth';
import { reauthMethods } from '@/features/auth/RecentAuthHost';
import { plainSentence, sentenceParts } from '@/features/auth/components/ConsentCheck';
import { attemptFrom, maskEmail, resentAttempt, secondsUntilResend } from '@/features/auth/emailAttempt';
import { hashNonce, joinName } from '@/features/auth/providers/apple';
import { base64urlToBuffer, bufferToBase64url, creationOptionsFromJSON, credentialToJSON, requestOptionsFromJSON } from '@/features/auth/providers/passkeys';
import { PASSKEY_OFFER_PATH, routeForSession, STEP_ROUTE } from '@/features/auth/routing';
import { codeFailureOf } from '@/features/auth/screens/CodeEntryScreen';
import { magicTokenFromHash } from '@/features/auth/screens/MagicLinkScreen';
import { finishSchema, passkeyNameSchema } from '@/features/auth/schemas';
import { notificationTarget, notificationText } from '@/features/home/notifications';
import i18n from '@/i18n';
import { providerOrder } from '@/ui/ProviderButtons';
import { sanitizeOtp } from '@/ui/OTPInput';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => '0d4c6a0e-7a3b-4c1e-9d55-3f1a2b3c4d5e',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `sha256(${value})`),
}));

const apiError = (status: number, code: string, body: Record<string, unknown> = {}) =>
  withErrorBody(new ApiError({ kind: status === 429 ? 'rate_limited' : status === 422 ? 'validation' : 'forbidden', status, code, message: 'Vom Server.' }), body);

describe('session routing of Auth 2.0', () => {
  it('opens AUTH-09b at /auth/finish (09 §6) for accept_terms, from anywhere a step is forced', () => {
    expect(STEP_ROUTE.accept_terms).toBe('/auth/finish');
    expect(routeForSession({ status: 'member', nextStep: 'accept_terms', pathname: '/auth/code' })).toEqual({ type: 'go', path: '/auth/finish' });
    expect(routeForSession({ status: 'member', nextStep: 'accept_terms', pathname: '/auth/finish' })).toEqual({ type: 'stay' });
    expect(routeForSession({ status: 'member', nextStep: 'accept_terms', pathname: '/v/skyline' })).toEqual({ type: 'go', path: '/auth/finish', resume: '/v/skyline' });
  });

  it('keeps the AGB texts readable from AUTH-09b', () => {
    expect(routeForSession({ status: 'member', nextStep: 'accept_terms', pathname: '/settings/legal/terms' })).toEqual({ type: 'stay' });
  });

  it('finishes a passwordless sign-in like any other', () => {
    for (const pathname of ['/auth/email', '/auth/code', '/auth/magic', '/auth/link']) {
      expect(routeForSession({ status: 'member', pathname })).toEqual({ type: 'finish', fallback: '/' });
    }
  });

  it('puts AUTH-14 between a sign-in and the way on while the offer is due, and holds there until answered', () => {
    expect(routeForSession({ status: 'member', pathname: '/auth/code', passkeyOffer: 'due' })).toEqual({ type: 'go', path: PASSKEY_OFFER_PATH });
    expect(routeForSession({ status: 'member', pathname: '/sign-in', passkeyOffer: 'due' })).toEqual({ type: 'go', path: PASSKEY_OFFER_PATH });
    expect(routeForSession({ status: 'member', pathname: PASSKEY_OFFER_PATH, passkeyOffer: 'due' })).toEqual({ type: 'stay' });
    expect(routeForSession({ status: 'member', pathname: PASSKEY_OFFER_PATH, passkeyOffer: 'answered' })).toEqual({ type: 'finish', fallback: '/' });
  });

  it('never offers a passkey inside F1: the steps come first, and the profile step ends in the garage', () => {
    expect(routeForSession({ status: 'member', nextStep: 'choose_username', pathname: '/auth/code', passkeyOffer: 'due' })).toEqual({ type: 'go', path: '/username' });
    expect(routeForSession({ status: 'member', pathname: '/profile-setup', passkeyOffer: 'due' })).toEqual({ type: 'finish', fallback: '/garage' });
  });

  it('sends a guest away from the member steps', () => {
    expect(routeForSession({ status: 'guest', pathname: '/auth/finish' })).toEqual({ type: 'go', path: '/sign-in' });
    expect(routeForSession({ status: 'guest', pathname: PASSKEY_OFFER_PATH })).toEqual({ type: 'go', path: '/sign-in' });
    expect(routeForSession({ status: 'guest', pathname: '/auth/code' })).toEqual({ type: 'stay' });
  });
});

describe('error details (attempts_left, retry_after, methods)', () => {
  const answer = (status: number, body: unknown): Promise<{ data?: unknown; error?: unknown; response: Response }> =>
    Promise.resolve({ error: body, response: new Response(JSON.stringify(body), { status }) });

  it('keeps the body of an error it throws', async () => {
    const error = await apiDetailed(answer(422, { message: 'Falsch.', code: 'invalid_code', errors: {}, attempts_left: 3 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('invalid_code');
    expect(errorNumber(error, 'attempts_left')).toBe(3);
    expect(errorNumber(error, 'retry_after')).toBeNull();
  });

  it('reads the methods of reauthentication_required, dropping unknown ones', async () => {
    const error = await apiDetailed(
      answer(403, { message: 'Bestätige.', code: 'reauthentication_required', errors: {}, methods: ['passkey', 'email_code', 'sms'] }),
    ).catch((e: unknown) => e);
    expect(reauthMethodsOf(error)).toEqual(['passkey', 'email_code']);
    expect(reauthMethodsOf(new Error('x'))).toBeNull();
  });

  it('answers the data of a success', async () => {
    await expect(apiDetailed(Promise.resolve({ data: { data: 1 }, response: new Response('{}', { status: 200 }) }))).resolves.toEqual({ data: 1 });
  });

  it('turns a failed fetch into the network error', async () => {
    await expect(apiDetailed(Promise.reject(new TypeError('offline')))).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('withRecentAuth', () => {
  afterEach(() => useRecentAuthStore.setState({ pending: null }));

  it('asks once, then runs the call again', async () => {
    const call = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(apiError(403, 'reauthentication_required', { methods: ['email_code', 'password'] }))
      .mockResolvedValueOnce('done');
    const running = withRecentAuth(call);
    await Promise.resolve();
    await Promise.resolve();
    expect(useRecentAuthStore.getState().pending?.methods).toEqual(['email_code', 'password']);
    settleRecentAuth(true);
    await expect(running).resolves.toBe('done');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('cancelled: the call is not repeated and the error says so', async () => {
    const call = jest.fn<Promise<string>, []>().mockRejectedValue(apiError(403, 'reauthentication_required'));
    const running = withRecentAuth(call).catch((e: unknown) => e);
    await Promise.resolve();
    await Promise.resolve();
    settleRecentAuth(false);
    expect(isReauthCancelled(await running)).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('two calls share one sheet', async () => {
    const first = jest.fn<Promise<number>, []>().mockRejectedValueOnce(apiError(403, 'reauthentication_required')).mockResolvedValueOnce(1);
    const second = jest.fn<Promise<number>, []>().mockRejectedValueOnce(apiError(403, 'reauthentication_required')).mockResolvedValueOnce(2);
    const both = Promise.all([withRecentAuth(first), withRecentAuth(second)]);
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
    settleRecentAuth(true);
    await expect(both).resolves.toEqual([1, 2]);
  });

  it('passes every other error on untouched', async () => {
    const error = apiError(409, 'last_sign_in_method');
    await expect(withRecentAuth(() => Promise.reject(error))).rejects.toBe(error);
    expect(useRecentAuthStore.getState().pending).toBeNull();
  });
});

describe('reauth methods', () => {
  it("follows the server's list where this device can use it", () => {
    expect(reauthMethods({ server: ['passkey', 'email_code', 'password'], passwordSet: true, passkeysOn: true, passkeysHere: false })).toEqual(['email_code', 'password']);
    expect(reauthMethods({ server: ['passkey', 'email_code'], passwordSet: true, passkeysOn: true, passkeysHere: true })).toEqual(['passkey', 'email_code']);
  });

  it('without a list, offers what the member has', () => {
    expect(reauthMethods({ server: null, passwordSet: false, passkeysOn: false, passkeysHere: true })).toEqual(['email_code']);
    expect(reauthMethods({ server: null, passwordSet: true, passkeysOn: true, passkeysHere: true })).toEqual(['passkey', 'email_code', 'password']);
  });

  it('always keeps the e-mail code', () => {
    expect(reauthMethods({ server: [], passwordSet: false, passkeysOn: false, passkeysHere: false })).toEqual(['email_code']);
  });
});

describe('AUTH-13 refusals', () => {
  it('reads wrong, expired and locked', () => {
    expect(codeFailureOf(apiError(422, 'invalid_code', { attempts_left: 3 }), 'x')).toEqual({ kind: 'wrong', attemptsLeft: 3 });
    expect(codeFailureOf(apiError(422, 'code_expired'), 'x')).toEqual({ kind: 'expired' });
    expect(codeFailureOf(apiError(429, 'email_code_locked', { retry_after: 840 }), 'x')).toEqual({ kind: 'locked', seconds: 840 });
    expect(codeFailureOf(new Error('boom'), 'Fallback')).toEqual({ kind: 'other', message: 'Fallback' });
  });

  it('names the attempts left in both languages', () => {
    expect(i18n.getFixedT('de', 'auth')('code.wrongLeft', { count: 3 })).toBe('Der Code stimmt nicht. Noch 3\u00A0Versuche.');
    expect(i18n.getFixedT('de', 'auth')('code.wrongLeft', { count: 1 })).toBe('Der Code stimmt nicht. Noch 1\u00A0Versuch.');
    expect(i18n.getFixedT('en', 'auth')('code.wrongLeft', { count: 1 })).toBe("That code isn't right. 1\u00A0attempt left.");
  });
});

describe('small helpers', () => {
  it('masks the address as AUTH-13 shows it', () => {
    expect(maskEmail('sven@gmail.com')).toBe('s•••@gmail.com');
    expect(maskEmail('kein-at')).toBe('kein-at');
  });

  it('times the resend from the server', () => {
    const attempt = attemptFrom('a'.repeat(36), 'sven@gmail.com', 30, 1_000);
    expect(secondsUntilResend(attempt, 1_000)).toBe(30);
    expect(secondsUntilResend(attempt, 40_000)).toBe(0);
    expect(secondsUntilResend(resentAttempt(attempt, 60, 40_000), 40_000)).toBe(60);
    expect(secondsUntilResend(null)).toBe(0);
  });

  it('keeps only the digits of a pasted code', () => {
    expect(sanitizeOtp('123 456')).toBe('123456');
    expect(sanitizeOtp('12-34-56-78')).toBe('123456');
  });

  it('reads the magic token from the fragment only, in its shape', () => {
    expect(magicTokenFromHash('#t=AbcDefGhiJklMnoPqrStuVwxYz0123456789_-abcd')).toBe('AbcDefGhiJklMnoPqrStuVwxYz0123456789_-abcd');
    expect(magicTokenFromHash('#t=<script>')).toBeNull();
    expect(magicTokenFromHash('#t=a&t=b')).toBeNull();
    expect(magicTokenFromHash('')).toBeNull();
  });

  it('orders the providers per platform (AUTH-02)', () => {
    const all = { apple: true, google: true, passkey: true };
    expect(providerOrder(all, 'ios')).toEqual(['apple', 'google', 'email', 'passkey']);
    expect(providerOrder(all, 'android')).toEqual(['google', 'apple', 'email', 'passkey']);
    expect(providerOrder(all, 'web')).toEqual(['apple', 'google', 'email', 'passkey']);
    expect(providerOrder({ apple: false, google: false, passkey: false }, 'web')).toEqual(['email']);
  });

  it('splits a consent with two documents into two links', () => {
    expect(sentenceParts('Ich akzeptiere die <doc>AGB</doc> und habe die <doc>Datenschutzerklärung</doc> gelesen.')).toEqual([
      { kind: 'text', text: 'Ich akzeptiere die ' },
      { kind: 'link', text: 'AGB', closing: '', index: 0 },
      { kind: 'text', text: ' und habe die ' },
      { kind: 'link', text: 'Datenschutzerklärung', closing: '', index: 1 },
      { kind: 'text', text: ' gelesen.' },
    ]);
    expect(plainSentence('die <doc>AGB</doc>.')).toBe('die AGB.');
  });

  it('AUTH-09b needs both boxes; a passkey needs a name of at most 64', () => {
    expect(finishSchema.safeParse({ ageConfirmed: true, termsAccepted: false }).success).toBe(false);
    expect(finishSchema.safeParse({ ageConfirmed: true, termsAccepted: true }).success).toBe(true);
    expect(passkeyNameSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(passkeyNameSchema.safeParse({ name: 'x'.repeat(65) }).success).toBe(false);
    expect(passkeyNameSchema.safeParse({ name: 'MacBook' }).success).toBe(true);
  });

  it('hands Apple the SHA-256 of the raw nonce, and joins the name of the first authorisation', async () => {
    await expect(hashNonce('raw')).resolves.toBe('sha256(raw)');
    expect(joinName({ firstName: 'Lukas', lastName: 'Brandt' })).toBe('Lukas Brandt');
    expect(joinName({ firstName: ' ' })).toBeNull();
    expect(joinName(undefined)).toBeNull();
  });
});

describe('WebAuthn JSON', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = bufferToBase64url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(new Uint8Array(base64urlToBuffer(encoded))).toEqual(bytes);
  });

  it('turns the server options into buffers where the browser needs them', () => {
    const request = requestOptionsFromJSON({ challenge: 'AQID', rpId: 'speedclub.test', allowCredentials: [{ id: 'BAUG', type: 'public-key' }] });
    expect(new Uint8Array(request.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(request.allowCredentials?.[0]?.id as ArrayBuffer)).toEqual(new Uint8Array([4, 5, 6]));
    const creation = creationOptionsFromJSON({ challenge: 'AQID', user: { id: 'BAUG', name: 'lukas', displayName: 'Lukas' }, rp: { name: 'SPEED CLUB' }, pubKeyCredParams: [] });
    expect(new Uint8Array(creation.user.id as ArrayBuffer)).toEqual(new Uint8Array([4, 5, 6]));
  });

  it('writes an assertion as L3 JSON when the browser has no toJSON', () => {
    const buffer = (values: number[]) => new Uint8Array(values).buffer;
    const json = credentialToJSON({
      id: 'cred',
      rawId: buffer([9, 9]),
      type: 'public-key',
      response: { clientDataJSON: buffer([1]), authenticatorData: buffer([2]), signature: buffer([3]), userHandle: buffer([4]) },
      getClientExtensionResults: () => ({}),
      authenticatorAttachment: 'platform',
    } as unknown as PublicKeyCredential);
    expect(json).toEqual({
      id: 'cred',
      rawId: 'CQk',
      type: 'public-key',
      response: { clientDataJSON: 'AQ', authenticatorData: 'Ag', signature: 'Aw', userHandle: 'BA' },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    });
  });
});

describe('HOME-02 security rows of M4.6', () => {
  const row = (event: string, name: string | null) =>
    ({
      id: event,
      type: 'security',
      group_key: event,
      actors: [],
      actor_count: 0,
      vehicle: null,
      details: { event, device_name: name },
      read_at: null,
      created_at: '2026-11-12T10:00:00Z',
    }) as unknown as Parameters<typeof notificationText>[0];

  it.each(['de', 'en'])('names every new event in %s, with the passkey or provider where it is known', (language) => {
    const t = i18n.getFixedT(language, 'home');
    const other = t('notifications.text.security.other');
    for (const event of ['email_code_locked', 'provider_linked', 'provider_unlinked', 'passkey_added', 'passkey_removed', 'passkey_rejected']) {
      const plain = notificationText(row(event, null), t);
      expect(plain).not.toBe(other);
      expect(plain).not.toContain('notifications.');
    }
    expect(notificationText(row('passkey_added', 'MacBook Pro'), t)).toContain('MacBook');
    expect(notificationText(row('provider_linked', 'Google'), t)).toContain('Google');
  });

  it('opens SET-19 for them, and the settings for the older ones', () => {
    expect(notificationTarget(row('passkey_removed', 'MacBook'), 'lukas.sc')).toBe('/settings/security/sign-in');
    expect(notificationTarget(row('email_code_locked', null), 'lukas.sc')).toBe('/settings/security/sign-in');
    expect(notificationTarget(row('password_changed', null), 'lukas.sc')).toBe('/settings');
  });
});
