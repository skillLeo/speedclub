/** The two-factor state Me reports (M2.5). */
import type { Me } from '@/api/queries/auth';

/** True or false once Me is loaded, null before: the screens say nothing rather than guess. */
export function twoFactorEnabledOf(me: Me | undefined): boolean | null {
  return me ? me.two_factor_enabled : null;
}

/**
 * Client round 6 (L1): false for a passwordless account (e-mail code, Apple, Google). Those members prove it is them through recent
 * authentication (09 §8.1) and send `password: ''`; the M2.5 forms then show no password field. Unknown counts as a password, as
 * before, so nobody loses the field because Me is still loading.
 */
export function hasPassword(me: Me | undefined | null): boolean {
  return me?.password_set !== false;
}
