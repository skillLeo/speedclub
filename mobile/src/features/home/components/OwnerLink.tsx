import { memo } from 'react';
import { View } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, size } from '@/theme';
import { Avatar, PressableScale, SkeletonBlock, SkeletonText, Text, type VehicleCardOwner } from '@/ui';
import { joinLabel } from '@/ui/rowParts';

const useStyles = createStyles((t) => ({
  // A link of its own under the card body, so controls do not nest: the 32 avatar row of §8 in a 44 target, 8 under the chips.
  root: { marginTop: t.space[8] },
  body: { alignItems: 'center', borderRadius: t.radius.sm, flexDirection: 'row', gap: t.space[8], minHeight: t.size.touchMin },
  hover: { backgroundColor: t.color.state.hover },
  // DQ-185: username and time wrap as two pieces; where both do not fit beside the avatar, the time drops under the name.
  meta: { alignItems: 'baseline', columnGap: t.space[8], flex: 1, flexDirection: 'row', flexWrap: 'wrap', minWidth: 0, rowGap: t.space[2] },
  name: { flexShrink: 1, minWidth: 0 },
  line: { flex: 1, minWidth: 0 },
}));

export type OwnerLinkProps = {
  owner: VehicleCardOwner;
  /** For the accessible name: "Profil von @lukas.sc". */
  label: string;
  onPress: () => void;
  testID: string;
};

/** The owner row of a feed card (§8: avatar 32, @username `supporting`, time `caption` tertiary), opening PROF-02. */
export const OwnerLink = memo(function OwnerLink({ owner, label, onPress, testID }: OwnerLinkProps) {
  const styles = useStyles();
  return (
    <PressableScale
      role="link"
      aria-label={isWeb ? undefined : joinLabel([label, owner.time])}
      onPress={onPress}
      style={styles.root}
      contentStyle={({ hovered }) => [styles.body, hovered ? styles.hover : null]}
      testID={testID}
    >
      <Avatar decorative name={owner.username} uri={owner.avatarUri} blurhash={owner.avatarBlurhash} size={size.avatar.sm} />
      <View style={styles.meta}>
        <Text hyphenate={false} variant="callout" style={styles.name}>
          {owner.username}
        </Text>
        {owner.time ? (
          <Text variant="caption" color="text.tertiary" hyphenate={false} testID={`${testID}.time`}>
            {owner.time}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
});

/** Its loading state, in the same geometry. Inside a `Skeleton`. */
export function OwnerLinkSkeleton() {
  const styles = useStyles();
  return (
    <View style={[styles.root, styles.body]}>
      <SkeletonBlock width={size.avatar.sm} height={size.avatar.sm} corner="full" />
      <View style={styles.line}>
        <SkeletonText variant="callout" width="45%" />
      </View>
    </View>
  );
}
