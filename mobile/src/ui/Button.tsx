import { useState, type ComponentRef, type Ref } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, size as sizeTokens, useBreakpoint, useTheme, type ColorToken } from '@/theme';

import { Icon, type IconName } from './icons/Icon';
import { PressableScale, type PressableVisualState } from './PressableScale';
import { Spinner } from './Spinner';
import { Text, typeStyle } from './Text';
import { toast } from './toast';

export type ButtonVariant =
  | 'primary'
  | 'brand'
  | 'secondary'
  | 'tertiary'
  | 'destructive'
  /** FS-1: outlined on a photo, white label. */
  | 'onPhoto'
  /** FS-1: text only on a photo. */
  | 'onPhotoText';
export type ButtonSize = 'l' | 'm' | 's';

export type ButtonProps = {
  label: string;
  /** Gets the press event, which `Link asChild` needs on web to tell a plain click from a ctrl-click. */
  onPress?: (event: GestureResponderEvent) => void;
  /** `link` when it navigates, usually through `Link asChild`. */
  role?: 'button' | 'link';
  /** Set by `Link asChild`: on web it renders a real link. */
  href?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Destructive only: the red fill, reserved for the final confirm. */
  filled?: boolean;
  /** The spinner replaces the label; the width stays, presses are ignored. */
  loading?: boolean;
  disabled?: boolean;
  /**
   * Why the action is unavailable right now, such as a read-only view as a member (M3.5): the button looks and announces itself as
   * disabled, and a press shows this reason as a toast instead of running `onPress`. Null or undefined: a normal button.
   */
  locked?: string | null;
  /** Leading icon, 20 (16 on size S). */
  icon?: IconName;
  /** Stretches to the parent's width. Otherwise it hugs its label, and wraps the label rather than leave the parent. */
  fullWidth?: boolean;
  /**
   * A text action inside a column (tertiary): its label lines up with the column edge on this side instead of sitting the
   * padding inside it, and a wrapped label aligns to that side. The target keeps its size and padding; a negative margin
   * of the padding moves the box out into the gutter (DQ-110).
   */
  flush?: 'start' | 'end';
  /** Replaces the label for screen readers when it needs more context. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  ref?: Ref<ComponentRef<typeof View>>;
};

/**
 * DQ-063: §4 wrap, never truncate. A single word wider than the button still has to stay inside it, and only `anywhere`
 * lets the label's minimum width shrink below that word. Lines break at their spaces first; native does this by itself.
 */
const LABEL_LAST_RESORT_BREAK = (isWeb ? { overflowWrap: 'anywhere' } : {}) as TextStyle;
/** The label's height above which it has more than one line, in lines. */
const WRAPPED_LINES = 1.5;
/** DQ-065: the padding below gives the transparent or drawn border its 1 back, which the DOM audit reads as off scale. */
const COMPENSATES_BORDER = { qaExempt: 'hairline' };

const useStyles = createStyles((t) => ({
  hug: { alignSelf: 'flex-start', flexShrink: 1, maxWidth: '100%' },
  // No max width: the negative margins widen the space the box may take by the padding on both sides.
  flushStart: { alignSelf: 'flex-start', flexShrink: 1 },
  flushEnd: { alignSelf: 'flex-end', flexShrink: 1 },
  flushL: { marginHorizontal: -t.size.buttonPaddingX.l },
  flushM: { marginHorizontal: -t.size.buttonPaddingX.m },
  flushS: { marginHorizontal: -t.size.buttonPaddingX.s },
  rowStart: { justifyContent: 'flex-start' },
  rowEnd: { justifyContent: 'flex-end' },
  labelStart: { textAlign: 'left' },
  labelEnd: { textAlign: 'right' },
  full: { alignSelf: 'stretch' },
  hoverDim: { opacity: t.opacity.pressed },
  content: {
    alignItems: 'center',
    // Every variant carries the border, transparent unless it is outlined. Once a long or scaled label outgrows the
    // minimum height, a border only on some variants would leave neighbouring buttons at different heights.
    borderColor: 'transparent',
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    justifyContent: 'center',
    minWidth: t.size.touchMin,
    paddingVertical: t.space[8],
  },
  // §8 padding-x is the label's inset: border and padding together make 20 / 16 / 12.
  l: { minHeight: t.size.button.l, paddingHorizontal: t.size.buttonPaddingX.l - t.size.border.control },
  m: { minHeight: t.size.button.m, paddingHorizontal: t.size.buttonPaddingX.m - t.size.border.control },
  // 20 line + 8 + 8 + border would pass 36. Less padding keeps it at 36; the minimum height centres the label.
  s: { minHeight: t.size.button.s, paddingHorizontal: t.size.buttonPaddingX.s - t.size.border.control, paddingVertical: t.space[4] },
  primary: { backgroundColor: t.color.bg.inverse },
  brand: { backgroundColor: t.color.accent.fill },
  brandPressed: { backgroundColor: t.color.accent.fillPressed },
  secondary: {
    backgroundColor: t.color.bg.raised,
    borderColor: t.color.border.default,
  },
  disabledFill: { backgroundColor: t.color.bg.raised },
  onPhoto: { borderColor: t.color.onPhoto.border },
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], justifyContent: 'center' },
  rowStacked: { flexDirection: 'column', gap: t.space[4] },
  hidden: { opacity: 0 },
  label: { flexShrink: 1, textAlign: 'center', ...LABEL_LAST_RESORT_BREAK },
  spinner: { alignItems: 'center', justifyContent: 'center' },
  layer: { borderRadius: t.radius.sm },
  layerHover: { backgroundColor: t.color.state.hover },
  layerPressed: { backgroundColor: t.color.state.pressed },
  layerPhoto: { backgroundColor: t.color.onPhoto.chipBg },
  // Text-only variants have no visible border, so the state layer fills it too and the shape stays the full 44.
  layerOverBorder: {
    bottom: -t.size.border.control,
    left: -t.size.border.control,
    right: -t.size.border.control,
    top: -t.size.border.control,
  },
}));

