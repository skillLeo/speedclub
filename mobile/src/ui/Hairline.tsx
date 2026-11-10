import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, type space, type SpaceToken } from '@/theme';

type SpaceValue = (typeof space)[SpaceToken];

export type HairlineProps = {
  /** Space token at the start, for example up to the text of a list row. */
  inset?: SpaceValue;
  /** Space token at the end. */
  insetEnd?: SpaceValue;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  line: {
    alignSelf: 'stretch',
    backgroundColor: t.color.border.subtle,
    height: isWeb ? t.size.border.control : StyleSheet.hairlineWidth,
  },
}));

/** §5 divider: StyleSheet.hairlineWidth on native, 1 px border.subtle on web. */
export function Hairline({ inset = 0, insetEnd = 0, style, testID }: HairlineProps) {
  const styles = useStyles();
  return <View aria-hidden testID={testID} style={[styles.line, { marginLeft: inset, marginRight: insetEnd }, style]} />;
}
