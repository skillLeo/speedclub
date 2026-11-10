/**
 * The API client (05_ARCHITECTURE.md §7): openapi-fetch typed by schema.d.ts.
 *
 *   const vehicles = await apiData(api.GET('/me/vehicles'));
 *   await apiData(api.POST('/vehicles', { body, ...withIdempotency(key) }));
 *
 * Every failure reaches the caller as an ApiError, whatever its cause. Native sends the Bearer token from the
 * keychain. Web sends the session cookie and, before a mutating call, the XSRF header from Sanctum's cookie. A guest on web
 * sends no cookie, except to the sign-in family (BH-33).
 */
import * as Crypto from 'expo-crypto';
import createClient, { type Middleware } from 'openapi-fetch';

import i18n from '@/i18n';
import { isWeb } from '@/lib/platform';
import { getSecure } from '@/lib/secure';
import { sessionSignal, useSessionStore } from '@/state/session';

import { PREVIEW_HEADER, previewToken } from './preview';
import { isViewAsTab, viewAsRefusalFields, viewAsRefusalFor, viewAsToken, type ViewAsRefusal } from './clientViewAs';
import type { components, paths } from './schema';

export type ApiErrorBody = components['schemas']['ApiError'];

export type ApiErrorKind =
  | 'network'
  | 'unauthenticated'
  | 'restricted'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'session_expired'
  | 'maintenance'
  | 'upgrade'
  | 'rate_limited'
  | 'server'
  /** Web: another tab signed in as somebody else, and this tab refused to write for the member it still shows (BH-28). */
  | 'session_moved';

const KIND_BY_STATUS: Readonly<Record<number, ApiErrorKind>> = {
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  419: 'session_expired',
  422: 'validation',
  423: 'maintenance',
  426: 'upgrade',
  429: 'rate_limited',
};

/** The one error type of the API layer. `message` is always translated and safe to show. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** 0 when the request never got an answer. */
  readonly status: number;
  readonly code: string;
  /** Messages by field, for React Hook Form. */
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  /** Seconds until the next attempt, from `Retry-After`. */
  readonly retryAfter: number | null;
  /** End of an account restriction; null when it has none. */
  readonly restrictedUntil: string | null;
  /** With `password_change_required`: the address for the reset form. Null otherwise. */
  readonly email: string | null;

  constructor(init: {
    kind: ApiErrorKind;
    status: number;
    code: string;
    message: string;
    fieldErrors?: Readonly<Record<string, readonly string[]>>;
    retryAfter?: number | null;
    restrictedUntil?: string | null;
    email?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors ?? {};
    this.retryAfter = init.retryAfter ?? null;
    this.restrictedUntil = init.restrictedUntil ?? null;
    this.email = init.email ?? null;
  }
}

/** Every error body has the fields of ApiError; some add their own, as `email` with password_change_required. */
function isErrorBody(body: unknown): body is Partial<ApiErrorBody> & { email?: unknown } {
  return typeof body === 'object' && body !== null;
}

/** `Retry-After` is seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

export function networkError(): ApiError {
  return new ApiError({ kind: 'network', status: 0, code: 'network', message: i18n.t('errors:network') });
}

/** View-as (m3.2-contract §3): what the server would refuse such a token, refused here before it is sent. */
export function viewAsRefusedError(code: ViewAsRefusal): ApiError {
  return new ApiError(viewAsRefusalFields(code));
}

/** BH-28: a write refused because the browser's session now belongs to another member. Its own copy, never the network's. */
export function sessionMovedError(): ApiError {
  return new ApiError({ kind: 'session_moved', status: 0, code: 'session_moved', message: i18n.t('auth:sessionMoved.body') });
}

/** ADR-245/248: 403 on a member write while the current AGB or Datenschutz is not accepted. */
export const CONSENT_REQUIRED = 'consent_required';

/** Whether an error is the re-consent refusal (ADR-245): the consent sheet answers it, never a generic error. */
export function isConsentRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === CONSENT_REQUIRED;
}

