import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ActiveMember } from '@/api/queries/home';
import { variantUrl } from '@/features/profile/media';
import { isWeb } from '@/lib/platform';
import { createStyles, size, space, useTheme } from '@/theme';
import { Avatar, PressableScale, SkeletonBlock, SkeletonText, Text } from '@/ui';
import { joinLabel } from '@/ui/rowParts';
import { handleText, vehicleNameText } from '@/ui/textBreaks';

import { carLabel } from '../model';

const GAP = space[12];
/** FS-2: four and a half members in view, so the half says the strip scrolls. */
const VISIBLE = 4.5;
/** From an enlarged font the names need the room: two and a half. */
const VISIBLE_LARGE = 2.5;
const LARGE_FONT = 1.2;

/** The width of one member at this strip width: never narrower than the 56 avatar. */
export function memberItemWidth(stripWidth: number, gutter: number, fontScale: number): number {
  const visible = fontScale > LARGE_FONT ? VISIBLE_LARGE : VISIBLE;
  const whole = Math.floor(visible);
  return Math.max(size.avatar.lg, Math.floor((stripWidth - gutter - whole * GAP) / visible));
}

const useStyles = createStyles((t) => ({
  // A scroller clips on both axes on web, so the focus ring (2 + 2) needs room inside it; the negative margin keeps the strip's place.
  list: { marginVertical: -t.space[8] },
  content: { paddingVertical: t.space[8] },
  separator: { width: GAP },
  item: { alignItems: 'flex-start', borderRadius: t.radius.sm, gap: t.space[4] },
  hover: { backgroundColor: t.color.state.hover },
  text: { alignSelf: 'stretch', gap: t.space[2] },
  skeletonRow: { flexDirection: 'row', gap: GAP, overflow: 'hidden' },
}));

function Separator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

const Member = memo(function Member({
  member,
  width,
  onOpen,
  testID,
}: {
  member: ActiveMember;
  width: number;
  onOpen: (username: string) => void;
  testID: string;
}) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const handle = `@${member.username}`;
  const car = carLabel(member);
  const style = useMemo(() => ({ width }), [width]);
  return (
    <PressableScale
      role="link"
      aria-label={isWeb ? undefined : joinLabel([t('members.profileOf', { name: handle }), car])}
      onPress={() => onOpen(member.username)}
      style={style}
      contentStyle={({ hovered }) => [styles.item, hovered ? styles.hover : null]}
      testID={testID}
    >
      <Avatar
        decorative
        name={member.display_name ?? member.username}
        uri={variantUrl(member.avatar, size.avatar.lg)}
        blurhash={member.avatar?.blurhash}
        size={size.avatar.lg}
      />
      <View style={styles.text}>
        <Text variant="caption" hyphenate={false} testID={`${testID}.username`}>
          {handleText(handle)}
        </Text>
        {car ? (
          <Text variant="caption" color="text.tertiary" hyphenate={false} numberOfLines={2} testID={`${testID}.car`}>
            {vehicleNameText(car)}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
});

export type ActiveMembersStripProps = {
  members: readonly ActiveMember[];
  /** The width the strip has on screen. */
  width: number;
  /** Start padding: the gutter on a phone, where the strip runs to the screen edge; 0 in a column. */
  inset: number;
  onOpen: (username: string) => void;
  testID: string;
};

/** FS-2 "Aktive Mitglieder": members with a public build changed in the last 14 days, most recent first; no counts. */
export function ActiveMembersStrip({ members, width, inset, onOpen, testID }: ActiveMembersStripProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const itemWidth = memberItemWidth(width, inset, fontScale);
  const renderItem: ListRenderItem<ActiveMember> = useCallback(
    ({ item }) => <Member member={item} width={itemWidth} onOpen={onOpen} testID={`${testID}.member.${item.username}`} />,
    [itemWidth, onOpen, testID],
  );
  if (width <= 0) return null;
  return (
    <FlashList
      horizontal
      data={members}
      keyExtractor={(member) => member.username}
      renderItem={renderItem}
      extraData={itemWidth}
      ItemSeparatorComponent={Separator}
      showsHorizontalScrollIndicator={false}
      style={styles.list}
      contentContainerStyle={[styles.content, { paddingHorizontal: inset }]}
      testID={`${testID}.list`}
    />
  );
}

/** The strip while Start loads: five avatars with their two lines. Inside a `Skeleton`. */
export function ActiveMembersStripSkeleton({ width, inset }: { width: number; inset: number }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const itemWidth = memberItemWidth(width, inset, fontScale);
  const count = Math.ceil(fontScale > LARGE_FONT ? VISIBLE_LARGE : VISIBLE);
  return (
    <View style={[styles.skeletonRow, { paddingLeft: inset }]}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={[styles.item, { width: itemWidth }]}>
          <SkeletonBlock width={size.avatar.lg} height={size.avatar.lg} corner="full" />
          <View style={styles.text}>
            <SkeletonText variant="caption" width="90%" />
            <SkeletonText variant="caption" width="70%" />
          </View>
        </View>
      ))}
    </View>
  );
}
