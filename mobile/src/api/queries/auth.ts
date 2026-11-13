/**
 * Accounts (05_ARCHITECTURE.md §7, §8): the sign-in family, the signed-in member, onboarding and settings.
 *
 * Native gets a token, kept in the keychain. Web gets a cookie session, and login and email/verify must ask for a fresh
 * CSRF cookie right before they run (ADR-124). Everything that touches the session store goes through here, so a screen
 * only calls a mutation and reacts to its error.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { api, ApiError, apiData, apiOrigin, networkError, whileTokenChanges, withIdempotency } from '@/api/client';
import { isViewAsTab, requestViewAsEnd } from '@/api/clientViewAs';
import { appConfigKey } from '@/api/queries/appConfig';
import { clearQueryCache, queryClient, removePersistedCache } from '@/api/queryClient';
import type { components } from '@/api/schema';
import i18n from '@/i18n';
import { normalizeEmail } from '@/lib/emailAddress';
import { isNative, isWeb } from '@/lib/platform';
import { qa } from '@/lib/qa';
import { deleteSecure, getSecure, setSecure } from '@/lib/secure';
import { setPowerDisplay } from '@/lib/powerDisplay';
import { getStored, removeStored, setStored } from '@/lib/storage';
import {
  abortSessionRequests,
  clearAuthIntent,
  sessionSignal,
  setGuest,
  setMember,
  setMemberChanged,
  useSessionStore,
  type SessionMember,
} from '@/state/session';
import { forgetConsentClearance } from '@/state/consent';
import { clearUploads } from '@/state/uploads';
import { fixedThemePreference, getThemePreference, setThemePreference, useThemePreference } from '@/theme';

import appVersion from '../../../version.json';

export type Me = components['schemas']['MeResource'];
export type AuthSession = components['schemas']['AuthSessionResource'];
export type NextStep = components['schemas']['NextStepResource'];
export type UsernameAvailability = components['schemas']['UsernameAvailabilityResource'];
export type UsernameReason = components['schemas']['UsernameUnavailableReason'];
export type MemberSettings = components['schemas']['MemberSettingsResource'];
type SettingsPatch = components['schemas']['UpdateSettingsRequest'];
/** A concrete language: the account may also say "system" (follow the device), which is never synced as a language. */
type Locale = Exclude<NonNullable<SettingsPatch['locale']>, 'system'>;
type ThemePreference = MemberSettings['theme'];

export const meKey = ['auth', 'me'] as const;

/**
 * SEC-S-03, ADR-152(e): the persisted cache holds no address, and Me carries the member's. So Me stays in memory. The start does not
 * miss it: the restore asks auth/me before the splash hides and writes the answer here, and the shell draws from sc.sessionMember.
 * Set as a default of the key, so it holds however the query comes to exist, through useMe or through setQueryData.
 */
queryClient.setQueryDefaults(meKey, { meta: { persist: false } });
const TOKEN_KEY = 'sc.authToken';
const TOKEN_EXPIRY_KEY = 'sc.authTokenExpiresAt';
const DAY_MS = 24 * 60 * 60 * 1000;
/** 05_ARCHITECTURE §7: a token lives 90 days and is rotated once it is more than 7 days old. */
const TOKEN_LIFETIME_MS = 90 * DAY_MS;
const TOKEN_ROTATE_AFTER_MS = 7 * DAY_MS;
/** A sign-out never waits longer than this for the server: the device is signed out either way. */
const LOGOUT_TIMEOUT_MS = 4000;
/**
 * Every request waits for a rotation, so it gets no longer than this. The device keeps the old token when it gives up, but the
 * server may have committed by then, and then that token only lives another 120 s (RotateMemberToken): see ROTATE_RETRY_AT_MS.
 */
const ROTATE_TIMEOUT_MS = 8000;
/**
 * After a try without an answer, when to try again, counted from that failure. A repeat on the old token within its 120 s gets a
 * fresh token, so a lost answer costs nothing. The last try ends by about 101 s, even after a first try that ran into its timeout.
 */
const ROTATE_RETRY_AT_MS = [5000, 20_000, 45_000, 85_000] as const;

/** The smallest variant that fills `size` on a 3x screen, or the largest there is. */
export function avatarUrlOf(media: Me['avatar'], size: number = 96 * 3): string | null {
  const variants = [...(media?.variants ?? [])].sort((a, b) => a.width - b.width);
  return (variants.find((variant) => variant.width >= size) ?? variants[variants.length - 1])?.url ?? null;
}

