import { View, type StyleProp, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, size, space, typography, useTheme } from '@/theme';

import { SkeletonBlock } from './Skeleton';
import { typeStyle } from './Text';
import { ValueText } from './ValueText';

export type SpecChipProps = {
  /** Value with unit, for example "500 PS". */
  label: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    minHeight: t.size.specChip,
    paddingHorizontal: t.space[8],
    paddingVertical: t.space[2],
  },
  // §8: `caption` at weight 600. The semi-bold family comes from labelS, with its web fallback stack.
  label: { fontFamily: typeStyle('labelS', 1, isWeb ? 'web' : 'native').fontFamily },
}));

/** The loading state of a chip. It grows with the font as the real one does: 24 high until the text needs more. */
export function SpecChipSkeleton({ width, testID }: { width: number; testID?: string }) {
  const { fontScale } = useTheme();
  const height = Math.max(size.specChip, typography.caption.lineHeight * fontScale + 2 * space[2]);
  return <SkeletonBlock width={width * fontScale} height={height} testID={testID} />;
}

/** §8 spec chip (static): 24 high, radius 4, bg.raised, tabular figures only where the value is a number (§4). */
export function SpecChip({ label, style, testID }: SpecChipProps) {
  const styles = useStyles();
  return (
    <View testID={testID} style={[styles.chip, style]}>
      <ValueText hyphenate={false} variant="caption" style={styles.label} values={label} wholeValues={false} />
    </View>
  );
}
