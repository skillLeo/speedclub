/**
 * The Auth 2.0 flags of app-config (09 §8.18, ADR-429 l). `auth.email_code` and `auth.password_login` are on by default: a first
 * launch without network (bundled config, no flags) must still offer both ways in. The provider and passkey flags stay off until
 * the server says otherwise. ADR-520: `auth.email_code` can be switched off on a host that cannot deliver mail yet; the password
 * is then always offered, so there is always a way in.
 */
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useAppConfig } from '@/api/queries/appConfig';
import { qaForcesFlag } from '@/lib/qa';

import { handEmailTo } from './emailHandoff';

export function useAuthFlags(): { emailCode: boolean; passwordLogin: boolean } {
  const { config } = useAppConfig();
  const onUnlessOff = (key: string) => config.flags[key] !== false || qaForcesFlag(key);
  const emailCode = onUnlessOff('auth.email_code');
  return { emailCode, passwordLogin: onUnlessOff('auth.password_login') || !emailCode };
}

/** Where "Mit E-Mail" leads: the code (AUTH-12) or, while the code is switched off (ADR-520), the password sign-in (AUTH-03). */
export function useEmailSignInPath(): '/auth/email' | '/sign-in' {
  return useAuthFlags().emailCode ? '/auth/email' : '/sign-in';
}

/**
 * ADR-520: while `auth.email_code` is switched off, the code screens (AUTH-12, AUTH-13, WEB-16) hand the address on to the password
 * sign-in AUTH-03 and leave; every "Anmelden" of the app that opens AUTH-12 follows the switch this way. True while leaving.
 */
export function useLeaveCodeSignInWhenOff(email?: string | null): boolean {
  const { emailCode } = useAuthFlags();
  const router = useRouter();
  useEffect(() => {
    if (emailCode) return;
    handEmailTo('/sign-in', email);
    router.replace('/sign-in');
    // Decided by the switch alone; the address is read once, when leaving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailCode]);
  return !emailCode;
}
