/**
 * Who is using the app, and the guest guard (Home, Discover, vehicle and member routes stay viewable as a guest).
 *
 * The session lifecycle lives in features/auth/sessionLifecycle.ts, which registers the restore at module scope. After a
 * sign-in and the open onboarding steps, features/auth/SessionHost calls completeAuthIntent(), which runs what the guest
 * wanted to do.
 */
import { useCallback } from 'react';
import { create } from 'zustand';

import type { components } from '@/api/schema';

export type SessionStatus = 'loading' | 'guest' | 'member';

export type OnboardingStep = components['schemas']['OnboardingStep'];

export type SessionMember = {
  id: string;
  /** Empty until AUTH-08. */
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** The first open step of F1 (02_PRODUCT_SPEC §4), where the app resumes. Null or missing: none is open. */
  nextStep?: OnboardingStep | null;
  /** The profile has a cover photo: its skeleton takes that shape before auth/me answers (DQ-122). */
  hasCover?: boolean;
};

/** Why a session ended without the member asking for it. Only a session that was really held raises this. */
export type SessionNotice = { kind: 'expired' } | { kind: 'restricted'; message: string };

export type AuthIntent = {
  /** An in-place effect that runs after sign-in, for example the follow the guest tapped. Never a navigation. */
  action?: () => void;
  /** Where to go after sign-in. All navigation belongs here: an action that navigates as well would do it twice. */
  returnTo?: string;
};

type SessionState = {
  status: SessionStatus;
  member: SessionMember | null;
  /** The auth-required sheet is showing. */
  promptOpen: boolean;
  /** Survives the sheet closing, so it can complete after the sign-in screens. */
  intent: AuthIntent | null;
  /** The session-expired dialog is showing. */
  notice: SessionNotice | null;
  /** The account needs a new password (ADR-137): the address for AUTH-07, until the app has gone there. */
  passwordChangeEmail: string | null;
  /**
   * BH-30: whose session ended under a form that stays on screen until the member chooses. Set only while such a form is
   * mounted (features/auth/heldForm.ts). Its values come back for this member, and for nobody else.
   */
  expiredFrom: string | null;
  /**
   * BH-28: the session turned out to belong to another member. From then until the screens of the previous member are gone, which
   * SessionHost sees to: the app goes home on a fresh stack, and selectMayReadOwned keeps those screens from asking.
   */
  memberChanged: boolean;
};

export const useSessionStore = create<SessionState>(() => ({
  status: 'loading',
  member: null,
  promptOpen: false,
  intent: null,
  notice: null,
  passwordChangeEmail: null,
  expiredFrom: null,
  memberChanged: false,
}));

/**
 * Whether a screen may read what one member owns through an id in its route: a vehicle, its mods, its sticker. Not while the session
 * is changing hands: the screens of the previous member are still mounted then, and their ids mean nothing to the new one (BH-28).
 */
export function selectMayReadOwned(state: SessionState): boolean {
  return state.status === 'member' && !state.memberChanged;
}

/**
 * SEC-S-01: the requests of the session that is current. Whatever ends a session (sign-out, expiry, a reset, a demanded password
 * change) aborts them, so an answer still under way can neither speak for that session afterwards nor, on web, bring back its
 * cookie over the next member's. A new controller takes over at once for whatever comes next.
 */
let sessionRequests = new AbortController();

export function sessionSignal(): AbortSignal {
  return sessionRequests.signal;
}

export function abortSessionRequests(): void {
  const ending = sessionRequests;
  sessionRequests = new AbortController();
  ending.abort();
}

export function setMember(member: SessionMember): void {
  useSessionStore.setState({ status: 'member', member });
}

export function setGuest(): void {
  useSessionStore.setState({ status: 'guest', member: null, expiredFrom: null });
}

export function setMemberChanged(memberChanged: boolean): void {
  useSessionStore.setState({ memberChanged });
}

export function setSessionNotice(notice: SessionNotice | null): void {
  useSessionStore.setState({ notice });
}

export function setPasswordChangeEmail(email: string | null): void {
  useSessionStore.setState({ passwordChangeEmail: email });
}

type SessionRestore = () => Promise<SessionMember | null>;

let restore: SessionRestore | null = null;

/** Without one every launch is a guest. features/auth/sessionLifecycle.ts registers it. */
export function registerSessionRestore(fn: SessionRestore): void {
  restore = fn;
}

