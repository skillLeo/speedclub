import { useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { keepValuesTogether } from '@/lib/format';
import { createStyles, size, space, useBreakpoint } from '@/theme';

import { Avatar } from './Avatar';
import { WithoutForcedState } from './qaVisualState';
import { joinLabel, RowBody, useRowInset, useStacksAtFontScale, type RowInset } from './rowParts';
import { Text } from './Text';

export type OwnerRowProps = {
  name: string;
  /** "@lukas.sc · Stuttgart" */
  meta?: string;
  avatarUri?: string | null;
  avatarBlurhash?: string | null;
  /** Opens the profile. */
  onPress?: () => void;
  /** FS-3: "Folgen" (secondary M) and "Nachricht" (primary M). */
  actions?: ReactNode;
  /**
   * The actions in their widest state, for example a disabled "✓ Folge ich" while "Folgen" shows. Drawn invisibly to be measured,
   * so following never flips the row between one line and two. Pass disabled controls: they are never focusable. Without it the
   * visible actions are measured.
   */
  widestActions?: ReactNode;
  inset?: RowInset;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * ADR-170, amended by DQ-262: the actions trail the identity while avatar 40 + 12 + about 140 of FS-3 meta + 12 + the actions'
 * measured width (in their widest state) fit the row's content width, measured on the row and not read from the window, because
 * the row also sits in side columns. A single "Folgen" trails at 390, 430 and in the 1280 side card; the guest pair needs about 202
 * and stacks there. Until the actions are measured, the two-button width stands in: 438 with the 16 insets.
 */
export const OWNER_IDENTITY_MIN_WIDTH = size.avatar.md + 2 * space[12] + 140;
const INLINE_MIN_WIDTH = 438;

const useStyles = createStyles((t) => ({
  inline: { alignItems: 'center', flexDirection: 'row', gap: t.space[12] },
  stacked: { alignItems: 'stretch', gap: t.space[12] },
  // The fill and the inset focus ring need air around avatar and text. The margin gives that air back, so the avatar stays
  // on the gutter and FS-3 keeps its 16 above and 24 below the row.
  box: { margin: -t.space[8] },
  boxInline: { flex: 1, minWidth: 0 },
  // DQ-053: the pressed fill has the corners of the focus ring around it.
  identity: { alignItems: 'center', borderRadius: t.radius.sm, flexDirection: 'row', gap: t.space[12], padding: t.space[8] },
  text: { flex: 1, minWidth: 0 },
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  actionsInline: { flexShrink: 0 },
  // Stacked, the box keeps the width of its buttons, so the measure does not change with the layout it decides.
  actionsStacked: { alignSelf: 'flex-start' },
  // Behind the row and out of hit-testing for good: a control inside the copy must never take a click meant for the identity
  // link (M2.3 test round, F1).
  measure: { flexDirection: 'row', gap: t.space[8], left: 0, opacity: 0, position: 'absolute', top: 0, zIndex: -1 },
}));

/**
 * FS-3 owner row: avatar 40, `body.strong` name, `supporting` meta, the two actions trailing. In a narrow row or at a
 * large font the actions move under the name, because beside them the username would break inside the word.
 */
export function OwnerRow({ name, meta, avatarUri, avatarBlurhash, onPress, actions, widestActions, inset, style, testID }: OwnerRowProps) {
  const styles = useStyles();
  const side = useRowInset(inset);
  const { width } = useBreakpoint();
  const largeFont = useStacksAtFontScale();
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const [shownWidth, setShownWidth] = useState<number | null>(null);
  const [widestWidth, setWidestWidth] = useState<number | null>(null);
  const measured = widestActions ? widestWidth : shownWidth;
  const actionsWidth = measured === null ? null : Math.max(measured, shownWidth ?? 0);
  const outer = rowWidth ?? width;
  const fits = actionsWidth === null ? outer >= INLINE_MIN_WIDTH : outer - 2 * side >= OWNER_IDENTITY_MIN_WIDTH + actionsWidth;
  const stacked = Boolean(actions) && (largeFont || !fits);
  const widthOf = (set: (value: number) => void) => (event: LayoutChangeEvent) => set(Math.ceil(event.nativeEvent.layout.width));

  return (
    <View
      testID={testID}
      onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
      style={[stacked ? styles.stacked : styles.inline, { paddingLeft: side, paddingRight: side }, style]}
    >
      <RowBody
        onPress={onPress}
        label={joinLabel([name, meta])}
        boxStyle={[styles.box, stacked ? null : styles.boxInline]}
        style={styles.identity}
        testID={testID ? `${testID}.identity` : undefined}
      >
        <Avatar decorative name={name} uri={avatarUri} blurhash={avatarBlurhash} size={40} />
        <View style={styles.text}>
          <Text variant="bodyStrong">{name}</Text>
          {meta ? (
            <Text variant="supporting" color="text.secondary" hyphenate={false}>
              {keepValuesTogether(meta, !largeFont)}
            </Text>
          ) : null}
        </View>
      </RowBody>
      {actions ? (
        <View
          style={[styles.actions, stacked ? styles.actionsStacked : styles.actionsInline]}
          onLayout={widthOf(setShownWidth)}
          testID={testID ? `${testID}.actions` : undefined}
        >
          <WithoutForcedState>{actions}</WithoutForcedState>
        </View>
      ) : null}
      {actions && widestActions ? (
        <View
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={styles.measure}
          onLayout={widthOf(setWidestWidth)}
          testID={testID ? `${testID}.measure` : undefined}
        >
          <WithoutForcedState>{widestActions}</WithoutForcedState>
        </View>
      ) : null}
    </View>
  );
}
