import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useMarkBadgesSeen, useUnseenBadges, type Badge } from '@/api/queries/badges';
import { useSessionStore } from '@/state/session';
import { toast } from '@/ui/toast';

import '../qaGift';

/** Set once the toast has shown in this app run: never a second one, from any screen (contract §2, §8). */
let shownThisRun = false;

/** Tests only. */
export function resetBadgeUnlockForTests(): void {
  shownThisRun = false;
}

/** The toast's line: the badge by name, or "3 neue Abzeichen" for more than one (they stack into one toast). */
export function unlockMessage(t: (key: string, options?: Record<string, unknown>) => string, badges: readonly Badge[]): string {
  const first = badges[0];
  return badges.length === 1 && first?.name ? t('gift.badges.unlockOne', { name: first.name }) : t('gift.badges.unlockMany', { count: badges.length });
}

/**
 * The unlock (contract §2, §8): once per app start, `GET me/badges?unseen=1`; when there is anything, one toast with the success
 * haptic (none on the web, ToastHost) and "Ansehen", then `POST me/badges/seen`, so it never comes again. Never a modal, never a
 * second toast in the same run: more than one badge stacks into "3 neue Abzeichen". Mounted on Start and Profil; whichever comes
 * first shows it.
 */
export function useBadgeUnlockToast(routeId: string): void {
  const { t } = useTranslation('profile');
  const router = useRouter();
  const member = useSessionStore((state) => state.status === 'member');
  const query = useUnseenBadges(member && !shownThisRun);
  const seen = useMarkBadgesSeen();
  const { mutate } = seen;
  const badges = query.data;

  useEffect(() => {
    if (shownThisRun || !badges || badges.length === 0) return;
    shownThisRun = true;
    toast(unlockMessage(t, badges), {
      haptic: 'success',
      action: { label: t('gift.badges.unlockAction'), onPress: () => router.push('/profile/badges') },
      testID: `${routeId}.badgeToast`,
    });
    mutate(badges.map((badge) => badge.key));
  }, [badges, mutate, routeId, router, t]);
}
