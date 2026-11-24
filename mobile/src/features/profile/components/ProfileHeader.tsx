import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { avatarUrlOf, type Me } from '@/api/queries/auth';
import type { MediaData } from '@/api/queries/profile';
import { useFormat } from '@/lib/useFormat';
import { aspect, createStyles, layout, size, useBreakpoint, type BreakpointKind } from '@/theme';
import { Avatar, type AvatarSize } from '@/ui/Avatar';
import { SampleBadges, sampleBadgeKinds } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { Photo, type PhotoAspect } from '@/ui/Photo';
import { PhotoTopScrim } from '@/ui/PhotoStageScrim';
import { StatusPill } from '@/ui/StatusPill';
import { Text } from '@/ui/Text';
import { ratioOf } from '@/ui/Photo';
import { STAGE_EMPTY_PHOTO } from '@/features/vehicle/stage';

import { photoFields } from '../media';
import { ProfileStats } from './ProfileStats';

/** The profile column (DQ-114): 640 plus its gutters, on the start edge, for the identity and every tab but the desktop Garage. */
export const PROFILE_COLUMN_MAX = layout.feedColumn + 2 * layout.gutter.desktop;
/** Desktop Garage tab: the content width of 09 §4.3 (1200) for the cards side by side; identity and the other tabs keep the feed column. */
export const PROFILE_WIDE_MAX = layout.contentMax + 2 * layout.gutter.desktop;
/**
 * 09 §5 Avatar 88 on phones and tablets, overlapping the cover by half its height (09 §7.7). Client round 2 (CR2-5): on the desktop
 * the 88 read too large beside the title; it takes the next step of the scale, 56, with the same half-height overlap.
 */
export function profileAvatarSize(kind: BreakpointKind): AvatarSize {
  return kind === 'desktop' ? size.avatar.lg : size.avatar.xl;
}

/** Half the avatar: how far it reaches up into the cover. */
export function profileAvatarOverlap(kind: BreakpointKind): number {
  return profileAvatarSize(kind) / 2;
}
/** DOM audit: half the avatar's size is a derived margin, not a scale step (counted exemption, M4.18). */
export const AVATAR_OVERLAP_EXEMPT = { qaExempt: 'avatar-overlap' } as const;

/**
 * 09 §7.7, §4.6, ADR-451 (DQ-1091): the cover is 16:9 on phones and tablets, edge to edge. R4-1.3 (client round 4, overrides
 * ADR-451's "one aspect everywhere" for the desktop): from 1280 the 16:9 box filled the window (1200 × 675 at 1440), so the desktop
 * cover is 3:1 (1200 × 400 at 1440), cropped from the photo's focal point.
 */
export function profileCoverAspect(kind?: BreakpointKind): PhotoAspect {
  return kind === 'desktop' ? aspect.cover : aspect.editorial;
}

/**
 * The cover's width in a pane `width` wide. DQ-1159: from 1280 it spans the main area like the VEH-01 hero (0 radius, full bleed),
 * up to the wide column's box, so it shares both edges with the column the identity, the tabs and the garage grid stand in (their
 * text on its gutter, the avatar too): x 240–1280 at 1280 (1040 × 347), x 240–1440 at 1440 (1200 × 400), and never wider than the
 * 1200 content plus its gutters, where the column stops.
 */
export function profileCoverWidth(width: number, kind: BreakpointKind): number {
  return kind === 'desktop' ? Math.min(width, PROFILE_WIDE_MAX) : width;
}

/** Height of the cover at `width`: where the photo header turns solid, and the skeleton's block. */
export function profileCoverHeight(width: number, kind: BreakpointKind): number {
  return profileCoverWidth(width, kind) / ratioOf(profileCoverAspect(kind));
}

