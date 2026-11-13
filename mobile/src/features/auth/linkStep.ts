/**
 * AUTH-16: the `link_required` answer of an Apple or Google sign-in whose address belongs to an existing account. The code went to
 * that address; AUTH-16 confirms it. Memory only, like the two-factor challenge: a reload asks to sign in with the provider again.
 */
import type { LinkRequired } from '@/api/queries/passwordless';
import { useSessionStore } from '@/state/session';

type Held = LinkRequired & { heldAt: number };

/** The code lives 10 minutes on the server. */
export const LINK_TTL_MS = 10 * 60 * 1000;

let held: Held | null = null;

export function holdLinkStep(link: LinkRequired, now: number = Date.now()): void {
  held = { ...link, heldAt: now };
}

export function heldLinkStep(now: number = Date.now()): Held | null {
  if (!held || now - held.heldAt > LINK_TTL_MS) return null;
  return held;
}

export function forgetLinkStep(): void {
  held = null;
}

useSessionStore.subscribe((state, previous) => {
  if (state.status !== previous.status) forgetLinkStep();
});
