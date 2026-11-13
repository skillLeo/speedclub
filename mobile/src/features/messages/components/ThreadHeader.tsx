import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { variantUrl } from '@/features/profile/media';
import { isWeb } from '@/lib/platform';
import { createStyles, size } from '@/theme';
import { Avatar, Hairline, Header, PressableScale, Skeleton, SkeletonBlock, SkeletonText, Text, type HeaderAction } from '@/ui';

import type { ChatMember } from '../model';

const useStyles = createStyles((t) => ({
  who: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[8],
    minHeight: t.size.touchMin,
    minWidth: 0,
    paddingRight: t.space[8],
  },
  // Without back (web split view) the avatar starts on the gutter, where the bar's 44 targets keep 12 of air.
  noBack: { paddingLeft: t.space[12] },
  names: { flex: 1, minWidth: 0 },
  skeletonNames: { flex: 1, gap: t.space[4], minWidth: 0 },
}));

export type ThreadHeaderProps = {
  /** Null for a deleted account. */
  member: ChatMember | null;
  name: string;
  /** Hidden on the web split view, where the list is beside the thread. */
  onBack?: () => void;
  /** Opens the member's profile; absent for a deleted account. */
  onOpenMember?: () => void;
  onInfo?: () => void;
  /** The conversation is loading: the header's own skeleton (avatar circle, name and @username bars) in place of the member. */
  loading?: boolean;
  testID: string;
};

/**
 * FS-7 header: back, avatar 32 with the name in `headline` and "fährt BMW M3" (else @username) in `caption` stacked beside it,
 * info at the end.
 */
export function ThreadHeader({ member, name, onBack, onOpenMember, onInfo, loading = false, testID }: ThreadHeaderProps) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const handle = member ? `@${member.username}` : null;
  // DQ-1086 / 09 §7.8: who and what they drive. "fährt BMW M3" from the main build, the @handle without a public one.
  const subtitle = member?.mainVehicle ? t('thread.drives', { car: member.mainVehicle.title }) : handle;
  const identity = (
    <>
      <Avatar
        decorative
        name={name}
        uri={variantUrl(member?.avatar, size.avatar.sm)}
        blurhash={member?.avatar?.blurhash}
        size={size.avatar.sm}
      />
      <View style={styles.names}>
        <Text variant="headline" numberOfLines={1} hyphenate={false} role="heading" testID={`${testID}.name`}>
          {name}
        </Text>
        {subtitle ? (
          <Text
            variant="caption"
            color="text.secondary"
            numberOfLines={1}
            hyphenate={false}
            testID={`${testID}.username`}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </>
  );
  // 09 §7.8: the identity (avatar, name, "fährt …") opens MSG-05, which leads on to the profile; the profile without it.
  const onIdentity = member ? (onInfo ?? onOpenMember) : undefined;
  const whoStyle = [styles.who, onBack ? null : styles.noBack];
  // DQ-415: without a member (empty, error, gone) the bar holds back (and info) only, never an anonymous avatar disk.
  const skeleton = (
    <Skeleton testID={`${testID}.skeleton`}>
      <View style={whoStyle}>
        <SkeletonBlock width={size.avatar.sm} height={size.avatar.sm} corner="full" />
        <View style={styles.skeletonNames}>
          <SkeletonText variant="headline" width="45%" />
          <SkeletonText variant="caption" width="30%" />
        </View>
      </View>
    </Skeleton>
  );
  const actions: HeaderAction[] = onInfo
    ? [{ icon: 'info', label: t('thread.info'), onPress: onInfo, testID: `${testID}.info` }]
    : [];
  // The newest messages sit right under the bar, so its line is always drawn rather than faded in on scroll.
  return (
    <View>
      <Header
        onBack={onBack}
        actions={actions}
        titleContent={
          loading ? (
            skeleton
          ) : name === '' ? undefined : onIdentity ? (
            <PressableScale
              role="link"
              // For native. On web the visible name and handle name the link (WCAG 2.5.3): the avatar's initials are visible
              // text as well, which a label would leave out.
              aria-label={isWeb ? undefined : subtitle ? `${name}, ${subtitle}` : name}
              onPress={onIdentity}
              contentStyle={whoStyle}
              testID={`${testID}.member`}
            >
              {identity}
            </PressableScale>
          ) : (
            <View style={whoStyle}>{identity}</View>
          )
        }
        testID={testID}
      />
      <Hairline />
    </View>
  );
}