const useStyles = createStyles((t) => ({
  identity: { maxWidth: PROFILE_COLUMN_MAX, width: '100%' },
  avatarOverlap: { alignSelf: 'flex-start' },
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

/** What the cover fallback needs of a garage card: the photo it shows and how many photos its build shows the viewer. */
export type CoverCard = { cover: MediaData | null | undefined; photo_count?: number | null };

/**
 * The profile cover without one of the member's own (DQ-1234): the brand stage, WEB-01's `stage-empty` (a lit shelter on wet tarmac
 * at night, no car, no member), the photo /u shows in the same case. It never stands in for somebody's car, so it carries no label.
 */
export const PROFILE_STAGE = STAGE_EMPTY_PHOTO;

/**
 * The member's own cover, always (DQ-1160: PROF-01 shows what PROF-03 previews). Without one a build photo only when no garage card
 * shows it (DQ-1234, skill rule 6: never one picture twice in a scroll): the cover of the first build, main first (09 §7.7 "favourite
 * car photo"), that has a second photo, as its card then takes that next one (`useDistinctCover`). Otherwise null: the profile shows
 * the brand stage (`PROFILE_STAGE`), as /u does (PublicPageData). A chosen cover that is also a card's is kept: the card gives way.
 */
export function profileCover(profile: Pick<ProfileData, 'cover'>, cards: readonly CoverCard[]): MediaData | null {
  if (profile.cover) return profile.cover;
  return cards.find((card) => card.cover && (card.photo_count ?? 0) > 1)?.cover ?? null;
}

/** A garage card's photos as far as the card carries them: its cover, and the next gallery photos when the API sends them. */
export type GarageCardPhotos = { cover: MediaData | null; photos?: readonly MediaData[] | null };

/**
 * DQ-1160: the photo a garage card shows under a profile whose cover is `profileCoverPhoto`. When the two are the same picture the
 * card takes its next gallery photo, if the card data carries one; otherwise it keeps its cover (the member's choice is never
 * replaced on the cover side).
 */
export function garageCardCover(vehicle: GarageCardPhotos, profileCoverPhoto: MediaData | null | undefined): MediaData | null {
  const cover = vehicle.cover;
  if (!cover || !profileCoverPhoto || cover.id !== profileCoverPhoto.id) return cover;
  return vehicle.photos?.find((photo) => photo.id !== cover.id) ?? cover;
}

export type ProfileIdentityProps = {
  profile: ProfileData;
  /** Prefix of the test IDs: `.identity`, `.cover`, `.avatar`, `.name`, `.username`, `.meta`, `.stats`, `.bio`, `.actions`. */
  routeId: string;
  /** Width of the screen's content area: the cover runs edge to edge. */
  width: number;
  /** The garage cards in card order: the cover without one of the member's own (`profileCover`). */
  cards?: readonly CoverCard[];
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
  /** M5.9d: "Lvl 4 · Parts Hunter" beside the @username (LevelLine). */
  level?: ReactNode;
  /** M5.9d: "Founding Member" with its four-digit number under the meta line (FoundingLine). */
  founding?: ReactNode;
  /** M5.9d: the badge row under the counts (MyBadgeRow / MemberBadgeRow). */
  badges?: ReactNode;
};

/**
 * 09 §7.7 PROF-01/02: a 16:9 cover edge to edge (on the desktop across the wide column, DQ-1159) with `scrim.top` under the floating
 * controls (the member's photo, else the brand stage: every profile opens on a photo, skill rule 1), the avatar 88 overlapping it by
 * half in a canvas ring, the name in `title.1` (people speak Inter), @username, "München · Mitglied seit März 2023", the bio
 * (three lines), badges, one quiet meta line of counts and the actions of the variant. No stat boxes.
 */
export function ProfileIdentity({
  profile,
  routeId,
  width,
  cards = [],
  badge,
  other = false,
  onFollowers,
  onFollowing,
  notice,
  actions,
  footer,
  level,
  founding,
  badges,
}: ProfileIdentityProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const { gutter, kind } = useBreakpoint();
  const name = profile.display_name || profile.username || '';
  const showUsername = Boolean(profile.display_name && profile.username);
  const since = t('memberSince', { date: format.monthYear(new Date(profile.member_since)) });
  const meta = [profile.city, since].filter(Boolean).join(' · ');
  const cover = profileCover(profile, cards);
  const coverWidth = profileCoverWidth(width, kind);

  return (
    <View testID={`${routeId}.identity`}>
      {width > 0 ? (
        <Photo
          {...(cover ? photoFields(cover, coverWidth) : PROFILE_STAGE)}
          aspect={profileCoverAspect(kind)}
          label={cover ? t('coverLabel', { name }) : undefined}
          style={{ width: coverWidth }}
          testID={`${routeId}.cover`}
        >
          <PhotoTopScrim />
        </Photo>
      ) : null}
      <View style={[styles.identity, { paddingHorizontal: gutter }]}>
        <View style={[styles.avatarOverlap, { marginTop: -profileAvatarOverlap(kind) }]} dataSet={AVATAR_OVERLAP_EXEMPT}>
          <View style={styles.ring} />
          <Avatar name={name} uri={avatarUrlOf(profile.avatar)} blurhash={profile.avatar?.blurhash} size={profileAvatarSize(kind)} decorative testID={`${routeId}.avatar`} />
        </View>
        <View style={styles.names}>
          <Text variant="title1" role="heading" aria-level={1} testID={`${routeId}.name`}>
            {name}
          </Text>
          {showUsername || badge || level ? (
            <View style={styles.handle}>
              {showUsername ? (
                <Text variant="callout" color="text.secondary" hyphenate={false} testID={`${routeId}.username`}>
                  {`@${profile.username}`}
                </Text>
              ) : null}
              {level}
              {badge ? <StatusPill label={badge} testID={`${routeId}.followsYou`} /> : null}
            </View>
          ) : null}
          <Text variant="caption" color="text.tertiary" testID={`${routeId}.meta`}>
            {meta}
          </Text>
          {founding}
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
        {badges}
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
  /** The garage cards in card order, for the cover without one of the member's own (`profileCover`). */
  cards?: readonly CoverCard[];
  onEdit: () => void;
  onShare: () => void;
  onQrCodes: () => void;
  onFollowers?: () => void;
  onFollowing?: () => void;
  sharing?: boolean;
  /** Under the stats, for a restriction. */
  notice?: ReactNode;
  /** The member cannot change the profile now: the edit screen only shows it (DQ-124). */
  readOnly?: boolean;
  /** M5.9b: the "Mein Dex" row under the actions. */
  dex?: ReactNode;
  /** M5.9d: level line, founding line and badge row (features/gift ProfileGift). */
  gift?: Pick<ProfileIdentityProps, 'level' | 'founding' | 'badges'>;
};

/** PROF-01: the identity with "Profil bearbeiten" (secondary), share and the QR codes (QR-01). */
export function ProfileHeader({ me, width, cards, onEdit, onShare, onQrCodes, onFollowers, onFollowing, sharing = false, notice, readOnly = false, dex, gift }: ProfileHeaderProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  return (
    <ProfileIdentity
      profile={me}
      routeId="PROF-01"
      width={width}
      cards={cards}
      onFollowers={onFollowers}
      onFollowing={onFollowing}
      notice={notice}
      footer={dex}
      {...gift}
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
