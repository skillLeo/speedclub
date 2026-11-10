/**
 * AUTH-01 and what ends a session. Imported once by the root layout for its side effects: it has to register the restore
 * before the layout's module body starts it.
 */
import { onlineManager } from '@tanstack/react-query';

import { ApiError, memberIdOf, onApiGateEvent, reloadTab } from '@/api/client';
import { isViewAsTab, viewAsToken } from '@/api/clientViewAs';
import {
  adoptMe,
  clearLocalSession,
  fetchMe,
  fetchMeWithToken,
  forgetPreviousMember,
  hydrateLocale,
  isSigningOut,
  readCachedMember,
  reconcileSettings,
  retryPendingLogout,
  rotateTokenIfDue,
  storedToken,
  toSessionMember,
  type Me,
} from '@/api/queries/auth';
import { adoptViewAsMember, endViewAs, markViewAsFailed } from '@/features/viewAs/viewAsSession';
import { isWeb } from '@/lib/platform';
import { getStored } from '@/lib/storage';
import {
  abortSessionRequests,
  registerSessionRestore,
  setGuest,
  setPasswordChangeEmail,
  setSessionNotice,
  useSessionStore,
  whenSessionSettled,
  type SessionMember,
} from '@/state/session';

import { hasHeldForm } from './heldForm';

/** With a cached member the app can start without the answer, so it only waits this long for a fresher one. */
export const RESTORE_WAIT_CACHED_MS = 2500;
/** Without one the app has nothing to show but a guest. Keep this below READY_GATE_TIMEOUT_MS. */
export const RESTORE_WAIT_MS = 6000;
/** A token the start could not confirm is asked about again, once the device is online, after these waits. */
export const RESUME_DELAYS_MS = [5000, 30000, 120000] as const;

let welcomeSeen = true;

/** Native: whether the first launch has shown Welcome. Known by the time the session is restored. */
export function hasSeenWelcome(): boolean {
  return welcomeSeen;
}

class RestoreTimeout extends Error {}

function withinTime<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RestoreTimeout()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function endSession(): Promise<null> {
  await clearLocalSession();
  return null;
}

/**
 * The member the server confirmed. The rotation starts first: it holds back every request that follows, the settings
 * sync and the first screens included, until the new token is stored.
 */
function adoptConfirmed(me: Me, cached: SessionMember | null = null): SessionMember {
  void rotateTokenIfDue();
  // BH-28: this device thought it belonged to somebody else, whose data lies in the cache.
  if (cached && cached.id !== me.id) forgetPreviousMember();
  adoptMe(me);
  void reconcileSettings(me);
  return toSessionMember(me);
}

/** The server's word on a session, from the start or a later try. True when it ended the session here. */
function endedByServer(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.kind === 'unauthenticated') {
    setSessionNotice({ kind: 'expired' });
    return true;
  }
  if (error.kind === 'restricted') {
    setSessionNotice({ kind: 'restricted', message: error.message });
    return true;
  }
  if (error.code === 'password_change_required') {
    // On native the gate event below has the address by now. Web has no token and no member yet, so no event fired.
    if (useSessionStore.getState().passwordChangeEmail === null) setPasswordChangeEmail(error.email ?? '');
    return true;
  }
  return false;
}

function whenOnline(): Promise<void> {
  if (onlineManager.isOnline()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = onlineManager.subscribe((online) => {
      if (!online) return;
      stop();
      resolve();
    });
  });
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A token, no cached member, and auth/me did not answer in time: the app starts as a guest, and the token goes nowhere
 * meanwhile (api/client sends none for a guest). The member arrives when the server confirms the token, from the late
 * answer of the start or from a later try. A sign-in in between, or the token gone, ends the waiting.
 */
async function resumeLater(token: string, pending: Promise<Me>): Promise<void> {
  const stillWaiting = async () => useSessionStore.getState().status === 'guest' && (await storedToken()) === token;
  let attempt: Promise<Me> = pending;
  for (let tries = 0; ; tries += 1) {
    let me: Me | null = null;
    let failure: unknown = null;
    try {
      me = await attempt;
    } catch (error) {
      failure = error;
    }
    await whenSessionSettled();
    if (!(await stillWaiting())) return;
    if (me) {
      adoptConfirmed(me);
      return;
    }
    if (endedByServer(failure)) {
      await clearLocalSession();
      return;
    }
    const delay = RESUME_DELAYS_MS[tries];
    if (delay === undefined) return;
    await wait(delay);
    await whenOnline();
    if (!(await stillWaiting())) return;
    attempt = fetchMeWithToken(token);
  }
}

