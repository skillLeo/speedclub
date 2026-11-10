import { useTranslation } from 'react-i18next';

import { useMe } from '@/api/queries/auth';
import { useQaState } from '@/lib/qa';
import { useRequireAuth } from '@/state/session';
import { EmptyState } from '@/ui';

/** A guest on SAFE-01 or SET-16: the sign-in, and back here afterwards. */
export function SafetySignIn({ routeId, returnTo }: { routeId: string; returnTo: string }) {
  const { t } = useTranslation('safety');
  const requireAuth = useRequireAuth();
  return (
    <EmptyState
      icon="lock-simple"
      title={t('guest.title')}
      body={t('guest.body')}
      action={{ label: t('guest.signIn'), onPress: () => requireAuth(undefined, { returnTo }) }}
      testID={`${routeId}.guest`}
    />
  );
}

/**
 * Whether the account is restricted (or suspended). A restriction never takes away the safety tools: reports, decisions and the
 * appeal keep working (Art. 20 DSA), and the screens say exactly that.
 */
export function useAccountRestricted(): boolean {
  const qaState = useQaState();
  const restrictions = useMe().data?.restrictions;
  if (qaState === 'restricted') return true;
  return Boolean(restrictions && (restrictions.suspended || restrictions.messaging.restricted || restrictions.publishing.restricted));
}

export type RestrictionKind = 'suspended' | 'publishing' | 'messaging' | 'both';

/**
 * DQ-564: which restriction applies to the account now, so a notice can name it (a reversal lifted one measure, another may still
 * stand), or null when none does. `qaState=restricted` reads as a publishing restriction.
 */
export function useAccountRestrictionKind(): RestrictionKind | null {
  const qaState = useQaState();
  const restrictions = useMe().data?.restrictions;
  if (qaState === 'restricted') return 'publishing';
  if (!restrictions) return null;
  if (restrictions.suspended) return 'suspended';
  const publishing = restrictions.publishing.restricted;
  const messaging = restrictions.messaging.restricted;
  if (publishing && messaging) return 'both';
  if (publishing) return 'publishing';
  if (messaging) return 'messaging';
  return null;
}