export function toSessionMember(me: Me): SessionMember {
  return {
    id: me.id,
    username: me.username ?? '',
    displayName: me.display_name,
    avatarUrl: avatarUrlOf(me.avatar),
    nextStep: me.next_step,
    hasCover: Boolean(me.cover),
  };
}

function isSessionMember(value: unknown): value is SessionMember {
  if (typeof value !== 'object' || value === null) return false;
  const { id, username } = value as Partial<SessionMember>;
  return typeof id === 'string' && typeof username === 'string';
}

export async function readCachedMember(): Promise<SessionMember | null> {
  const raw = await getStored('sc.sessionMember');
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSessionMember(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const DEVICE_ID_KEY = 'sc.deviceId';
let deviceIdRead: Promise<string | null> | null = null;

/**
 * Native: this install's own id, made once and kept in the keychain. The server keys one token per device on it, so two phones of
 * the same model no longer sign each other out. Null when the keychain cannot keep one: an id that changes with every sign-in would
 * only pile up tokens, and without one the server goes by the device name, as before.
 */
export function deviceId(): Promise<string | null> {
  deviceIdRead ??= (async () => {
    try {
      const kept = await SecureStore.getItemAsync(DEVICE_ID_KEY);
      if (kept) return kept;
      const created = Crypto.randomUUID();
      await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
      return created;
    } catch (error) {
      console.warn('Could not keep a device id', error);
      return null;
    }
  })().then((id) => {
    if (id === null) deviceIdRead = null;
    return id;
  });
  return deviceIdRead;
}

/** The app and system versions now (M4.7, 09 §8.4): what SET-06 shows of this device. Native only. */
export function deviceVersions(): { app_version: string; os_version?: string } {
  const os = Device.osVersion;
  return { app_version: Application.nativeApplicationVersion ?? appVersion.versionName, ...(os ? { os_version: os } : {}) };
}

/** The fingerprint of a device, native only: web has a cookie and no token. */
export async function deviceFields() {
  if (!isNative) return {};
  const id = await deviceId();
  return {
    device_name: Device.modelName ?? 'SPEED CLUB App',
    platform: (Device.osName === 'iOS' || Device.osName === 'iPadOS' ? 'ios' : 'android') as 'ios' | 'android',
    ...deviceVersions(),
    ...(id ? { device_id: id } : {}),
  };
}

async function storeToken(session: Pick<AuthSession, 'token' | 'token_expires_at'>): Promise<void> {
  if (!session.token) return;
  await setSecure(TOKEN_KEY, session.token);
  if (session.token_expires_at) await setSecure(TOKEN_EXPIRY_KEY, session.token_expires_at);
}

/**
 * The token native holds, or null. Web cannot read its session cookie, and every cookie it can read survives a sign-out
 * (the server hands out a fresh guest session), so there the cached member is the only sign of a session.
 */
export async function storedToken(): Promise<string | null> {
  if (!isNative) return null;
  try {
    return await getSecure(TOKEN_KEY);
  } catch (error) {
    console.warn('Could not read the auth token', error);
    return null;
  }
}

export async function hasStoredToken(): Promise<boolean> {
  return (await storedToken()) !== null;
}

export async function fetchMe(signal?: AbortSignal): Promise<Me> {
  const { data } = await apiData(api.GET('/auth/me', { signal }));
  return data;
}

/**
 * auth/me with a given token, while the app runs as a guest and so sends none by itself: whether a token that the start
 * could not confirm still holds a session.
 */
export async function fetchMeWithToken(token: string): Promise<Me> {
  const { data } = await apiData(api.GET('/auth/me', { headers: { Authorization: `Bearer ${token}` } }));
  return data;
}

/**
 * BH-28: the session belongs to another member than the one the app has been showing. What the previous one loaded and queued
 * must not reach this one, and the app goes home. Web only in practice, where one cookie serves every tab of a browser.
 */
export function forgetPreviousMember(): void {
  void clearQueryCache();
  void clearUploads();
  void forgetConsentClearance();
  useSessionStore.setState({ expiredFrom: null });
  setMemberChanged(true);
}

/**
 * The member the app runs as from now on: a sign-in, the start's restore, or auth/me answering for another member (BH-28). It may
 * promote and swap. A write's answer never comes here: see refreshMe.
 */
export function adoptMe(me: Me): void {
  // View-as (m3.2-contract §3): the member is held in memory only, by features/viewAs.
  if (isViewAsTab()) {
    if (useSessionStore.getState().member?.id !== me.id) return;
    queryClient.setQueryData(meKey, me);
    setMember(toSessionMember(me));
    return;
  }
  const { member: current, expiredFrom } = useSessionStore.getState();
  const previous = current?.id ?? expiredFrom;
  if (previous && previous !== me.id) forgetPreviousMember();
  const member = toSessionMember(me);
  queryClient.setQueryData(meKey, me);
  setMember(member);
  setPowerDisplay(me.power_display);
  void setStored('sc.sessionMember', JSON.stringify(member));
}

/**
 * SEC-S-01: the Me a member's own write answers with. It updates the member the app runs as, and nobody else: an answer that lands
 * after a sign-out, or after another member took over, is dropped, so it can neither sign the device back in nor swap members.
 */
export function refreshMe(me: Me): void {
  const { status, member: current } = useSessionStore.getState();
  if (status !== 'member' || current?.id !== me.id) return;
  const member = toSessionMember(me);
  queryClient.setQueryData(meKey, me);
  setMember(member);
  if (isViewAsTab()) return;
  setPowerDisplay(me.power_display);
  void setStored('sc.sessionMember', JSON.stringify(member));
}

/** After a sign-in. Everything loaded as a guest may read differently now (follow state, restrictions). */
export async function adoptSession(session: AuthSession): Promise<void> {
  await storeToken(session);
  void settlePendingLogoutAtSignIn(session.member.id);
  adoptMe(session.member);
  void reconcileSettings(session.member);
  void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== appConfigKey[0] && query.queryKey !== meKey });
}

