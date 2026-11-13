import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { avatarUrlOf, type Me } from '@/api/queries/auth';
import type { MediaData } from '@/api/queries/profile';
import { useFormat } from '@/lib/useFormat';
import { createStyles, layout, size, useBreakpoint, type BreakpointKind } from '@/theme';
import { Avatar, Button, IconButton, Photo, PhotoTopScrim, SampleBadges, sampleBadgeKinds, StatusPill, Text, type PhotoAspect } from '@/ui';
import { ratioOf } from '@/ui/Photo';

import { photoFields } from '../media';
import { ProfileStats } from './ProfileStats';

/** The profile column (DQ-114): 640 plus its gutters, on the start edge; the cover alone runs full width. */
export const PROFILE_COLUMN_MAX = layout.feedColumn + 2 * layout.gutter.desktop;
/** Desktop Garage tab: the content width of 09 §4.3 (1200) for the cards side by side; identity and the other tabs keep the feed column. */
export const PROFILE_WIDE_MAX = layout.contentMax + 2 * layout.gutter.desktop;
/** 09 §5 Avatar 88, overlapping the cover by half its height (09 §7.7). */
const AVATAR_OVERLAP = size.avatar.xl / 2;

/**
 * 09 §7.7: the cover is 16:9 edge to edge on phones and tablets. From 1280 the column sits beside the sidebar and a 16:9 cover
 * of 1,200 points would push the name below the fold, so the desktop cover is the 3:1 band of the public profile.
 */
export function profileCoverAspect(kind: BreakpointKind): PhotoAspect {
  return kind === 'desktop' ? '3:1' : '16:9';
}

/** Height of the cover at `width`: where the photo header turns solid, and the skeleton's block. */
export function profileCoverHeight(width: number, kind: BreakpointKind): number {
  return width / ratioOf(profileCoverAspect(kind));
}

const useStyles = createStyles((t) => ({
  identity: { maxWidth: PROFILE_COLUMN_MAX, width: '100%' },
  avatarOverlap: { alignSelf: 'flex-start', marginTop: -AVATAR_OVERLAP },
  // Without a cover the avatar starts under the bar, where the photo header's controls would be.
  avatarTop: { alignSelf: 'flex-start', marginTop: t.space[8] },
  // The canvas ring (09 §7.7) that separates the avatar from the photo it overlaps.
  ring: {
    backgroundColor: t.color.bg.canvas,
    borderRadius: t.radius.full,
    bottom: -t.space[2],
    left: -t.space[2],
    position: 'absolute',
    right: -t.space[2],
    top: -t.space[2],
  },
  names: { gap: t.space[2], marginTop: t.space[12] },
  handle: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  bio: { marginTop: t.space[12] },
  stats: { marginTop: t.space[12] },
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginTop: t.space[16] },
  // DQ-140: share and QR wrap as one group when "Profil bearbeiten" leaves them no room, never one by one.
  iconActions: { flexDirection: 'row', flexShrink: 0, gap: t.space[8] },
  notice: { marginTop: t.space[16] },
}));

/** What the profile shows of a member, the own one (auth/me) or another (PROF-02). */
export type ProfileData = Pick<Me, 'display_name' | 'username' | 'city' | 'bio' | 'avatar' | 'cover' | 'member_since' | 'stats'> &
  Partial<Pick<Me, 'is_sample' | 'is_editorial'>>;

/** The member's own cover first; without one the main build's photo (09 §7.7 "favourite car photo"); else none. */
export function profileCover(profile: Pick<ProfileData, 'cover'>, cardCovers: readonly (MediaData | null | undefined)[]): MediaData | null {
  const first = cardCovers[0] ?? null;
  const cover = profile.cover ?? first;
  // DQ-1090: the cover and the first garage card are in one screenful; when they are the same photo, the cover takes another
  // build's photo instead (the member's own pick stays wherever it would not repeat).
  if (cover && first && cover.id === first.id) {
    return cardCovers.slice(1).find((other): other is MediaData => Boolean(other) && other?.id !== cover.id) ?? cover;
  }
  return cover;
}

export type ProfileIdentityProps = {
  profile: ProfileData;
  /** Prefix of the test IDs: `.identity`, `.cover`, `.avatar`, `.name`, `.username`, `.meta`, `.stats`, `.bio`, `.actions`. */
  routeId: string;
  /** Width of the screen's content area: the cover runs edge to edge. */
  width: number;
  /** The garage cards' photos in card order: the cover without one of the member's own, and never the first card's twice. */
  cardCovers?: readonly (MediaData | null | undefined)[];
  /** "Folgt dir" beside the @username (PROF-02). */
  badge?: string;
  /** Another member's profile (PROF-02): the stats name their second list "Gefolgt". */
  other?: boolean;
  onFollowers?: () => void;
  onFollowing?: () => void;
  /** Under the bio and the stats, for a restriction. */
  notice?: ReactNode;
  /** The row of actions under the identity. */
  actions: ReactNode;
  /** Under the actions, for a helper such as why Nachricht is off. */
  footer?: ReactNode;
  /** Where the name ends, from the top of the identity: the bar shows the name once it has scrolled under it. */
  onNameBottom?: (bottom: number) => void;
};