/** Builds the ApiError of a response that was not OK. */
export function toApiError(response: Pick<Response, 'status' | 'headers'>, body: unknown): ApiError {
  const parsed = isErrorBody(body) ? body : {};
  const kind: ApiErrorKind =
    parsed.code === 'account_restricted' ? 'restricted' : (KIND_BY_STATUS[response.status] ?? 'server');
  return new ApiError({
    kind,
    status: response.status,
    code: typeof parsed.code === 'string' ? parsed.code : kind,
    // ADR-245: a write refused for a missing re-consent says what to do, in the app's words; the consent sheet comes up with it.
    message:
      parsed.code === CONSENT_REQUIRED
        ? i18n.t('errors:consent_required')
        : typeof parsed.message === 'string' && parsed.message
          ? parsed.message
          : i18n.t(`errors:${kind}`),
    fieldErrors: parsed.errors ?? {},
    retryAfter: parseRetryAfter(response.headers.get('Retry-After')),
    restrictedUntil: typeof parsed.until === 'string' ? parsed.until : null,
    email: typeof parsed.email === 'string' ? parsed.email : null,
  });
}

export type ApiGateEvent = 'maintenance' | 'upgrade' | 'unauthenticated' | 'password_change_required' | 'session_moved' | 'consent_required';
/** With `password_change_required`: the address for the reset form. */
export type ApiGateDetail = { email?: string };

const gateListeners = new Set<(event: ApiGateEvent, detail?: ApiGateDetail) => void>();

/**
 * The app-config gate hears 423 and 426 here. The session lifecycle (features/auth) hears `unauthenticated` for the
 * session-expired dialog and `password_change_required` (ADR-137) to go to AUTH-07, SessionHost hears `session_moved` to
 * offer the reload when the tab did not go by itself, and ConsentHost hears `consent_required` (ADR-245) to bring up its sheet.
 */
export function onApiGateEvent(listener: (event: ApiGateEvent, detail?: ApiGateDetail) => void): () => void {
  gateListeners.add(listener);
  return () => gateListeners.delete(listener);
}

const GATE_EVENT_BY_STATUS: Readonly<Record<number, ApiGateEvent>> = {
  423: 'maintenance',
  426: 'upgrade',
};

/** The code of an error answer, and the address some carry. The caller keeps the body, so this reads a copy. */
async function errorFieldsOf(response: Response): Promise<{ code?: unknown; email?: unknown }> {
  try {
    const body: unknown = await response.clone().json();
    return isErrorBody(body) ? body : {};
  } catch {
    return {};
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const XSRF_COOKIE = 'XSRF-TOKEN';

/** The route that swaps the token. Its own request must not wait for the swap it belongs to. */
const TOKEN_ROTATION_PATH = '/auth/token/rotate';

/**
 * BH-33: what a guest on web still sends cookies to. A cookie left by a logout that failed, or by a session the app gave up on,
 * would otherwise turn a guest's requests into the member's, answers for the owner included. Sign-in and verify read and
 * replace the cookie; a logout retry is how that cookie ends. The XSRF cookie comes from its own call, which always sends them.
 */
const COOKIE_PATHS: ReadonlySet<string> = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/email/verify',
  '/auth/email/resend',
  '/auth/password/forgot',
  '/auth/password/reset',
  // AUTH-11 (M2.5): the SPA answer of a sign-in with two-factor is the session, so the challenge needs the XSRF cookie too.
  '/auth/two-factor/challenge',
  '/auth/logout',
]);