/**
 * Forgets the session on this device. The theme and the language stay (§11), since they belong to the device too. The
 * photo upload queue goes with the session: it holds the member's files and targets (state/uploads.ts). `keepQueries`: a form
 * stays on screen until the member chooses (BH-30), so the loaded data stays in memory until then, and only the disk forgets it.
 */
export async function clearLocalSession(options: { keepQueries?: boolean } = {}): Promise<void> {
  // A view-as tab stored nothing, and what this browser stored belongs to whoever uses it.
  if (isViewAsTab()) {
    if (!options.keepQueries) queryClient.clear();
    return;
  }
  const results = await Promise.allSettled([
    deleteSecure(TOKEN_KEY),
    deleteSecure(TOKEN_EXPIRY_KEY),
    removeStored('sc.sessionMember'),
    options.keepQueries ? removePersistedCache() : clearQueryCache(),
    clearUploads(),
    forgetConsentClearance(),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') console.warn('Could not clear the local session', result.reason);
  }
}

/**
 * `heard`: a 204, or a 401 for a session that was over already. `lost`: offline, too slow or the server in trouble, so the session
 * stays valid on the server. `moved`: web, the cookie belongs to another member by now, and the client refused to send this
 * (BH-28). The answer never holds up a sign-out.
 */
type LogoutOutcome = 'heard' | 'lost' | 'moved';

async function postLogout(token?: string | null): Promise<LogoutOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS);
  try {
    await apiData(api.POST('/auth/logout', { signal: controller.signal, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }));
    return 'heard';
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'session_moved') return 'moved';
    return error instanceof ApiError && error.status === 401 ? 'heard' : 'lost';
  } finally {
    clearTimeout(timer);
  }
}

// -- BH-33: a logout the server did not hear. Web keeps a marker, since the cookie itself is out of reach; native keeps the old
// token in a slot of its own, which nothing else sends, with the member it belonged to.
const LOGOUT_PENDING_KEY = 'sc.logoutPending';

/** Native: the token still to revoke, and its member. Null member: written by a build that kept the bare token. */
type PendingLogout = { token: string | null; member: string | null };

function readPending(raw: string): PendingLogout {
  if (!isNative) return { token: null, member: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const { token, member } = parsed as { token?: unknown; member?: unknown };
      return { token: typeof token === 'string' ? token : null, member: typeof member === 'string' ? member : null };
    }
  } catch {
    // The bare token of an earlier build.
  }
  return { token: raw, member: null };
}

