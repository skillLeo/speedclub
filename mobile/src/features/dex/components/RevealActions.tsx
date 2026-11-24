import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { REACTION_KEYS, SOCIAL_FLAGS, useReact, useVehicleFollow, type ReactionKey } from '@/api/queries/social2';
import { usePublicVehicle } from '@/api/queries/vehicles';
import { useBuildReactions } from '@/features/updates/components/Reactions';
import { useViewAsLock } from '@/features/viewAs/useViewAs';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { Button } from '@/ui/Button';
import { SkeletonBlock } from '@/ui/Skeleton';
import { toast } from '@/ui/toast';
import { hapticFor } from '@/ui/motion';
import { FollowButton, ReactionPicker } from '@/ui/motion/kit';

import { DEX_HOME_ROUTE } from '../navigation';

const ROUTE = 'DEX-03';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  // DQ-P5G-13 / DQ-P5G-60: everything flush left on the column's edge; the reaction and the way to the Dex share one row after
  // Folgen as two tertiary buttons of one weight. Both are flush (their padding reaches out of their slot), so the labels stand 32
  // apart and the two 44 targets meet without overlapping; a wrapped "Zum Dex" starts on the column edge too.
  row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[32], justifyContent: 'flex-start' },
}));

/** What a tap on the picker gives, kept for the session as on the update pages. */
const LAST_USED: { key: ReactionKey } = { key: 'strong' };

const isReactionKey = (value: string | null): value is ReactionKey =>
  value !== null && (REACTION_KEYS as readonly string[]).includes(value);

/** "Reaktion senden": the private SM9 picker (09 §8.5) on the car's latest build update. No counts, ever. */
function SpotReact({ updateId, mine }: { updateId: string; mine: ReactionKey | null }) {
  const { t } = useTranslation('dex');
  const { t: tVehicle } = useTranslation('vehicle');
  const reactions = useBuildReactions();
  const enabled = useFlag(SOCIAL_FLAGS.reactions);
  const lock = useViewAsLock();
  const react = useReact('build-updates', updateId);
  if (!enabled) return null;
  const select = (key: string | null) => {
    if (lock) {
      toast(lock, { testID: `${ROUTE}.reactToast` });
      return;
    }
    const next = isReactionKey(key) ? key : null;
    if (next) LAST_USED.key = next;
    react.mutate(next, {
      onError: () => toast(tVehicle('reactions.failed'), { haptic: 'warning', testID: `${ROUTE}.reactToast` }),
    });
  };
  // DQ-P5G-60: one tertiary button, glyph and label one target, flush with the column as "Zum Dex" beside it.
  return (
    <ReactionPicker
      reactions={reactions}
      selected={mine}
      lastUsed={LAST_USED.key}
      onSelect={select}
      label={t('reveal.react')}
      buttonLabel={t('reveal.react')}
      testID={`${ROUTE}.react`}
    />
  );
}

export type RevealActionsProps = {
  /** The car's slug; null for the sample, which has no page. */
  slug: string | null;
  vehicleId: string;
  /** Restricted account (or view-as): only "Zum Dex". */
  readOnly: boolean;
};

/**
 * DEX-03's actions (contract §8): Folgen (the build follow, the one filled CTA) · Reaktion senden (only when the car has a build
 * update) · Zum Dex. Folgen and the reaction read the car's page for the viewer's own state; until it is there the follow keeps
 * its place as a skeleton, and without it (flag off, page unavailable) they stay away.
 */
export function RevealActions({ slug, vehicleId, readOnly }: RevealActionsProps) {
  const { t } = useTranslation('dex');
  const { t: tVehicle } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const requireAuth = useRequireAuth();
  const member = useSessionStore((state) => state.status) === 'member';
  const followFlag = useFlag(SOCIAL_FLAGS.follow);
  const writeLock = useViewAsLock();
  const page = usePublicVehicle(readOnly ? undefined : (slug ?? undefined));
  const follow = useVehicleFollow(vehicleId);
  const vehicle = page.data;
  const following = vehicle?.social?.is_following === true;
  const latest = vehicle?.updates?.[0] ?? null;

  const toggleFollow = () => {
    if (!member) {
      requireAuth(undefined, { returnTo: pathname });
      return;
    }
    if (writeLock) {
      toast(writeLock, { testID: `${ROUTE}.followToast` });
      return;
    }
    hapticFor('follow');
    const next = !following;
    follow.mutate(next, {
      onSuccess: () => toast(next ? tVehicle('follow.followed') : tVehicle('follow.unfollowed'), { testID: `${ROUTE}.followToast` }),
      onError: (error) => toast(error.message || tVehicle('follow.failed'), { haptic: 'warning', testID: `${ROUTE}.followToast` }),
    });
  };

  let followControl = null;
  if (!readOnly && slug && followFlag) {
    if (typeof vehicle?.social?.is_following === 'boolean') {
      followControl = (
        <FollowButton
          following={following}
          onToggle={toggleFollow}
          followLabel={tVehicle('actions.followBuild')}
          followingLabel={tVehicle('actions.followingBuild')}
          itemKey={vehicleId}
          fullWidth
          testID={`${ROUTE}.follow`}
        />
      );
    } else if (page.isPending && page.fetchStatus !== 'idle') {
      followControl = <SkeletonBlock width="100%" height={size.button.l} corner="sm" testID={`${ROUTE}.follow.skeleton`} />;
    }
  }

  const react = !readOnly && latest ? <SpotReact updateId={latest.id} mine={latest.my_reaction ?? null} /> : null;
  const toDex = (secondary: boolean) => (
    <Button
      label={t('reveal.toDex')}
      variant={secondary ? 'secondary' : 'tertiary'}
      size={secondary ? 'l' : 'm'}
      role="link"
      fullWidth={secondary}
      flush={secondary ? undefined : 'start'}
      onPress={() => router.navigate(DEX_HOME_ROUTE)}
      testID={`${ROUTE}.toDex`}
    />
  );

  // Without Folgen (the sample, a read-only account, the flag off) "Zum Dex" is the one full-width secondary.
  if (!followControl) {
    return (
      <View style={styles.root}>
        {react ? <View style={styles.row}>{react}</View> : null}
        {toDex(true)}
      </View>
    );
  }
  return (
    <View style={styles.root}>
      {followControl}
      <View style={styles.row}>
        {react}
        {toDex(false)}
      </View>
    </View>
  );
}
