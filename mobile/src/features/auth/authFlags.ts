/**
 * The Auth 2.0 flags of app-config (09 §8.18, ADR-429 l). `auth.email_code` and `auth.password_login` are on by default: a first
 * launch without network (bundled config, no flags) must still offer both ways in. The provider and passkey flags stay off until
 * the server says otherwise.
 */
import { useAppConfig } from '@/api/queries/appConfig';
import { qaForcesFlag } from '@/lib/qa';

export function useAuthFlags(): { emailCode: boolean; passwordLogin: boolean } {
  const { config } = useAppConfig();
  const onUnlessOff = (key: string) => config.flags[key] !== false || qaForcesFlag(key);
  return { emailCode: onUnlessOff('auth.email_code'), passwordLogin: onUnlessOff('auth.password_login') };
}
