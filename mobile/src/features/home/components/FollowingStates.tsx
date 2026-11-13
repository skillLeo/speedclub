import { usePathname, useRouter } from 'expo-router';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { FeedSuggestion, FeedVehicle } from '@/api/queries/home';
import { useVehicleFollow } from '@/api/queries/social2';
import { useMyVehicles } from '@/api/queries/profile';
import { FollowButton } from '@/features/profile/components/FollowButton';
import { photoFields, profileVehicles, variantUrl } from '@/features/profile/media';
import { ownerName } from '@/features/vehicle/model';
import { haptics } from '@/lib/haptics';
import { clearAuthIntent, useRequireAuth } from '@/state/session';
import { createStyles, size, space, useBreakpoint } from '@/theme';
import { Button, EmptyState, MediaCard, MemberRow, SectionHeader, Text, toast } from '@/ui';

import { carLabel } from '../model';
import { useFollowState, useOpenMember, vehiclePath } from '../navigation';
import { railSpec } from './NewInGarageRail';
import { SampleLead } from './SampleLead';

/** 09 §7.3 Folge ich empty: six builds to follow. */
export const BUILD_SUGGESTIONS = 6;
const GRID_GAP = space[12];

const useStyles = createStyles((t) => ({
  root: { gap: t.space[32], paddingTop: t.space[8] },
  intro: { gap: t.space[8] },
  header: { paddingBottom: t.space[4] },
  group: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  grid: { columnGap: GRID_GAP, flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[24] },
  // DQ-1081 c: a row's tiles stretch to its tallest (a name on one or two lines), and Folgen sits at the bottom of each, so the
  // buttons of a row share one line.
  tile: { gap: t.space[8], justifyContent: 'space-between' },
}));

/**
 * The builds the empty Folge ich suggests: the featured and newest public builds Home already loaded, never the reader's own, at
 * most six. Lane B gap: a `build_suggestions` list (builds like the reader's) on the empty first page of `feed?tab=following`.
 */
export function buildSuggestions(sources: readonly (readonly FeedVehicle[] | undefined)[], me: string | null): FeedVehicle[] {
  const seen = new Set<string>();
  const out: FeedVehicle[] = [];
  for (const vehicle of sources.flatMap((list) => list ?? [])) {
    if (seen.has(vehicle.id) || (me !== null && vehicle.owner?.username === me)) continue;
    seen.add(vehicle.id);
    out.push(vehicle);
    if (out.length === BUILD_SUGGESTIONS) break;
  }
  return out;
}

/**
 * One suggested build: the `rail` card (3:4, radius 12, name and spec) and Folgen under it. A build follow does not follow its owner
 * (09 §8.6). The reader's Folge ich is empty, so a suggestion starts unfollowed; the tap is optimistic and reverts with a toast.
 */
const BuildSuggestion = memo(function BuildSuggestion({ vehicle, width, testID }: { vehicle: FeedVehicle; width: number; testID: string }) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const requireAuth = useRequireAuth();
  const follow = useVehicleFollow(vehicle.id);
  const [following, setFollowing] = useState(false);
  const toggle = () =>
    requireAuth(
      () => {
        const next = !following;
        haptics.light();
        setFollowing(next);
        follow.mutate(next, {
          onError: () => {
            setFollowing(!next);
            toast(t('following.build.failed'), { haptic: 'warning', testID: `${testID}.toast` });
          },
        });
      },
      { returnTo: pathname },
    );
  return (
    <View style={[styles.tile, { width }]} testID={testID}>
      <MediaCard
        variant="rail"
        title={vehicle.full_title}
        photo={photoFields(vehicle.cover, width)}
        spec={railSpec(vehicle)}
        sample={{ is_sample: vehicle.is_sample, is_editorial: vehicle.owner?.is_editorial ?? false }}
        onPress={() => router.push(vehiclePath(vehicle.slug))}
        testID={`${testID}.card`}
      />
      {/* DQ-1081 b: six suggestions are six equal choices, so none of them is the screen's one filled CTA (skill rule 6): secondary,
          with its state as aria-pressed and the check. The name follows what it shows (WCAG 2.5.3). */}
      <Button
        label={following ? t('following.build.following') : t('following.build.follow')}
        icon={following ? 'check' : undefined}
        variant="secondary"
        size="m"
        fullWidth
        pressed={following}
        disabled={vehicle.is_sample}
        onPress={toggle}
        testID={`${testID}.follow`}
      />
    </View>
  );
});

