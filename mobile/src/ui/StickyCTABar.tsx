import { useFocusEffect } from 'expo-router';
import { useCallback, useId, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';

import { isWeb } from '@/lib/platform';
import { createStyles, size, space, typography, useBreakpoint, useTheme } from '@/theme';

import { Button, type ButtonVariant } from './Button';
import { Hairline } from './Hairline';
import { useSafeEdge, useSafeInset } from './safeArea';
import { estimatedInterWidth } from './specLabelMetrics';
import { reportStickyBar } from './toastPlacement';

export type StickyCTASecondary = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
};

export type StickyCTABarProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Button's `locked` for the primary: why it cannot be used now (read-only view); a press says why. */
  locked?: string | null;
  /** `brand` only on brand moments. */
  variant?: Extract<ButtonVariant, 'primary' | 'brand'>;
  /** Tertiary text action on the left, for example "Entwurf speichern" (§9). */
  secondary?: StickyCTASecondary;
  /**
   * The primary takes a line of its own under the secondary, as the bar already does when a large font wraps it. For a
   * primary label that would otherwise wrap beside the secondary and grow the button past 52 (DQ-112).
   */
  stacked?: boolean;
  style?: StyleProp<ViewStyle>;
  /** The primary button is `<testID>.primary`; `<testID>.sticky` is the whole bar with its hairline. */
  testID?: string;
};

const useStyles = createStyles((t) => ({
  bar: { backgroundColor: t.color.bg.surface, paddingTop: t.space[12] },
  // Wraps when both actions no longer fit side by side, as at 200 % font: the primary then takes its own line.
  row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  secondary: { alignSelf: 'center', flexShrink: 1 },
  /**
   * §13 FS-5: the primary keeps at least half of the row when a secondary sits next to it. It may shrink below its label
   * (§4 wrap, never truncate): the wrapper hands the width on and the label wraps, so the action cannot leave the bar.
   */
  primary: { alignSelf: 'auto', flexBasis: '50%', flexGrow: 1, flexShrink: 1, minWidth: 0 },
  primaryAlone: { alignSelf: 'auto', flexGrow: 1, flexShrink: 1, minWidth: 0 },
  stack: { gap: t.space[4] },
  // Zero high, full width: the row's width for the stacking rule, also while the actions wrap.
  measure: { alignSelf: 'stretch', height: 0 },
  // Full width; the label wraps rather than leave the bar at 200 %.
  primaryStacked: { alignSelf: 'stretch', flexShrink: 1, minWidth: 0 },
}));

/** One row of actions: hairline, 12, the L button, 12 and the safe inset (CSS pads it on web, where `inset` is 0). */
export function stickyBarHeight(inset: number): number {
  const hairline = isWeb ? size.border.control : StyleSheet.hairlineWidth;
  return hairline + space[12] + size.button.l + space[12] + inset;
}

/**
 * DQ-958: whether the primary goes on a line of its own under the secondary. Side by side the primary gets half the row (FS-5);
 * when its label at the current font scale, with the L button's padding, does not fit that half on one line, the pair stacks
 * (primary full width), as a large font already makes it wrap. The estimate is Inter SemiBold's advance table (the spec strip's),
 * which never claims less than the screen draws.
 */
export function stickyCtaStacks(label: string, rowWidth: number, fontScale: number, secondaryLabel?: string): boolean {
  if (!Number.isFinite(rowWidth) || rowWidth <= 0) return false;
  const role = typography.bodyStrong;
  const widthOf = (text: string) => Math.ceil(estimatedInterWidth(text, role.fontSize * fontScale, role.letterSpacing * fontScale, 'semibold'));
  const half = (rowWidth - space[8]) / 2;
  const primary = widthOf(label) + 2 * size.buttonPaddingX.l;
  if (primary > half) return true;
  // DQ-978: a draft action wider than the other half would wrap the row and leave it above the primary; stack it under instead.
  if (secondaryLabel === undefined) return false;
  return widthOf(secondaryLabel) + 2 * size.buttonPaddingX.s + space[8] + Math.max(primary, half) > rowWidth;
}

