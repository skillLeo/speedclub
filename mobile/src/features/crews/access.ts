import { useTranslation } from 'react-i18next';

import { useMe } from '@/api/queries/auth';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useSessionStore } from '@/state/session';

export type CrewAccess = {
  status: 'loading' | 'guest' | 'member';
  /**
   * Why founding, editing, joining, requesting, inviting and approving are refused now (contract C9): a publishing restriction, a
   * suspension, or a read-only view as a member. Leaving, declining, withdrawing, removing and deleting stay open.
   */
  restriction: string | null;
  /** C9: create/join/request/invite/accept need a verified e-mail (403 email_not_verified). */
  unverified: boolean;
};

export function useCrewAccess(): CrewAccess {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const viewAsT = useTranslation('auth').t;
  const format = useFormat();
  const qaState = useQaState();
  const status = useSessionStore((state) => state.status);
  const me = useMe().data;
  const viewAs = useViewAsReadOnly();
  if (qaState === 'restricted') return { status: 'member', restriction: t('restricted.body'), unverified: false };
  if (viewAs) return { status, restriction: viewAsT('viewAs.readOnly'), unverified: false };
  const unverified = status === 'member' && me !== undefined && !me.email_verified;
  const restrictions = me?.restrictions;
  if (!restrictions) return { status, restriction: null, unverified };
  if (restrictions.suspended) return { status, restriction: t('restricted.suspended'), unverified };
  const publishing = restrictions.publishing;
  if (!publishing.restricted) return { status, restriction: null, unverified };
  const restriction = publishing.until ? t('restricted.until', { date: format.dateTime(new Date(publishing.until)) }) : t('restricted.body');
  return { status, restriction, unverified };
}