/** The id in a stored `sc.sessionMember`, or null for none. */
export function memberIdOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const id = (JSON.parse(raw) as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

function storedMemberId(): string | null {
  try {
    return memberIdOf(typeof window === 'undefined' ? null : window.localStorage?.getItem('sc.sessionMember'));
  } catch {
    // Storage blocked: nothing to compare with.
    return null;
  }
}

/**
 * BH-28, web: all tabs of a browser share one cookie, and `sc.sessionMember` says whose it became. True when another tab signed
 * in as somebody else than this tab still shows. Nothing stored says nothing: then the cookie is gone, and the server answers 401.
 */
export function sessionMovedToAnotherMember(): boolean {
  // A view-as tab sends no cookie: whose the cookie is says nothing about it.
  if (isViewAsTab()) return false;
  const { status, member } = useSessionStore.getState();
  if (status !== 'member' || !member) return false;
  const stored = storedMemberId();
  return stored !== null && stored !== member.id;
}

/** Set right before the reload, for the stopper below. */
let reloading = false;

/**
 * BH-28: a reload for another member must not stop at a form's discard prompt, which would ask about text of a member this tab no
 * longer belongs to. Chromium runs a window's listeners in the order they were added, the capture flag notwithstanding, so this one
 * is added once, as this module loads, before any screen can add a guard. It only acts while reloadTab is on its way.
 */
if (isWeb && typeof window !== 'undefined') {
  window.addEventListener?.(
    'beforeunload',
    (event) => {
      if (reloading) event.stopImmediatePropagation();
    },
    { capture: true },
  );
}

/** Web: loads this tab again, for the member the cookie now belongs to, without a form's prompt in the way. */
export function reloadTab(): void {
  if (typeof window === 'undefined') return;
  reloading = true;
  window.location?.reload?.();
}

/**
 * Refuses a write for a member the cookie no longer belongs to: the tab reloads, and SessionHost's dialog says why. A form adds
 * no notice of its own (applyServerErrors, DQ-256).
 */
function refuseForMovedSession(): never {
  reloadTab();
  gateListeners.forEach((listener) => listener('session_moved'));
  throw sessionMovedError();
}

/**
 * SEC-S-02: the check that the API client makes before every write, for the requests that do not go through it, as the XHR uploads
 * (api/queries/profile.ts, media.ts). Web only: a native token belongs to the app alone. A tab that missed another tab's sign-in, or
 * a guest whose tab sees somebody signed in, refuses and reloads. A guest with nobody signed in has no session to write for.
 */
export function guardMemberWrite(): void {
  if (!isWeb) return;
  // View-as is read-only: no upload leaves the tab.
  if (isViewAsTab()) throw viewAsRefusedError('view_as_read_only');
  const { status, member } = useSessionStore.getState();
  if (status === 'member' && member) {
    if (sessionMovedToAnotherMember()) refuseForMovedSession();
    return;
  }
  if (storedMemberId() !== null) refuseForMovedSession();
  throw new ApiError({ kind: 'unauthenticated', status: 0, code: 'unauthenticated', message: i18n.t('errors:unauthenticated') });
}

/** Web, BH-33: whether a request outside the API client may carry the cookie. Only a member's: a guest sends none. */
export function sendsSessionCookie(): boolean {
  return isWeb && !isViewAsTab() && useSessionStore.getState().status === 'member';
}

/**
 * SEC-S-04: the signals each bound request follows, from the one openapi-fetch gave it to the one the fetch reads. WebKit lets a
 * Request's own signal, and the result of AbortSignal.any, be garbage-collected once script holds none of them, and the abort then
 * no longer reaches the network. So every link of the chain is kept until the request settles (`fetchHolding`).
 */
const signalChains = new WeakMap<Request, readonly AbortSignal[]>();
/** The chains of the requests under way. One entry per request: a signal shared by two requests stays held while either runs. */
const heldChains = new Set<readonly AbortSignal[]>();

/** Ties a request to the session that sends it (SEC-S-01): ending the session aborts it, with its own cancel kept as well. */
function boundToSession(request: Request): Request {
  const session = sessionSignal();
  if (request.signal === session) return request;
  const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any([request.signal, session]) : session;
  const bound = new Request(request, { signal });
  signalChains.set(bound, [request.signal, signal, bound.signal]);
  return bound;
}

/** Runs the fetch with every signal of the request held until it settles (SEC-S-04). Reads hold their own, so a cancel lands too. */
async function fetchHolding(request: Request, fetchImpl: (request: Request) => Promise<Response>): Promise<Response> {
  const chain = signalChains.get(request) ?? [request.signal];
  heldChains.add(chain);
  try {
    return await fetchImpl(request);
  } finally {
    heldChains.delete(chain);
  }
}

/** Tests only: the signals held for the requests under way. */
export function signalsHeldInFlight(): AbortSignal[] {
  return [...heldChains].flat();
}

let tokenChange: Promise<void> | null = null;

/**
 * Runs a change of the stored token (the rotation) while every other request waits for it, so it leaves with the token that
 * ends up stored. The replaced token keeps working for 120 s after the rotation commits, and a request still under way when
 * that token is gone is covered by the retry in the auth middleware. The rotation's own request passes.
 */
export async function whileTokenChanges<T>(change: () => Promise<T>): Promise<T> {
  let release: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    release = resolve;
  });
  tokenChange = settled;
  try {
    return await change();
  } finally {
    if (tokenChange === settled) tokenChange = null;
    release();
  }
}