/**
 * §9 sticky bottom CTA: 52 button, 12 vertical padding, the screen gutter at the sides so it lines up with the form
 * above it (ADR-120), safe inset, riding above the keyboard. Render it as the last child
 * of the screen, under the scrolling form. The tertiary action uses size S, so "Entwurf speichern" fits next to a
 * half-width primary at 360. While its screen is focused it reports its height, so the shell toast sits above it
 * (toastPlacement.ts); a pushed screen or another tab takes it out again.
 */
export function StickyCTABar({
  label,
  onPress,
  loading,
  disabled,
  locked,
  variant = 'primary',
  secondary,
  stacked = false,
  style,
  testID,
}: StickyCTABarProps) {
  const styles = useStyles();
  const padding = useSafeEdge('bottom', space[12]);
  const inset = useSafeInset('bottom');
  const { gutter, width } = useBreakpoint();
  const { fontScale } = useTheme();
  // The row's own width once laid out (a bar inside a narrower column, as the DEV-01 specimen), the window's until then.
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const stack = stacked || (secondary !== undefined && stickyCtaStacks(label, rowWidth ?? width - 2 * gutter, fontScale, secondary.label));
  const key = useId();
  // The bar's height before its first layout, so the toast stands above it from the first frame. Starting at 0, the toast first
  // sat on the screen's content and moved up once onLayout came in, under a pointer already on a control there (F3: a click on
  // GAR-10 "Modifikation löschen" landed on the toast, M2.8). onLayout corrects it where the actions wrap.
  const [height, setHeight] = useState(() => stickyBarHeight(inset));

  // The height reported is the whole bar, from the bottom of the window to the top of the hairline, safe inset
  // included. It changes when the actions wrap, as at 200 % font.
  useFocusEffect(
    useCallback(() => {
      reportStickyBar(key, height);
      return () => reportStickyBar(key, null);
    }, [key, height]),
  );
  // Rounding noise below half a pixel is no change: the toast host would only move by it and back.
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    setHeight((current) => (Math.abs(current - next) >= 0.5 ? next : current));
  };

  return (
    // The bar's own safe inset ends up behind the keyboard while it is open.
    <KeyboardStickyView
      offset={{ closed: 0, opened: inset }}
      onLayout={onLayout}
      testID={testID ? `${testID}.sticky` : undefined}
    >
      <Hairline />
      <View dataSet={{ qaExempt: 'safe-area' }} style={[styles.bar, { paddingHorizontal: gutter }, padding, style]} testID={testID}>
        <View
          style={styles.measure}
          onLayout={(event) => {
            const next = Math.round(event.nativeEvent.layout.width);
            setRowWidth((current) => (current === next ? current : next));
          }}
        />
        {secondary && stack ? (
          // DQ-978: stacked, the confirming action comes first and the text action sits centred under it (HIG, M3 stacked
          // actions). Above the primary, flush left, it read as the primary's heading.
          <View style={styles.stack}>
            <Button
              label={label}
              size="l"
              variant={variant}
              onPress={onPress}
              loading={loading}
              disabled={disabled}
              locked={locked}
              style={styles.primaryStacked}
              testID={testID ? `${testID}.primary` : undefined}
            />
            <Button
              label={secondary.label}
              variant="tertiary"
              size="m"
              fullWidth
              onPress={secondary.onPress}
              disabled={secondary.disabled}
              loading={secondary.loading}
              testID={secondary.testID}
            />
          </View>
        ) : (
          <View style={styles.row}>
            {secondary ? (
              <Button
                label={secondary.label}
                variant="tertiary"
                size="s"
                onPress={secondary.onPress}
                disabled={secondary.disabled}
                loading={secondary.loading}
                style={styles.secondary}
                testID={secondary.testID}
              />
            ) : null}
            <Button
              label={label}
              size="l"
              variant={variant}
              onPress={onPress}
              loading={loading}
              disabled={disabled}
              locked={locked}
              style={secondary ? styles.primary : styles.primaryAlone}
              testID={testID ? `${testID}.primary` : undefined}
            />
          </View>
        )}
      </View>
    </KeyboardStickyView>
  );
}
