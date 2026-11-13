import '@/features/events/i18n';

import { useTranslation } from 'react-i18next';

import { useMe } from '@/api/queries/auth';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { useQaState } from '@/lib/qa';
import { useSessionStore } from '@/state/session';

/**
 * Why the member may not organise right now (09 §3.1, ADR-139): a publishing restriction or a suspension, or a read-only view-as.
 * Browsing and answering stay open. Null when nothing stands in the way (the server still decides eligibility: 403 with eligible_at).
 */
export function useOrganiserRestriction(): string | null {
  const { t } = useTranslation('events');
  const qaState = useQaState();
  const member = useSessionStore((state) => state.status === 'member');
  const viewAs = useViewAsReadOnly();
  const viewAsT = useTranslation('auth').t;
  const me = useMe();
  if (qaState === 'restricted') return t('list.restricted');
  if (viewAs) return viewAsT('viewAs.readOnly');
  if (!member) return null;
  const restrictions = me.data?.restrictions;
  if (restrictions?.suspended || restrictions?.publishing.restricted) return t('list.restricted');
  return null;
}
