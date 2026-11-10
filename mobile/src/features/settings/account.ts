/** The two-factor state Me reports (M2.5). */
import type { Me } from '@/api/queries/auth';

/** True or false once Me is loaded, null before: the screens say nothing rather than guess. */
export function twoFactorEnabledOf(me: Me | undefined): boolean | null {
  return me ? me.two_factor_enabled : null;
}