/**
 * 09 §7.7 PROF-01/02: a 16:9 cover edge to edge with `scrim.top` under the floating controls, the avatar 88 overlapping it by
 * half in a canvas ring, the name in `title.1` (people speak Inter), @username, "München · Mitglied seit März 2023", the bio
 * (three lines), badges, one quiet meta line of counts and the actions of the variant. No stat boxes.
 */
export function ProfileIdentity({
  profile,
  routeId,
  width,
  cardCovers = [],
  badge,
  other = false,
  onFollowers,
  onFollowing,
  notice,
  actions,
  footer,
  onNameBottom,
}: ProfileIdentityProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const { gutter, kind } = useBreakpoint();
  const name = profile.display_name || profile.username || '';
  const showUsername = Boolean(profile.display_name && profile.username);
  const since = t('memberSince', { date: format.monthYear(new Date(profile.member_since)) });
  const meta = [profile.city, since].filter(Boolean).join(' · ');
  const cover = profileCover(profile, cardCovers);
  const coverHeight = cover && width > 0 ? profileCoverHeight(width, kind) : 0;

  return (
    <View testID={`${routeId}.identity`}>
      {cover && width > 0 ? (
        <Photo {...photoFields(cover, width)} aspect={profileCoverAspect(kind)} label={t('coverLabel', { name })} testID={`${routeId}.cover`}>
          <PhotoTopScrim />
        </Photo>
      ) : null}
      <View style={[styles.identity, { paddingHorizontal: gutter }]}>
        <View style={cover ? styles.avatarOverlap : styles.avatarTop}>
          {cover ? <View style={styles.ring} /> : null}
          <Avatar name={name} uri={avatarUrlOf(profile.avatar)} blurhash={profile.avatar?.blurhash} size={88} decorative testID={`${routeId}.avatar`} />
        </View>
        <View
          style={styles.names}
          onLayout={
            onNameBottom
              ? (event: LayoutChangeEvent) => {
                  const { y, height } = event.nativeEvent.layout;
                  onNameBottom(coverHeight + y + height);
                }
              : undefined
          }
        >
          <Text variant="title1" role="heading" aria-level={1} testID={`${routeId}.name`}>
            {name}
          </Text>
          {showUsername || badge ? (
            <View style={styles.handle}>
              {showUsername ? (
                <Text variant="callout" color="text.secondary" hyphenate={false} testID={`${routeId}.username`}>
                  {`@${profile.username}`}
                </Text>
              ) : null}
              {badge ? <StatusPill label={badge} testID={`${routeId}.followsYou`} /> : null}
            </View>
          ) : null}
          <Text variant="caption" color="text.tertiary" testID={`${routeId}.meta`}>
            {meta}
          </Text>
        </View>
        {profile.bio ? (
          <Text variant="body" numberOfLines={3} style={styles.bio} testID={`${routeId}.bio`}>
            {profile.bio}
          </Text>
        ) : null}
        {/* 09 §8.19: the Editorial account and sample members are badged; their counts come null and stay hidden. */}
        {sampleBadgeKinds(profile).length > 0 ? (
          <View style={[styles.handle, styles.bio]}>
            <SampleBadges flags={profile} testID={`${routeId}.sample`} />
          </View>
        ) : null}
        <ProfileStats
          stats={profile.stats}
          onFollowers={onFollowers}
          onFollowing={onFollowing}
          member={other ? { handle: `@${profile.username ?? ''}` } : undefined}
          style={styles.stats}
          testID={`${routeId}.stats`}
        />
        {notice ? <View style={styles.notice}>{notice}</View> : null}
        <View style={styles.actions} testID={`${routeId}.actions`}>
          {actions}
        </View>
        {footer}
      </View>
    </View>
  );
}

export type ProfileHeaderProps = {
  me: Me;
  width: number;
  cardCovers?: readonly (MediaData | null | undefined)[];
  onEdit: () => void;
  onShare: () => void;
  onQrCodes: () => void;
  onFollowers?: () => void;
  onFollowing?: () => void;
  onNameBottom?: (bottom: number) => void;
  sharing?: boolean;
  /** Under the stats, for a restriction. */
  notice?: ReactNode;
  /** The member cannot change the profile now: the edit screen only shows it (DQ-124). */
  readOnly?: boolean;
};

/** PROF-01: the identity with "Profil bearbeiten" (secondary), share and the QR codes (QR-01). */
export function ProfileHeader({ me, width, cardCovers, onEdit, onShare, onQrCodes, onFollowers, onFollowing, onNameBottom, sharing = false, notice, readOnly = false }: ProfileHeaderProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  return (
    <ProfileIdentity
      profile={me}
      routeId="PROF-01"
      width={width}
      cardCovers={cardCovers}
      onFollowers={onFollowers}
      onFollowing={onFollowing}
      onNameBottom={onNameBottom}
      notice={notice}
      actions={
        <>
          <Button label={readOnly ? t('actions.view') : t('actions.edit')} variant="secondary" size="m" onPress={onEdit} testID="PROF-01.edit" />
          <View style={styles.iconActions}>
            <IconButton icon="share-network" label={t('actions.share')} onPress={onShare} loading={sharing} testID="PROF-01.share" />
            <IconButton icon="qr-code" label={t('actions.qr')} onPress={onQrCodes} testID="PROF-01.qrCodes" />
          </View>
        </>
      }
    />
  );
}