async function rememberLogout(token: string | null, member: string | null): Promise<void> {
  try {
    if (!isNative) await AsyncStorage.setItem(LOGOUT_PENDING_KEY, '1');
    else if (token) await SecureStore.setItemAsync(LOGOUT_PENDING_KEY, JSON.stringify({ token, member }));
  } catch (error) {
    console.warn('Could not remember the logout', error);
  }
}

async function pendingLogout(): Promise<PendingLogout | null> {
  try {
    const raw = await (isNative ? SecureStore.getItemAsync(LOGOUT_PENDING_KEY) : AsyncStorage.getItem(LOGOUT_PENDING_KEY));
    return raw === null ? null : readPending(raw);
  } catch {
    return null;
  }
}

async function forgetPendingLogout(): Promise<void> {
  try {
    await (isNative ? SecureStore.deleteItemAsync(LOGOUT_PENDING_KEY) : AsyncStorage.removeItem(LOGOUT_PENDING_KEY));
  } catch (error) {
    console.warn('Could not forget the logout', error);
  }
}

let retryingLogout = false;

/** From the start of a guest and when the device comes online. Never for a member: that session is a newer one. */
export async function retryPendingLogout(): Promise<void> {
  if (isViewAsTab()) return;
  if (retryingLogout || useSessionStore.getState().status === 'member') return;
  retryingLogout = true;
  try {
    const pending = await pendingLogout();
    if (pending === null) return;
    if ((await postLogout(pending.token)) === 'heard') await forgetPendingLogout();
  } finally {
    retryingLogout = false;
  }
}

/**
 * SEC-S-05, native: a logout still owed goes out before the sign-in request, whoever the token belonged to. The server replaces this
 * device's token only when it carries the same device_id, so a token from a build that sent none would outlive the sign-in. Before is
 * the only safe moment: after it, a revoke with a token of the same device_id would end the new token too. Heard, the slot goes;
 * lost, it stays for the check after the sign-in (settlePendingLogoutAtSignIn).
 */
export async function revokePendingLogoutBeforeSignIn(): Promise<void> {
  if (!isNative) return;
  const pending = await pendingLogout();
  if (pending === null) return;
  if (!pending.token || (await postLogout(pending.token)) === 'heard') await forgetPendingLogout();
}

/**
 * A sign-in replaced the cookie, or this device's token of the member who signs in, so a logout still owed for that session would
 * only end the new one. Native normally finds the slot empty here: revokePendingLogoutBeforeSignIn sent it already. A token of another member is still live, though: the server ends only the signing-in member's token of a
 * device (BH-33 native). It is revoked first, once and with its own header, and forgotten whatever the answer.
 */
async function settlePendingLogoutAtSignIn(memberId: string): Promise<void> {
  if (isNative) {
    const pending = await pendingLogout();
    if (pending === null) return;
    if (pending.token && pending.member !== memberId) await postLogout(pending.token);
  }
  await forgetPendingLogout();
}

let signingOut = false;

export function isSigningOut(): boolean {
  return signingOut;
}

/** How long a sign-out waits for its hooks: they are best effort, and the logout must never hang on them. */
const SIGN_OUT_HOOK_MS = 3000;
const signOutHooks = new Set<() => Promise<void>>();

/**
 * Work that needs the session one last time, before the logout ends it: the push token of this device (M2.2). A hook that fails or
 * takes too long is left behind; the server ends the device's push token with the logout as well.
 */
export function beforeSignOut(hook: () => Promise<void>): () => void {
  signOutHooks.add(hook);
  return () => signOutHooks.delete(hook);
}

async function runSignOutHooks(): Promise<void> {
  if (signOutHooks.size === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SIGN_OUT_HOOK_MS);
  });
  await Promise.race([Promise.allSettled([...signOutHooks].map((hook) => hook())), timeout]);
  clearTimeout(timer);
}

export async function signOut(): Promise<void> {
  // "Abmelden" in a view-as tab ends the view: the member's own sessions are none of its business.
  if (isViewAsTab()) return requestViewAsEnd();
  signingOut = true;
  try {
    // Writes under way go first (SEC-S-01): their answers would speak for this session after it ended.
    abortSessionRequests();
    await runSignOutHooks();
    const memberId = useSessionStore.getState().member?.id ?? null;
    const token = await storedToken();
    const outcome = await postLogout();
    // BH-28: another tab signed in as somebody else, and the cookie, the stored member and the cache are theirs. This tab reloads
    // to them, and leaves all of that alone.
    if (outcome === 'moved') return;
    if (outcome === 'lost') await rememberLogout(token, memberId);
    // Guest first: clearing the cache with a member still set would make the member's queries fetch again, and on web such
    // a call starts a new cookie session.
    clearAuthIntent();
    setGuest();
    abortSessionRequests();
    await clearLocalSession();
  } finally {
    signingOut = false;
  }
}