/** One suggestion: the §8 member row with Folgen, the car line as its meta. */
const Suggestion = memo(function Suggestion({
  member,
  following,
  divider,
  onOpen,
  testID,
}: {
  member: FeedSuggestion;
  following: boolean;
  divider: boolean;
  onOpen: (username: string) => void;
  testID: string;
}) {
  const name = ownerName(member);
  const meta = [`@${member.username}`, carLabel(member)].filter(Boolean).join(' · ');
  return (
    <MemberRow
      name={name}
      meta={meta}
      avatarUri={variantUrl(member.avatar, size.avatar.md)}
      avatarBlurhash={member.avatar?.blurhash}
      sample={member}
      onPress={() => onOpen(member.username)}
      trailing={<FollowButton username={member.username} following={following} name={name} variant="secondary" testID={`${testID}.follow`} />}
      divider={divider}
      inset={space[16]}
      testID={testID}
    />
  );
});

/**
 * Folge ich without anything to show (02 §3.8): members with a car like the viewer's, else active members, each with Folgen. Without
 * suggestions it leads to Entdecken. A follow fills the stream from the next refresh on.
 */
export function FollowingEmpty({
  suggestions,
  builds = [],
  routeId,
}: {
  suggestions: readonly FeedSuggestion[];
  /** DQ-1026: the six builds to follow (`buildSuggestions`). */
  builds?: readonly FeedVehicle[];
  routeId: string;
}) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const router = useRouter();
  const openMember = useOpenMember();
  const followState = useFollowState();
  const { kind } = useBreakpoint();
  const [gridWidth, setGridWidth] = useState(0);
  // DQ-304: the server suggests builds like the reader's, else active members. Without a car of your own they can only be active
  // members, and the header says so; with one it stays "Vorschläge für dich", true for both.
  const garage = useMyVehicles();
  const withoutCar = garage.data !== undefined && profileVehicles(garage.data).length === 0;
  // 09 §7.3 + §5 rail: 2 columns on a phone, 3 from the tablet on.
  const columns = kind === 'phone' ? 2 : 3;
  const tile = gridWidth > 0 ? (gridWidth - GRID_GAP * (columns - 1)) / columns : 0;
  if (builds.length === 0 && suggestions.length === 0) {
    // Nothing to suggest: the sample of what lands here, and the way to builds (09 §5 EmptyState, DQ-1033).
    return (
      <EmptyState
        preview={<SampleLead routeId={`${routeId}.following`} />}
        title={t('following.empty.title')}
        body={t('following.empty.body')}
        action={{ label: t('following.empty.discover'), variant: 'secondary', size: 'm', onPress: () => router.navigate('/discover') }}
        testID={`${routeId}.following.empty`}
      />
    );
  }
  return (
    <View style={styles.root} testID={`${routeId}.following.empty`}>
      {/* DQ-1026 (09 §7.3, App. B): left-aligned title.2 and the copy bank's line, then the builds; no glyph. */}
      <View style={styles.intro}>
        <Text variant="title2" role="heading" {...({ 'aria-level': 2 } as object)} testID={`${routeId}.following.empty.title`}>
          {t('following.empty.title')}
        </Text>
        <Text variant="body" color="text.secondary" testID={`${routeId}.following.empty.body`}>
          {t('following.empty.body')}
        </Text>
      </View>
      {builds.length > 0 ? (
        <View style={styles.grid} onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)} testID={`${routeId}.buildSuggestions`}>
          {tile > 0
            ? builds.map((vehicle) => (
                <BuildSuggestion key={vehicle.id} vehicle={vehicle} width={tile} testID={`${routeId}.buildSuggestion.${vehicle.id}`} />
              ))
            : null}
        </View>
      ) : null}
      {suggestions.length > 0 ? (
      <View testID={`${routeId}.suggestions`}>
        <SectionHeader
          title={withoutCar ? t('following.suggestionsActive') : t('following.suggestions')}
          style={styles.header}
          testID={`${routeId}.suggestions.header`}
        />
        <View style={styles.group}>
          {suggestions.map((member, index) => (
            <Suggestion
              key={member.username}
              member={member}
              following={followState(member.username, member.is_following)}
              divider={index < suggestions.length - 1}
              onOpen={openMember}
              testID={`${routeId}.suggestion.${member.username}`}
            />
          ))}
        </View>
      </View>
      ) : null}
    </View>
  );
}

/** Folge ich for a guest: what it is, and the way to an account. Never someone else's stream. */
export function FollowingGuest({ routeId }: { routeId: string }) {
  const { t } = useTranslation('home');
  const router = useRouter();
  return (
    <EmptyState
      preview={<SampleLead routeId={`${routeId}.following.guest`} />}
      title={t('following.guest.title')}
      body={t('following.guest.body')}
      action={{
        label: t('following.guest.signIn'),
        onPress: () => {
          // A direct way in: nothing the guest tapped earlier belongs to it.
          clearAuthIntent();
          router.push({ pathname: '/auth/email', params: { returnTo: '/' } });
        },
      }}
      testID={`${routeId}.following.guest`}
    />
  );
}
