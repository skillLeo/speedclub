import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';

import { Text } from './Text';

export type StatusPillProps = {
  /** "Verbaut", "Geplant"; legal status uses the same shape. */
  label: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: t.color.border.default,
    borderRadius: t.radius.xs,
    borderWidth: t.size.border.control,
    justifyContent: 'center',
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
}));

/** §8 status pill: 20 high, radius 4, 1 border.default, `label.badge` text.secondary. */
export function StatusPill({ label, style, testID }: StatusPillProps) {
  const styles = useStyles();
  return (
    <View testID={testID} style={[styles.pill, style]}>
      <Text hyphenate={false} variant="labelBadge" color="text.secondary">
        {label}
      </Text>
    </View>
  );
}