/**
 * The server already ended this session: a password reset ends every one of them (AUTH-07). Forgets it on this device
 * without the session-expired dialog, which would only repeat what the member just did. Nothing to do for a guest.
 */
export async function endLocalSessionQuietly(): Promise<void> {
  if (useSessionStore.getState().status !== 'member') return;
  abortSessionRequests();
  clearAuthIntent();
  setGuest();
  await clearLocalSession();
}

/**
 * BH-33: a reset ends every session of that account, and only that account's. On a browser signed in as somebody else, the
 * session goes on: ending it here would only hide it, with the server still holding it. The session store holds no address, so
 * this asks the cached Me. Without one it cannot tell, and leaves the session alone: if it was this account, the next request
 * hears the 401.
 */
export async function endLocalSessionAfterReset(email: string): Promise<'ended' | 'kept' | 'none'> {
  if (useSessionStore.getState().status !== 'member') return 'none';
  const me = queryClient.getQueryData<Me>(meKey);
  // The server keeps the domain in ASCII (ADR-183), the member typed it as they write it: müller.de is xn--mller-kva.de.
  if (!me || normalizeEmail(me.email) !== normalizeEmail(email)) return 'kept';
  await endLocalSessionQuietly();
  return 'ended';
}

/** BH-30: the member chose not to sign in again, so what the held form still showed goes now. */
export async function releaseExpiredSession(): Promise<void> {
  if (useSessionStore.getState().expiredFrom === null) return;
  useSessionStore.setState({ expiredFrom: null });
  await clearQueryCache();
}

/** One rotation at a time. A second call while one runs would revoke the first one's token, so only the last answer may be kept. */
let rotation: Promise<void> | null = null;
let rotationRetryTimer: ReturnType<typeof setTimeout> | null = null;
/** Still to come after a try that got no answer, as times on the clock. Null: no such try is open. */
let rotationRetries: number[] | null = null;

function stopRotationRetries(): void {
  if (rotationRetryTimer) clearTimeout(rotationRetryTimer);
  rotationRetryTimer = null;
  rotationRetries = null;
}

/** True when the server answered, whatever it said. False when the answer may be lost: the rotation may have committed. */
async function rotateWhenDue(now: number): Promise<boolean> {
  try {
    const expiresAt = await getSecure(TOKEN_EXPIRY_KEY);
    if (!expiresAt) return true;
    const issuedAt = Date.parse(expiresAt) - TOKEN_LIFETIME_MS;
    if (Number.isNaN(issuedAt) || now - issuedAt < TOKEN_ROTATE_AFTER_MS) return true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROTATE_TIMEOUT_MS);
    const id = await deviceId();
    try {
      // The install's id, as at sign-in: a token from before the app sent one takes it here. M4.7: the app and system version now, so
      // SET-06 shows them after an update.
      const body = { ...deviceVersions(), ...(id ? { device_id: id } : {}) };
      const { data } = await apiData(api.POST('/auth/token/rotate', { signal: controller.signal, body }));
      // A session that ended meanwhile, by the server's word, gets no new way in.
      if (useSessionStore.getState().status !== 'guest') await storeToken(data);
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    // An answer of the server ends it here. After a 409 `conflict` the old token is gone, and the next 401 ends the session.
    if (error instanceof ApiError && error.status !== 0) return true;
    if (!(error instanceof ApiError)) console.warn('Could not rotate the token', error);
    return false;
  }
}

function runRotation(now: number, change: () => Promise<boolean>): Promise<void> {
  rotation ??= change()
    .then((answered) => {
      if (answered) stopRotationRetries();
      else scheduleRotationRetry(now);
    })
    .finally(() => {
      rotation = null;
    });
  return rotation;
}

