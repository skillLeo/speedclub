import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { avatarUrlOf, type Me } from '@/api/queries/auth';
import { useFormat } from '@/lib/useFormat';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { Avatar, Button, IconButton, Photo, StatusPill, Text } from '@/ui';

import { photoFields } from '../media';
import { ProfileStats } from './ProfileStats';

const useStyles = createStyles((t) => ({
  identity: { maxWidth: layout.feedColumn + 2 * layout.gutter.desktop, width: '100%' },
  // FS-8: 96 overlapping the cover by 32, inside a 2-pt ring of the canvas.
  avatarOverlap: { alignSelf: 'flex-start', marginTop: -t.space[32] },
  avatarTop: { alignSelf: 'flex-start', marginTop: t.space[8] },
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
  meta: { marginTop: t.space[2] },
  stats: { marginTop: t.space[12] },
  bio: { marginTop: t.space[12] },
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginTop: t.space[16] },
  // DQ-140: share and QR wrap as one group when "Profil bearbeiten" leaves them no room, never one by one.
  iconActions: { flexDirection: 'row', flexShrink: 0, gap: t.space[8] },
  notice: { marginTop: t.space[16] },
}));

/** What FS-8 shows of a member, the own one (auth/me) or another (PROF-02). */
export type ProfileData = Pick<Me, 'display_name' | 'username' | 'city' | 'bio' | 'avatar' | 'cover' | 'member_since' | 'stats'>;

export type ProfileIdentityProps = {
  profile: ProfileData;
  /** Prefix of the test IDs: `.header`, `.cover`, `.avatar`, `.name`, `.username`, `.meta`, `.stats`, `.bio`. */
  routeId: string;
  /** Width of the column, for the cover variant. */
  width: number;
  /** "Folgt dir" beside the @username (PROF-02). */
  badge?: string;
  /** Another member's profile (PROF-02): the stats name their second list "Folgt". */
  other?: boolean;
  onFollowers?: () => void;
  onFollowing?: () => void;
  /** Under the stats and the bio, for a restriction. */
  notice?: ReactNode;
  /** The row of actions under the identity. */
  actions: ReactNode;
  /** Under the actions, for a helper such as why Nachricht is off. */
  footer?: ReactNode;
  /** Where the name ends, from the top of the identity: a compact header shows the name once it has scrolled under the bar. */
  onNameBottom?: (bottom: number) => void;
};

/** FS-8: cover, avatar, name, @username, meta, inline stats, bio, then the actions of the variant. */
export function ProfileIdentity({ profile, routeId, width, badge, other = false, onFollowers, onFollowing, notice, actions, footer, onNameBottom }: ProfileIdentityProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const { gutter } = useBreakpoint();
  const name = profile.display_name || profile.username || '';
  const showUsername = Boolean(profile.display_name && profile.username);
  const since = t('memberSince', { date: format.monthYear(new Date(profile.member_since)) });
  const meta = [profile.city, since].filter(Boolean).join(' · ');

  return (
    <View testID={`${routeId}.header`}>
      {profile.cover ? <Photo {...photoFields(profile.cover, width)} aspect="3:1" testID={`${routeId}.cover`} /> : null}
      <View style={[styles.identity, { paddingHorizontal: gutter }]}>
        <View style={profile.cover ? styles.avatarOverlap : styles.avatarTop}>
          {profile.cover ? <View style={styles.ring} /> : null}
          <Avatar
            name={name}
            uri={avatarUrlOf(profile.avatar)}
            blurhash={profile.avatar?.blurhash}
            size={96}
            decorative
            testID={`${routeId}.avatar`}
          />
        </View>
        <View
          style={styles.names}
          onLayout={
            onNameBottom
              ? (event: LayoutChangeEvent) => {
                  const { y, height } = event.nativeEvent.layout;
                  onNameBottom((profile.cover ? width / 3 : 0) + y + height);
                }
              : undefined
          }
        >
          <Text variant="titleM" role="heading" {...({ 'aria-level': 2 } as object)} testID={`${routeId}.name`}>
            {name}
          </Text>
          {showUsername || badge ? (
            <View style={styles.handle}>
              {showUsername ? (
                <Text variant="supporting" color="text.secondary" hyphenate={false} testID={`${routeId}.username`}>
                  {`@${profile.username}`}
                </Text>
              ) : null}
              {badge ? <StatusPill label={badge} testID={`${routeId}.followsYou`} /> : null}
            </View>
          ) : null}
          <Text variant="caption" color="text.tertiary" style={styles.meta} testID={`${routeId}.meta`}>
            {meta}
          </Text>
        </View>
        <ProfileStats
          stats={profile.stats}
          onFollowers={onFollowers}
          onFollowing={onFollowing}
          member={other ? { handle: `@${profile.username ?? ''}` } : undefined}
          style={styles.stats}
          testID={`${routeId}.stats`}
        />
        {profile.bio ? (
          <Text variant="body" style={styles.bio} testID={`${routeId}.bio`}>
            {profile.bio}
          </Text>
        ) : null}
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
  /** Width of the column, for the cover variant. */
  width: number;
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
};

/** FS-8, own profile: the identity with "Profil bearbeiten", share and QR. */
export function ProfileHeader({ me, width, onEdit, onShare, onQrCodes, onFollowers, onFollowing, sharing = false, notice, readOnly = false }: ProfileHeaderProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  return (
    <ProfileIdentity
      profile={me}
      routeId="PROF-01"
      width={width}
      onFollowers={onFollowers}
      onFollowing={onFollowing}
      notice={notice}
      actions={
        <>
          <Button
            label={readOnly ? t('actions.view') : t('actions.edit')}
            variant="secondary"
            size="m"
            onPress={onEdit}
            testID="PROF-01.edit"
          />
          <View style={styles.iconActions}>
            <IconButton icon="share-network" label={t('actions.share')} onPress={onShare} loading={sharing} testID="PROF-01.share" />
            <IconButton icon="qr-code" label={t('actions.qr')} onPress={onQrCodes} testID="PROF-01.qr" />
          </View>
        </>
      }
    />
  );
}