/** Resolves once the start has decided between guest and member. */
export function whenSessionSettled(): Promise<void> {
  if (useSessionStore.getState().status !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useSessionStore.subscribe((state) => {
      if (state.status === 'loading') return;
      stop();
      resolve();
    });
  });
}

/** Never rejects: a failed restore means a guest, not a stuck splash. The root layout holds a ready gate on it. */
export async function restoreSession(): Promise<void> {
  try {
    const member = restore ? await restore() : null;
    if (member) setMember(member);
    else setGuest();
  } catch (error) {
    console.warn('Could not restore the session', error);
    setGuest();
  }
}

const isControlCharacter = (character: string) => {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
};

const hasUnsafePathPart = (path: string) =>
  path.includes('//') || path.includes('\\') || [...path].some(isControlCharacter);

/**
 * Whether a returnTo can be followed. It travels in the URL, where a crafted link sets it: only a path of this app
 * passes, with a single leading slash and no scheme or host. Browsers drop tabs and newlines from a URL and read a
 * backslash as a slash, so those would rebuild a `//host`. Checked again decoded, for the same parts in percent form.
 * Every reader of a returnTo goes through this, the sign-in screens of M1.5 included.
 */
export function isInternalPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('/')) return false;
  try {
    return !hasUnsafePathPart(value) && !hasUnsafePathPart(decodeURIComponent(value));
  } catch {
    return false;
  }
}

export function openAuthPrompt(intent: AuthIntent = {}): void {
  useSessionStore.setState({ promptOpen: true, intent });
}

/** The guest went on to sign in or sign up: the sheet closes, the intent stays. */
export function closeAuthPromptKeepingIntent(): void {
  useSessionStore.setState({ promptOpen: false });
}

/** The guest cancelled. */
export function dismissAuthPrompt(): void {
  useSessionStore.setState({ promptOpen: false, intent: null });
}

/** For a direct way into sign-in, such as the sidebar: nothing the guest tapped earlier belongs to that sign-in. */
export function clearAuthIntent(): void {
  useSessionStore.setState({ intent: null });
}

/**
 * The (auth) stack is gone. A guest gave up, so the intent goes with it. A member keeps it for completeAuthIntent(),
 * and an open sheet means the intent is a new one, tapped while the stack was still animating out.
 */
export function abandonAuthIntent(): void {
  const { status, promptOpen } = useSessionStore.getState();
  if (status !== 'member' && !promptOpen) clearAuthIntent();
}

/**
 * Keeps a path for after the sign-in or the open steps. An intent already there stays: it carries an action as well, or it is
 * the real destination and this only a step on the way. `replaceBare`: the member's own latest choice, as a tap on the verify
 * notice, replaces an intent that is only a path.
 */
export function keepReturnTo(path: string, options: { replaceBare?: boolean } = {}): void {
  if (!isInternalPath(path)) return;
  const { intent } = useSessionStore.getState();
  if (!intent || (options.replaceBare && !intent.action)) useSessionStore.setState({ intent: { returnTo: path } });
}

/**
 * Forgets an intent that is only a path. The member chose to go elsewhere, as by leaving AUTH-05 or opening it from a page that
 * has nothing to come back to: a path kept earlier would take them somewhere they no longer asked for (BH-29). An intent with an
 * action stays: the member still wants that done.
 */
export function dropBareReturnTo(): void {
  const { intent } = useSessionStore.getState();
  if (intent && !intent.action) useSessionStore.setState({ intent: null });
}

/** Runs the remembered action once and returns the path the guest wanted to reach, if it is one of ours. */
export function completeAuthIntent(): string | undefined {
  const { intent } = useSessionStore.getState();
  useSessionStore.setState({ intent: null, promptOpen: false });
  intent?.action?.();
  return isInternalPath(intent?.returnTo) ? intent.returnTo : undefined;
}

/**
 * Guards an action behind an account:
 *
 *   const requireAuth = useRequireAuth();
 *   <Button onPress={() => requireAuth(follow, { returnTo: pathname })} />
 *
 * A member runs the action at once. A guest gets the sheet, and the action runs after sign-in. While the session is
 * still being restored the tap is ignored, because a member must not be asked to sign in; the splash covers nearly all
 * of that time. Returns whether the action ran.
 */
export function useRequireAuth(): (action?: () => void, options?: { returnTo?: string }) => boolean {
  return useCallback((action, options) => {
    const { status } = useSessionStore.getState();
    if (status === 'loading') return false;
    if (status === 'member') {
      action?.();
      return true;
    }
    openAuthPrompt({ action, returnTo: options?.returnTo });
    return false;
  }, []);
}