/** The old token works meanwhile, so requests go on with it and do not wait for these tries. */
function scheduleRotationRetry(now: number): void {
  if (rotationRetryTimer) return;
  const failedAt = Date.now();
  rotationRetries ??= ROTATE_RETRY_AT_MS.map((offset) => failedAt + offset);
  const next = rotationRetries.shift();
  if (next === undefined) {
    stopRotationRetries();
    return;
  }
  rotationRetryTimer = setTimeout(() => {
    rotationRetryTimer = null;
    if (useSessionStore.getState().status === 'guest') stopRotationRetries();
    else void runRotation(now, () => rotateWhenDue(now));
  }, Math.max(0, next - failedAt));
}

/**
 * Rotates a token that is due (05_ARCHITECTURE §7). Every other request waits for the first try, so it goes out with the token
 * that ends up stored. The old token keeps working for 120 s after the rotation commits, and that time is never extended: a
 * repeat on it with the new token unused answers a fresh token and revokes the previous one, a repeat after the new one was used
 * answers 409 `conflict` and deletes the old one, and after the 120 s it answers 401. So a try without an answer tries again in
 * that time, or the session would end with the next request.
 */
export function rotateTokenIfDue(now: number = Date.now()): Promise<void> {
  if (!isNative) return Promise.resolve();
  return runRotation(now, () => whileTokenChanges(() => rotateWhenDue(now)));
}

// -- Settings sync (§11): the device and the account agree on theme and language.

type SyncedSettings = { theme?: ThemePreference; locale?: Locale };

function asLocale(value: string): Locale | null {
  return value === 'de' || value === 'en' ? value : null;
}

async function readSynced(): Promise<SyncedSettings> {
  const raw = await getStored('sc.settingsSynced');
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SyncedSettings;
  } catch {
    return {};
  }
}

async function patchSettings(patch: SettingsPatch): Promise<boolean> {
  if (Object.keys(patch).length === 0) return true;
  try {
    await apiData(api.PATCH('/me/settings', { body: patch }));
    return true;
  } catch {
    // Offline or restricted: the marker stays behind, so the next sign-in or change tries again.
    return false;
  }
}

/** One at a time: the sign-in's reconciliation changes the very values the change watcher reacts to. */
let settingsQueue: Promise<unknown> = Promise.resolve();

function enqueueSettings(task: () => Promise<void>): Promise<void> {
  const next = settingsQueue.then(task, task);
  settingsQueue = next.catch((error: unknown) => console.warn('Could not sync the settings', error));
  return next;
}

/**
 * A value on the device that differs from the one last agreed was chosen here since then, so it is newer and goes to the
 * account. Otherwise the account's value applies. The QA overrides win over both and are never sent anywhere.
 */
const THEME_PREFERENCES: ReadonlySet<string> = new Set(['carbon', 'black', 'light', 'system']);

function isThemePreference(value: unknown): value is Me['theme'] {
  return typeof value === 'string' && THEME_PREFERENCES.has(value);
}

export function reconcileSettings(me: Pick<Me, 'theme' | 'locale'>): Promise<void> {
  // View-as: the member's theme and language are neither applied to this browser nor sent anywhere.
  if (isViewAsTab()) return Promise.resolve();
  return enqueueSettings(async () => {
    const synced = await readSynced();
    const next: SyncedSettings = { ...synced };
    const patch: SettingsPatch = {};

    // M4.6: an account the server has just created can answer without its theme (null): the device keeps its own then. Applying
    // an unknown value would leave the theme provider without a theme (a blank page on the member web).
    const accountTheme = isThemePreference(me.theme) ? me.theme : null;
    if (!fixedThemePreference() && accountTheme) {
      const device = await getStored('sc.theme');
      if (device && device !== synced.theme && device !== accountTheme) {
        patch.theme = device;
      } else {
        next.theme = accountTheme;
        if (getThemePreference() !== accountTheme) setThemePreference(accountTheme);
      }
    }
    if (!qa.locale) {
      const device = await getStored('sc.locale');
      const account = asLocale(me.locale);
      if (device && device !== synced.locale && device !== account) {
        patch.locale = device;
      } else if (account) {
        next.locale = account;
        await setStored('sc.locale', account);
        if (i18n.language !== account) await i18n.changeLanguage(account);
      }
    }
    if (await patchSettings(patch)) Object.assign(next, patch);
    await setStored('sc.settingsSynced', JSON.stringify(next));
  });
}

/**
 * While signed in, a change of theme or language goes to the account. The values are read inside the queued task (BH-35): after
 * a sign-in's reconciliation, which the change watcher sees halfway, they equal what was agreed, and nothing is sent.
 */