/**
 * View-as (m3.2-contract §3): the member of the token, read-only and in memory only. Nothing cached is shown and nothing is stored. A
 * token the server refuses ends the view on "Ansicht beendet"; no answer keeps the token for "Erneut versuchen".
 */
export async function restoreViewAs(): Promise<SessionMember | null> {
  if (!viewAsToken()) return null;
  await hydrateLocale();
  try {
    return adoptViewAsMember(await withinTime(fetchMe(), RESTORE_WAIT_MS));
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'unauthenticated') void endViewAs('expired');
    else if (error instanceof ApiError && error.status >= 400 && error.status < 500) void endViewAs('unavailable');
    else markViewAsFailed();
    return null;
  }
}

/** Never hangs and never lets a slow or missing network end a session: only the server's own word does that. */
export async function restoreMember(): Promise<SessionMember | null> {
  if (isViewAsTab()) return restoreViewAs();
  const [token, cached] = await Promise.all([storedToken(), readCachedMember(), hydrateLocale()]);
  welcomeSeen = (await getStored('sc.welcomeSeen')) !== null;
  if (!token && !cached) {
    void retryPendingLogout();
    return null;
  }

  const pending = fetchMe();
  try {
    return adoptConfirmed(await withinTime(pending, cached ? RESTORE_WAIT_CACHED_MS : RESTORE_WAIT_MS), cached);
  } catch (error) {
    if (endedByServer(error)) return endSession();
    if (!(error instanceof ApiError) && !(error instanceof RestoreTimeout)) {
      console.warn('Could not restore the session', error);
    }
    // Offline, too slow, or the server in trouble: the keychain still holds the session.
    if (cached) return cached;
    if (token) void resumeLater(token, pending);
    return null;
  }
}

/**
 * The server says the session is over. Only a session held right now counts; the dialog offers the way back. A form on screen
 * stays with its values until the member chooses (BH-30), so its data stays in memory until then. Everything else goes now.
 */
export async function expireSession(): Promise<void> {
  // A view-as token ran out (30 minutes) or was ended from the admin: the view ends, there is nobody to sign in again.
  if (isViewAsTab()) return endViewAs('expired');
  const { status, member } = useSessionStore.getState();
  if (isSigningOut() || status !== 'member') return;
  const hold = hasHeldForm() && member !== null;
  abortSessionRequests();
  useSessionStore.setState({ status: 'guest', member: null, expiredFrom: hold ? member.id : null, notice: { kind: 'expired' } });
  await clearLocalSession({ keepQueries: hold });
}

async function requirePasswordChange(email: string | undefined): Promise<void> {
  // ADR-227: the account must set a new password first, so it cannot be viewed; the token expires by itself.
  if (isViewAsTab()) return endViewAs('unavailable');
  if (isSigningOut()) return;
  abortSessionRequests();
  setPasswordChangeEmail(email ?? '');
  setGuest();
  await clearLocalSession();
}

/**
 * BH-28, web: every tab of a browser shares one cookie, and `sc.sessionMember` says whose it is. When another tab changed that,
 * this one reloads, so side-by-side windows heal without a focus event, and stop writing to the shared cache. A start that is
 * still deciding asks the server anyway.
 */
export function watchOtherTabs(): () => void {
  if (!isWeb || typeof window === 'undefined' || !window.addEventListener) return () => undefined;
  const onStorage = (event: StorageEvent) => {
    // A view-as tab has no part in this browser's session.
    if (isViewAsTab()) return;
    if (event.key !== null && event.key !== 'sc.sessionMember') return;
    const { status, member } = useSessionStore.getState();
    if (status === 'loading') return;
    if (memberIdOf(event.key === null ? null : event.newValue) !== (member?.id ?? null)) reloadTab();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

registerSessionRestore(restoreMember);
watchOtherTabs();

// BH-33: a logout the server did not hear goes out again as soon as it can.
onlineManager.subscribe((online) => {
  if (online) void retryPendingLogout();
});

onApiGateEvent((event, detail) => {
  if (event === 'unauthenticated') void expireSession();
  if (event === 'password_change_required') void requirePasswordChange(detail?.email);
});