function bearerOf(request: Request): string | null {
  const header = request.headers.get('Authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

export function readCookie(cookies: string, name: string): string | null {
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export type ApiClientOptions = {
  /** Origin without a trailing slash. */
  origin: string;
  /** Cookie session + XSRF instead of the Bearer token. */
  cookieAuth: boolean;
  fetch?: (request: Request) => Promise<Response>;
  getToken?: () => Promise<string | null>;
  getCookies?: () => string;
  getLanguage?: () => string;
  /** Whether a member is signed in. On web the only sign of a session, because its cookie is out of reach. */
  hasSession?: () => boolean;
  /**
   * Native: whether the keychain's token may go out. Not while the app runs as a guest: a token left behind then belongs to
   * no session the app holds (a restore that could not be confirmed), and its answers would not be the guest's.
   */
  mayUseToken?: () => boolean;
  /** Web: whether the app runs as a guest, which sends no cookie but to COOKIE_PATHS. */
  isGuest?: () => boolean;
};

function browserOrigin(): string {
  return typeof window === 'undefined' ? '' : (window.location?.origin ?? '');
}

export function apiOrigin(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
  return configured || (isWeb ? browserOrigin() : '');
}

export function createApiClient({
  origin,
  cookieAuth,
  fetch: fetchImpl = (request) => globalThis.fetch(request),
  getToken = () => getSecure('sc.authToken'),
  getCookies = () => (typeof document === 'undefined' ? '' : document.cookie),
  getLanguage = () => i18n.language,
  hasSession = () => useSessionStore.getState().status === 'member',
  mayUseToken = () => useSessionStore.getState().status !== 'guest',
  isGuest = () => useSessionStore.getState().status === 'guest',
}: ApiClientOptions) {
  let csrfRequest: Promise<void> | null = null;
  let csrfStale = false;
  /** An unsent copy of each request that carries the token, for the one retry after a rotation. */
  const spares = new WeakMap<Request, Request>();
  /**
   * Requests that brought a token of their own: a guest's question about a kept token, or the revoke of another member's token
   * left from a logout that failed (BH-33). Their 401 says nothing about the session the app holds now.
   */
  const ownToken = new WeakSet<Request>();

  async function readToken(): Promise<string | null> {
    try {
      return await getToken();
    } catch {
      // A locked or broken keychain must not fail the request: public routes still answer without a token.
      console.warn('Could not read the auth token');
      return null;
    }
  }

  /** A request that brings its own Authorization keeps it: that is how a guest's app asks whether a kept token still works. */
  async function attachToken(request: Request): Promise<void> {
    if (request.headers.has('Authorization')) {
      ownToken.add(request);
      return;
    }
    if (!mayUseToken()) return;
    const token = await readToken();
    if (!token) return;
    request.headers.set('Authorization', `Bearer ${token}`);
    spares.set(request, request.clone());
  }

  /**
   * A 401 for a token that a rotation has replaced since the request left: the server never saw the new one, so the
   * request goes again, once, with it. Null when the token sent is still the one stored, and the 401 stands.
   */
  async function retryWithNewToken(request: Request): Promise<{ request: Request; response: Response } | null> {
    const sentToken = bearerOf(request);
    const spare = spares.get(request);
    if (!sentToken || !spare) return null;
    await tokenChange;
    const current = await readToken();
    if (!current || current === sentToken) return null;
    spare.headers.set('Authorization', `Bearer ${current}`);
    return { request: spare, response: await fetchHolding(spare, fetchImpl) };
  }

  /** Parallel mutating calls share one request. */
  function fetchCsrfCookie(): Promise<void> {
    csrfRequest ??= fetchImpl(new Request(`${origin}/sanctum/csrf-cookie`, { credentials: 'include' }))
      .then(() => {
        csrfStale = false;
      })
      .finally(() => {
        csrfRequest = null;
      });
    return csrfRequest;
  }

  const auth: Middleware = {
    async onRequest({ request, schemaPath }) {
      request.headers.set('Accept', 'application/json');
      request.headers.set('Accept-Language', getLanguage());
      // ADM-34 draft preview (web): every read carries the page's preview token, so the API answers with the staff member's drafts.
      const preview = previewToken();
      if (preview && SAFE_METHODS.has(request.method)) request.headers.set(PREVIEW_HEADER, preview);
      if (!cookieAuth) {
        if (schemaPath !== TOKEN_ROTATION_PATH) await tokenChange;
        await attachToken(request);
        return request;
      }
      // View-as (web): the token as the Bearer and no cookie at all, and nothing the server would refuse it.
      if (isViewAsTab()) {
        const refusal = viewAsRefusalFor(request.method, schemaPath);
        if (refusal) throw viewAsRefusedError(refusal);
        const bearer = viewAsToken();
        if (bearer) request.headers.set('Authorization', `Bearer ${bearer}`);
        return new Request(request, { credentials: 'omit' });
      }
      // Without the cookie the server runs no session, so this needs no XSRF header either.
      if (isGuest() && !COOKIE_PATHS.has(schemaPath)) return new Request(request, { credentials: 'omit' });
      if (SAFE_METHODS.has(request.method)) return request;
      // Never a write for a member the cookie no longer belongs to. The reload brings the tab to the member it does.
      if (sessionMovedToAnotherMember()) refuseForMovedSession();
      // Laravel rotates the cookie, so the header is read for every call, never cached.
      if (csrfStale || readCookie(getCookies(), XSRF_COOKIE) === null) await fetchCsrfCookie();
      const token = readCookie(getCookies(), XSRF_COOKIE);
      if (token !== null) request.headers.set('X-XSRF-TOKEN', token);
      // A member's write is cancelled with the session, before its answer can set the cookie again (SEC-S-01). Reads go with the
      // query cache, which cancels them as the session ends.
      return hasSession() ? boundToSession(request) : request;
    },
    async onResponse({ request, response: first, schemaPath }) {
      // A 419 means the token went stale: fetch a new cookie before the next mutating call.
      if (first.status === 419) csrfStale = true;
      // The public config call says nothing about the session, and the listeners answer a gate event by polling it.
      // Hearing its own answer, the poll would never stop.
      if (schemaPath === '/app-config') return undefined;
      // The rotation's own 401 is final: waiting for the rotation there would wait for itself.
      const retried = first.status === 401 && schemaPath !== TOKEN_ROTATION_PATH ? await retryWithNewToken(request) : null;
      const sent = retried?.request ?? request;
      const response = retried?.response ?? first;
      const event = GATE_EVENT_BY_STATUS[response.status];
      if (event) gateListeners.forEach((listener) => listener(event));
      // A 401 alone proves nothing: a wrong password answers with invalid_credentials, and a guest has no session to
      // lose. Only the loss of a session that was really held may raise the session-expired flow.
      const ownSession = !ownToken.has(request) && (sent.headers.has('Authorization') || hasSession());
      if ((response.status === 401 || response.status === 403) && ownSession) {
        const { code, email } = await errorFieldsOf(response);
        if (response.status === 401 && code === 'unauthenticated') {
          gateListeners.forEach((listener) => listener('unauthenticated'));
        }
        // Any authenticated route can answer this once the account is flagged, not only the sign-in.
        if (response.status === 403 && code === 'password_change_required') {
          const detail = typeof email === 'string' ? { email } : {};
          gateListeners.forEach((listener) => listener('password_change_required', detail));
        }
        // ADR-245/248: any member write can answer this while a re-consent is open; the consent host brings up its sheet.
        if (response.status === 403 && code === CONSENT_REQUIRED) {
          gateListeners.forEach((listener) => listener('consent_required'));
        }
      }
      return retried ? response : undefined;
    },
  };

  const client = createClient<paths>({
    baseUrl: `${origin}/api/v1`,
    fetch: (request) => fetchHolding(request, fetchImpl),
    ...(cookieAuth ? { credentials: 'include' as const } : {}),
  });
  client.use(auth);
  return client;
}

export const api = createApiClient({ origin: apiOrigin(), cookieAuth: isWeb });

type ApiResult<T> = { data?: T; error?: unknown; response: Response };

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * The data of a call, or an ApiError. A cancelled query stays an AbortError, because TanStack Query handles it. An ApiError the
 * middleware raised before sending, as a refused write, stays what it is.
 */
export async function apiData<T>(call: Promise<ApiResult<T>>): Promise<T> {
  let result: ApiResult<T>;
  try {
    result = await call;
  } catch (error) {
    if (isAbort(error) || error instanceof ApiError) throw error;
    throw networkError();
  }
  if (!result.response.ok) throw toApiError(result.response, result.error);
  return result.data as T;
}

/** A new key per user intent. Keep it across retries of the same intent: that is what makes the retry safe. */
export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}

/** Spread into the options of a creating POST. */
export function withIdempotency(key: string = newIdempotencyKey()): { headers: { 'Idempotency-Key': string } } {
  return { headers: { 'Idempotency-Key': key } };
}