export function pushChangedSettings(): Promise<void> {
  if (isViewAsTab()) return Promise.resolve();
  return enqueueSettings(async () => {
    const synced = await readSynced();
    const patch: SettingsPatch = {};
    const theme = getThemePreference();
    const locale = asLocale(i18n.language);
    if (!fixedThemePreference() && theme !== synced.theme) patch.theme = theme;
    if (!qa.locale && locale && locale !== synced.locale) patch.locale = locale;
    if (Object.keys(patch).length === 0) return;
    if (await patchSettings(patch)) await setStored('sc.settingsSynced', JSON.stringify({ ...synced, ...patch }));
  });
}

/** Applies the language chosen on this device before the splash hides. Never rejects. */
export async function hydrateLocale(): Promise<void> {
  if (qa.locale) return;
  const stored = await getStored('sc.locale');
  if (stored && stored !== i18n.language) await i18n.changeLanguage(stored);
}

/** Pushes changes of theme and language to the account. Skips the first run, which only tells what is current. */
export function useSettingsSync(): void {
  const signedIn = useSessionStore((state) => state.status === 'member');
  const theme = useThemePreference();
  const seen = useRef(false);
  const locale = useTranslation().i18n.language;
  useEffect(() => {
    if (!signedIn) {
      seen.current = false;
      return;
    }
    if (!seen.current) {
      seen.current = true;
      return;
    }
    void pushChangedSettings();
  }, [locale, signedIn, theme]);
}

// -- Queries

/** The signed-in member. Runs while there is a session, and keeps the session store current. */
export function useMe() {
  const signedIn = useSessionStore((state) => state.status === 'member');
  return useQuery({
    queryKey: meKey,
    queryFn: ({ signal }) => fetchMe(signal),
    enabled: signedIn,
    retry: (failures, error) => !(error instanceof ApiError && error.status > 0 && error.status < 500) && failures < 2,
  });
}

export const usernameCheckKey = (username: string) => ['auth', 'username-check', username] as const;

/**
 * Availability of a name that passes the local rules. The key changes with the input, and TanStack Query aborts a request
 * through `signal` once nobody waits for it, so a late answer can never speak for a newer input.
 */
export function useUsernameCheck(username: string | null) {
  return useQuery({
    queryKey: usernameCheckKey(username ?? ''),
    queryFn: async ({ signal }) => {
      const { data } = await apiData(api.GET('/usernames/check', { params: { query: { username: username ?? '' } }, signal }));
      return data;
    },
    enabled: username !== null,
    retry: false,
    staleTime: 30 * 1000,
    gcTime: 60 * 1000,
    meta: { persist: false },
  });
}

// -- Mutations

/** ADR-124: the cookie right before the call. A token gone stale in between gets one more try. */
async function fetchCsrfCookie(): Promise<void> {
  try {
    await globalThis.fetch(`${apiOrigin()}/sanctum/csrf-cookie`, { credentials: 'include' });
  } catch {
    throw networkError();
  }
}

export async function withFreshCsrf<T>(call: () => Promise<T>): Promise<T> {
  if (!isWeb) return call();
  await fetchCsrfCookie();
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof ApiError) || error.kind !== 'session_expired') throw error;
    await fetchCsrfCookie();
    return call();
  }
}

export type LoginInput = { email: string; password: string };

export type TwoFactorChallenge = components['schemas']['TwoFactorChallengeResource'];

/**
 * What a sign-in or an e-mail verify answers (M2.5): the session, or with two-factor on a challenge for AUTH-11. A challenge
 * adopts nothing; the screen holds it in memory (features/auth/twoFactorChallenge.ts) and opens AUTH-11, never persists it.
 */
export type SignInAnswer = { kind: 'session'; session: AuthSession } | { kind: 'two_factor'; challenge: string; expiresIn: number };

export function readSignIn(data: AuthSession | TwoFactorChallenge): SignInAnswer {
  if ('two_factor_required' in data) return { kind: 'two_factor', challenge: data.challenge, expiresIn: data.expires_in };
  return { kind: 'session', session: data };
}

async function adoptAnswer(answer: SignInAnswer): Promise<void> {
  if (answer.kind === 'session') await adoptSession(answer.session);
}

