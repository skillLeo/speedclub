import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { readMemberProfileNow, useFollow } from '@/api/queries/social';
import { haptics } from '@/lib/haptics';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { Button, toast, type ButtonSize } from '@/ui';
import { useViewAsLock } from '@/features/viewAs/useViewAs';

export type FollowButtonProps = {
  username: string;
  /** The viewer follows this member, as the server last said or the optimistic change set. */
  following: boolean;
  /** FS-8 PROF-02: primary M. PROF-04 rows and VEH-01 owner row: secondary M (§8, DQ-264). */
  size?: ButtonSize;
  /** The variant while not following; "Folge ich" is always secondary, so the state reads at a glance. */
  variant?: 'primary' | 'secondary';
  /** For the accessible name: "Lukas Scholz folgen". */
  name: string;
  testID: string;
};

/**
 * Folgen / Folge ich (§10: label change plus the check glyph, light haptic, no confetti). Optimistic: the label turns at once
 * and turns back with a toast when the server refuses (rate limit, unverified address). A guest gets the auth-required sheet;
 * the follow then happens after sign-in, back on this page, unless the member signing in is this member or follows already.
 */
export function FollowButton({ username, following, size = 'm', variant = 'primary', name, testID }: FollowButtonProps) {
  const { t } = useTranslation('profile');
  const pathname = usePathname();
  const requireAuth = useRequireAuth();
  const client = useQueryClient();
  const follow = useFollow(username);
  const locked = useViewAsLock();

  const send = (next: boolean) =>
    follow.mutate(
      { username, follow: next },
      { onError: (error) => toast(error.message || t('follow.failed'), { haptic: 'warning', testID: `${testID}.toast` }) },
    );

  const press = () => {
    if (useSessionStore.getState().status === 'member') {
      haptics.light();
      send(!following);
      return;
    }
    // A guest wants to follow. After sign-in that is what happens, never a toggle of a state the guest could not see, and only
    // after a fresh read as the member: someone who turns out to be this member, or follows already, sends nothing.
    requireAuth(
      () => {
        void readMemberProfileNow(client, username)
          .then((profile) => {
            if (profile.is_self || profile.is_following) return;
            haptics.light();
            send(true);
          })
          .catch(() => undefined);
      },
      { returnTo: pathname },
    );
  };

  return (
    <Button
      label={following ? t('follow.following') : t('follow.follow')}
      icon={following ? 'check' : undefined}
      variant={following ? 'secondary' : variant}
      size={size}
      onPress={press}
      locked={locked}
      accessibilityLabel={following ? t('follow.followingName', { name }) : t('follow.followName', { name })}
      testID={testID}
    />
  );
}