function foreground(variant: ButtonVariant, filled: boolean, disabled: boolean): ColorToken {
  if (disabled) return 'text.disabled';
  switch (variant) {
    case 'primary':
      return 'text.inverse';
    case 'brand':
      return 'text.onAccent';
    case 'destructive':
      return filled ? 'text.onAccent' : 'accent.fg';
    case 'onPhoto':
    case 'onPhotoText':
      return 'onPhoto.primary';
    default:
      return 'text.primary';
  }
}

/** §8: L / M / S are 52 / 44 / 36 high, radius 8. S reaches 44 through a real hit area. */
export function Button({
  label,
  onPress,
  role = 'button',
  href,
  variant = 'primary',
  size = 'l',
  filled = false,
  loading = false,
  disabled: disabledProp = false,
  locked,
  icon,
  fullWidth = false,
  flush,
  accessibilityLabel,
  style,
  testID,
  ref,
}: ButtonProps) {
  const styles = useStyles();
  // A locked button draws like a disabled one but still takes the press, which says why.
  const disabled = disabledProp || Boolean(locked);
  const isFilled = variant === 'primary' || variant === 'brand' || (variant === 'destructive' && filled);
  const isOnPhoto = variant === 'onPhoto' || variant === 'onPhotoText';
  const color = foreground(variant, filled, disabled);
  const smallType = size === 's';
  const outlined = variant === 'secondary' || variant === 'onPhoto';
  const labelVariant = smallType ? 'labelS' : 'label';

  // DQ-066: a label that wraps takes the whole width and centres inside it, which strands an icon beside it at the edge, so
  // the icon goes on its own line above. Stacking gives the label more room, so it stays until label, font or window change.
  const { fontScale } = useTheme();
  const { width: windowWidth } = useBreakpoint();
  const wrapKey = `${label}|${fontScale}|${windowWidth}`;
  const [stackedFor, setStackedFor] = useState<string | null>(null);
  const iconStacked = Boolean(icon) && flush === undefined && stackedFor === wrapKey;
  const measureLabel = (event: LayoutChangeEvent) => {
    const line = typeStyle(labelVariant, fontScale).lineHeight ?? 0;
    if (event.nativeEvent.layout.height > line * WRAPPED_LINES) setStackedFor(wrapKey);
  };

  const fill = (state: PressableVisualState): StyleProp<ViewStyle> => {
    if (disabled) {
      const textOnly = variant === 'tertiary' || variant === 'onPhotoText' || (variant === 'destructive' && !filled);
      return textOnly ? null : styles.disabledFill;
    }
    if (variant === 'primary') return styles.primary;
    if (variant === 'secondary') return styles.secondary;
    if (variant === 'onPhoto') return styles.onPhoto;
    if (isFilled) return state.pressed ? styles.brandPressed : styles.brand;
    return null;
  };

  return (
    <PressableScale
      ref={ref}
      role={role}
      {...(href === undefined ? {} : { href })}
      aria-label={accessibilityLabel ?? label}
      aria-busy={loading}
      aria-disabled={disabled || undefined}
      // Undefined, not false, while only locked: a `disabled` of false would override aria-disabled in the accessibility state,
      // and a true one would swallow the press that says why.
      disabled={disabledProp || undefined}
      feedback={!loading && !locked}
      ring={isOnPhoto ? 'onPhoto' : 'default'}
      visualHeight={smallType ? sizeTokens.button.s : undefined}
      onPress={(event) => {
        if (locked) {
          toast(locked, { testID: testID ? `${testID}.locked` : undefined });
          return;
        }
        if (!loading) onPress?.(event);
      }}
      testID={testID}
      style={(state) => [
        fullWidth ? styles.full : flush === undefined ? styles.hug : flush === 'end' ? styles.flushEnd : styles.flushStart,
        flush === undefined ? null : size === 'l' ? styles.flushL : size === 'm' ? styles.flushM : styles.flushS,
        isFilled && state.hovered ? styles.hoverDim : null,
        style,
      ]}
      contentStyle={(state) => [styles.content, styles[size], fill(state)]}
      contentDataSet={COMPENSATES_BORDER}
    >
      {(state) => (
        <>
          {!isFilled && !disabled && (state.pressed || state.hovered) ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                styles.layer,
                isOnPhoto ? styles.layerPhoto : state.pressed ? styles.layerPressed : styles.layerHover,
                outlined ? null : styles.layerOverBorder,
              ]}
            />
          ) : null}
          <View style={[styles.row, iconStacked ? styles.rowStacked : null, flush === undefined ? null : flush === 'end' ? styles.rowEnd : styles.rowStart, loading ? styles.hidden : null]}>
            {icon ? <Icon name={icon} size={smallType ? 16 : 20} color={color} /> : null}
            <Text variant={labelVariant} color={color} selectable={false} hyphenate={false} onLayout={icon && flush === undefined ? measureLabel : undefined} style={[styles.label, flush === undefined ? null : flush === 'end' ? styles.labelEnd : styles.labelStart]}>
              {label}
            </Text>
          </View>
          {loading ? (
            <View style={[StyleSheet.absoluteFill, styles.spinner]}>
              <Spinner decorative size={smallType ? 16 : 20} color={color} />
            </View>
          ) : null}
        </>
      )}
    </PressableScale>
  );
}