export function useLogin() {
  return useMutation({
    mutationFn: async ({ email, password }: LoginInput) => {
      const device = await deviceFields();
      await revokePendingLogoutBeforeSignIn();
      const { data } = await withFreshCsrf(() => apiData(api.POST('/auth/login', { body: { email, password, ...device } })));
      return readSignIn(data);
    },
    onSuccess: adoptAnswer,
  });
}

/** `ref`: where the sign-up began (ADR-216, features/auth/signupRef.ts); null or missing sends none. */
export type RegisterInput = { email: string; password: string; marketingConsent: boolean; ref?: components['schemas']['SignupRef'] | null };

export function useRegister() {
  return useMutation({
    mutationFn: async ({ email, password, marketingConsent, ref }: RegisterInput) => {
      const locale = asLocale(i18n.language);
      const { data } = await apiData(
        api.POST('/auth/register', {
          body: {
            email,
            password,
            accepted_age_16: true,
            accepted_terms: true,
            accepted_privacy: true,
            marketing_consent: marketingConsent,
            ...(locale ? { locale } : {}),
            ...(ref ? { ref } : {}),
          },
        }),
      );
      return data;
    },
  });
}

export type VerifyInput = { email: string; code: string; password?: string };

export function useVerifyEmail() {
  return useMutation({
    mutationFn: async ({ email, code, password }: VerifyInput) => {
      const device = await deviceFields();
      await revokePendingLogoutBeforeSignIn();
      const { data } = await withFreshCsrf(() =>
        apiData(api.POST('/auth/email/verify', { body: { email, code, ...(password ? { password } : {}), ...device } })),
      );
      return readSignIn(data);
    },
    onSuccess: adoptAnswer,
  });
}

export type ChallengeInput = { challenge: string; code?: string; recoveryCode?: string };

/**
 * AUTH-11: `POST auth/two-factor/challenge` with the device fields of a sign-in. The answer is the normal session and is adopted
 * like one (ADR-185 a). The challenge is single use; the caller forgets it either way.
 */
export function useTwoFactorChallenge() {
  return useMutation({
    networkMode: 'always',
    gcTime: 0,
    mutationFn: async ({ challenge, code, recoveryCode }: ChallengeInput) => {
      const device = await deviceFields();
      await revokePendingLogoutBeforeSignIn();
      const body = { challenge, ...(code ? { code } : { recovery_code: recoveryCode ?? '' }), ...device };
      const { data } = await withFreshCsrf(() => apiData(api.POST('/auth/two-factor/challenge', { body })));
      return data;
    },
    onSuccess: adoptSession,
  });
}

export function useResendCode() {
  return useMutation({
    mutationFn: async (email: string) => (await apiData(api.POST('/auth/email/resend', { body: { email } }))).data,
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (email: string) => (await apiData(api.POST('/auth/password/forgot', { body: { email } }))).data,
  });
}

export type ResetInput = { email: string; code: string; password: string };

export function useResetPassword() {
  return useMutation({
    mutationFn: async (body: ResetInput) => (await apiData(api.POST('/auth/password/reset', { body }))).data,
  });
}

export function useChooseUsername() {
  return useMutation({
    mutationFn: async (username: string) => (await apiData(api.PUT('/me/username', { body: { username }, signal: sessionSignal() }))).data,
    onSuccess: refreshMe,
  });
}

export type ProfileInput = { display_name?: string | null; city?: string | null };

/** An empty patch finishes the profile step: that is what "Überspringen" sends. */
export function useUpdateProfile() {
  return useMutation({
    mutationFn: async (body: ProfileInput) => (await apiData(api.PATCH('/me/profile', { body, signal: sessionSignal() }))).data,
    onSuccess: refreshMe,
  });
}

export function useUploadAvatar() {
  return useMutation({
    mutationFn: async ({ form, idempotencyKey }: { form: FormData; idempotencyKey: string }) => {
      const { data } = await apiData(
        api.POST('/me/avatar', {
          // The generated type describes the multipart field as a string; the serializer below hands the FormData on as is.
          body: form as unknown as components['schemas']['UploadProfileImageRequest'],
          bodySerializer: (body) => body as unknown as FormData,
          signal: sessionSignal(),
          ...withIdempotency(idempotencyKey),
        }),
      );
      return data;
    },
    onSuccess: refreshMe,
  });
}

export function useSignOut() {
  return useMutation({ mutationFn: signOut });
}
