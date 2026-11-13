/**
 * SEC-P1-05: the address one auth screen hands to the next. Memory only, never a route parameter: on the member web a parameter
 * is the URL's query, which a reload sends to the access log and the history keeps. A reloaded page or a killed app has lost it,
 * and the next screen asks for the address again (AUTH-05 sends a guest without one back to AUTH-04).
 *
 * The slot names the route it is for, so a later visit to another auth screen never finds an address meant for this one. A
 * change of who is signed in drops it: on a shared computer the next person must not find the last address filled in.
 * Incoming links still work: native deep links and the account-exists mail carry the address as a parameter, which
 * `useHandedEmail` reads, and on web takes out of the address bar at once.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { isWeb } from '@/lib/platform';
import { useSessionStore } from '@/state/session';

import { firstParam } from './forms';

export type HandoffRoute = '/sign-in' | '/sign-up' | '/verify-email' | '/forgot-password' | '/reset-password' | '/auth/email';

let slot: { route: HandoffRoute; email: string } | null = null;

/** Hands `email` to the screen at `route`. Call it right before the navigation; an empty address clears the slot. */
export function handEmailTo(route: HandoffRoute, email: string | null | undefined): void {
  const trimmed = email?.trim() ?? '';
  slot = trimmed ? { route, email: trimmed } : null;
}

/** The address handed to `route`, if any. It stays until the next hand-off or a change of member, so a remount finds it. */
export function handedEmailFor(route: HandoffRoute): string | undefined {
  return slot?.route === route ? slot.email : undefined;
}

export function forgetHandedEmail(): void {
  slot = null;
}

useSessionStore.subscribe((state, previous) => {
  if (state.status !== previous.status || state.member?.id !== previous.member?.id) forgetHandedEmail();
});

/** Web routes whose mail links carry the address in the fragment (the account-exists mail, ADR-138). Reset has its own. */
const FRAGMENT_ROUTES: readonly HandoffRoute[] = ['/sign-in', '/forgot-password'];
const MAX_EMAIL_LENGTH = 254;

/** `#email=...` of the address bar, for the routes above; web only. One value, an address shape, no control characters. */
export function emailFromFragment(route: HandoffRoute, hash: string): string | undefined {
  if (!FRAGMENT_ROUTES.includes(route)) return undefined;
  const values = new URLSearchParams(hash.replace(/^#/, ''));
  const all = values.getAll('email');
  const email = all.length === 1 ? all[0]?.trim() : undefined;
  if (!email || email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+$/u.test(email) || /[\p{Cc}\p{Cf}]/u.test(email)) return undefined;
  return email;
}

function currentHash(): string {
  return isWeb && typeof window !== 'undefined' ? (window.location?.hash ?? '') : '';
}

/**
 * Takes the fragment out of the address bar at once, before the router replaces the screen. Left to the router, the bar kept
 * `#email=` until its own history write, and a screen that mounted before that (a render forced in the same commit, as the
 * sticky bar's first height report did) read the fragment again and replaced itself again: "Maximum update depth exceeded"
 * on AUTH-03 and AUTH-06 (M2.8 verify run 3).
 */
export function dropFragment(): void {
  if (!isWeb || typeof window === 'undefined' || !window.location?.hash) return;
  const { pathname, search } = window.location;
  window.history?.replaceState?.(window.history.state, '', `${pathname}${search}`);
}

/**
 * The address for the screen at `route`: an incoming link's parameter first (native deep links), then on web the fragment of
 * a mail link, then the hand-off. Read once per mount. On web a parameter or fragment leaves the address bar right away: the
 * fragment through the router, which would otherwise write it back on its next state change, with the address handed over so
 * the screen that replaces this one still has it.
 */
export function useHandedEmail(route: HandoffRoute, param: string | string[] | undefined): string | undefined {
  const router = useRouter();
  const fromLink = firstParam(param);
  const [fromFragment] = useState(() => (fromLink === undefined ? emailFromFragment(route, currentHash()) : undefined));
  const [email] = useState(() => fromLink ?? fromFragment ?? handedEmailFor(route));
  useEffect(() => {
    if (!isWeb) return;
    if (fromLink !== undefined) router.setParams({ email: undefined });
    else if (fromFragment !== undefined) {
      handEmailTo(route, fromFragment);
      dropFragment();
      router.replace(route);
    }
  }, [fromFragment, fromLink, route, router]);
  return email;
}
