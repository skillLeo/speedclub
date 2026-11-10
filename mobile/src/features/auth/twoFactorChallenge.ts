/**
 * AUTH-11: the challenge a sign-in or an e-mail verify answers with when two-factor is on (m2.5-contract §1). Single use and
 * valid 5 minutes on the server; here it lives in memory only, never in a route parameter or storage. A reloaded page or a
 * killed app has lost it, and AUTH-11 sends the member back to sign in.
 */
import { useSessionStore } from '@/state/session';

/** The server's lifetime of a challenge. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type Held = { challenge: string; expiresAt: number };

let held: Held | null = null;

/** `expiresIn`: the answer's `expires_in` in seconds; never longer than the server's lifetime. */
export function holdTwoFactorChallenge(challenge: string, expiresIn?: number, now: number = Date.now()): void {
  const ttl = expiresIn === undefined ? CHALLENGE_TTL_MS : Math.min(CHALLENGE_TTL_MS, Math.max(0, expiresIn) * 1000);
  held = { challenge, expiresAt: now + ttl };
}

/** The challenge while it can still work, else null. */
export function heldTwoFactorChallenge(now: number = Date.now()): string | null {
  if (!held || held.expiresAt <= now) return null;
  return held.challenge;
}

export function forgetTwoFactorChallenge(): void {
  held = null;
}

// Signed in, or someone else signed in: the challenge has done its work or belongs to nobody here.
useSessionStore.subscribe((state, previous) => {
  if (state.status !== previous.status) forgetTwoFactorChallenge();
});
