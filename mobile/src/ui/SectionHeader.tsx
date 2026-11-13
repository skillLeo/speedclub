import { useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';

import { Button } from './Button';
import { Text } from './Text';

export type SectionHeaderProps = {
  title: string;
  /** Text action, for example "Alle". */
  actionLabel?: string;
  onAction?: () => void;
  /** Names the action for screen readers when the label alone says too little: "Alle neuen Builds". */
  actionAccessibilityLabel?: string;
  /** Any other trailing element, instead of the text action. */
  trailing?: ReactNode;
  /**
   * When title and text action do not fit one line, the action takes the next one instead of squeezing the title, and
   * its text then starts on the title's edge (DQ-110, DQ-159). Without it they always share the line.
   */
  wraps?: boolean;
  /** Heading level for screen readers. */
  level?: 2 | 3;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], justifyContent: 'space-between' },
  rowWraps: { flexWrap: 'wrap' },
  title: { flexShrink: 1 },
  // The label aligns with the right edge of the content; the button's padding reaches into the gutter.
  action: { flexShrink: 0, marginRight: -t.size.buttonPaddingX.s },
  // DQ-298: a Button S (36) beside the title line (24) would make the header 36 high, 18 from title to content instead of §5's 12.
  // The button overhangs the line by the difference, 4 above and 8 below, which also sets its label on the title's baseline. Both
  // margins are on the spacing scale; the content below keeps its 12, and the 44 target reaches into that gap as it does elsewhere.
  // 2.0: the title is `headline` (22 line); the overhang is re-measured with the SectionHeader rebuild (M4.4, Button S 32).
  // BUG-2: the action may sit in this wrapping row and its column wrapper only because the Button's visual never grows inside
  // its hugging target (PressableScale `visualFills`); a growing one took the whole panel height on Android.
  overhang: { marginBottom: -t.space[8], marginTop: -t.space[4] },
  // On a line of its own the padding reaches into the gutter on the start side instead (DQ-110), so the text starts on the
  // title's edge. The box keeps its width, so the wrap it was measured in cannot change.
  actionStacked: { flexShrink: 0, marginLeft: -t.size.buttonPaddingX.s },
}));

/** Section header: `headline` (v1 `title.s`, 09 §4.2) and one trailing action. */
export function SectionHeader({ title, actionLabel, onAction, actionAccessibilityLabel, trailing, wraps = false, level = 2, style, testID }: SectionHeaderProps) {
  const styles = useStyles();
  const [titleBottom, setTitleBottom] = useState(0);
  const [actionTop, setActionTop] = useState(0);
  // A wrapped action starts below the title's line; beside it, it starts within that line.
  const stacked = wraps && titleBottom > 0 && actionTop >= titleBottom;
  const onTitleLayout = wraps
    ? (event: LayoutChangeEvent) => setTitleBottom(event.nativeEvent.layout.y + event.nativeEvent.layout.height)
    : undefined;
  const onActionLayout = wraps ? (event: LayoutChangeEvent) => setActionTop(event.nativeEvent.layout.y) : undefined;

  const button = actionLabel ? (
    <Button
      label={actionLabel}
      accessibilityLabel={actionAccessibilityLabel}
      onPress={onAction}
      variant="tertiary"
      size="s"
      style={wraps ? undefined : [styles.action, styles.overhang]}
      testID={testID ? `${testID}.action` : undefined}
    />
  ) : null;

  return (
    <View testID={testID} style={[styles.row, wraps ? styles.rowWraps : null, style]}>
      <Text variant="headline" role="heading" {...({ 'aria-level': level } as object)} style={styles.title} onLayout={onTitleLayout}>
        {title}
      </Text>
      {trailing ??
        (button && wraps ? (
          <View style={stacked ? styles.actionStacked : [styles.action, styles.overhang]} onLayout={onActionLayout}>
            {button}
          </View>
        ) : (
          button
        ))}
    </View>
  );
}
