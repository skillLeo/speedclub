import { useTranslation } from 'react-i18next';

import { useMe } from '@/api/queries/auth';
import { FORUM_LIMITS } from '@/api/queries/forum';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { now } from '@/lib/clock';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useSessionStore } from '@/state/session';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ForumAccess = {
  status: 'loading' | 'guest' | 'member';
  /**
   * Why writing is refused now (m5.8-contract §2 "Restrictions"): the forum ban (`restrictions.forum`), a publishing restriction, a
   * suspension, or a read-only view as a member. Reading, reporting and deleting one's own content stay open.
   */
  restriction: string | null;
  /** Which decision stands behind the restriction, for "Begründung ansehen" (SAFE-01). */
  restrictionKind: 'forum' | 'publishing' | null;
  /** New posts go into pre-moderation (account younger than 3 days or no verified e-mail): the composer says so first. */
  premoderated: boolean;
};

/** Pure, for the tests: an account younger than the pre-moderation window, or one without a verified e-mail. */
export function isPremoderated(me: { email_verified: boolean; member_since: string | null } | undefined, at: Date): boolean {
  if (!me) return false;
  if (!me.email_verified) return true;
  const since = me.member_since ? Date.parse(me.member_since) : Number.NaN;
  if (Number.isNaN(since)) return false;
  return at.getTime() - since < FORUM_LIMITS.premoderationDays * DAY_MS;
}

export function useForumAccess(): ForumAccess {
  const { t } = useTranslation('forum');
  const format = useFormat();
  const qaState = useQaState();
  const status = useSessionStore((state) => state.status);
  const me = useMe().data;
  const viewAs = useViewAsReadOnly();
  const viewAsT = useTranslation('auth').t;
  const premoderated = status === 'member' && isPremoderated(me, now());
  if (qaState === 'restricted') return { status: 'member', restriction: t('restricted.body'), restrictionKind: 'forum', premoderated };
  if (viewAs) return { status, restriction: viewAsT('viewAs.readOnly'), restrictionKind: null, premoderated: false };
  const restrictions = me?.restrictions;
  if (!restrictions) return { status, restriction: null, restrictionKind: null, premoderated };
  if (restrictions.suspended) return { status, restriction: t('restricted.suspended'), restrictionKind: null, premoderated };
  const forum = restrictions.forum;
  const publishing = restrictions.publishing;
  const standing = forum.restricted ? { kind: 'forum' as const, until: forum.until } : publishing.restricted ? { kind: 'publishing' as const, until: publishing.until } : null;
  if (!standing) return { status, restriction: null, restrictionKind: null, premoderated };
  const restriction = standing.until ? t('restricted.until', { date: format.dateTime(new Date(standing.until)) }) : t('restricted.body');
  return { status, restriction, restrictionKind: standing.kind, premoderated };
}
