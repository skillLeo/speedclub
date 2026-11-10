import { PixelRatio, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, typography, useTheme, type ColorToken } from '@/theme';

import { Icon } from './icons/Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { useFocusRing } from './useFocusRing';

export type SelectionControlProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name, and the visible text when `showLabel` is set. */
  label: string;
  showLabel?: boolean;
  /** With `showLabel`: the box lines up with the first line of a label that wraps instead of its middle (§8, DQ-111). */
  alignFirstLine?: boolean;
  disabled?: boolean;
  /**
   * False keeps the label's colour while disabled and dims only the box: for an option whose helper stays text.secondary under
   * it, which a text.disabled title would read weaker than (DQ-444, SET-07 offline).
   */
  dimLabel?: boolean;
  error?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  target: {
    alignItems: 'center',
    height: t.size.touchMin,
    justifyContent: 'center',
    width: t.size.touchMin,
  },
  row: { alignSelf: 'stretch', justifyContent: 'center', minHeight: t.size.touchMin },
  inner: { alignItems: 'center', flexDirection: 'row', flexGrow: 0, gap: t.space[12] },
  innerTop: { alignItems: 'flex-start' },
  firstLine: { justifyContent: 'center' },
  box: {
    alignItems: 'center',
    borderColor: t.color.border.control,
    borderWidth: t.size.border.control,
    height: t.size.checkbox,
    justifyContent: 'center',
    width: t.size.checkbox,
  },
  checkbox: { borderRadius: t.radius.xs },
  radio: { borderRadius: t.radius.full },
  checked: { backgroundColor: t.color.bg.inverse, borderColor: t.color.bg.inverse },
  error: { borderColor: t.color.accent.fg },
  disabled: { borderColor: t.color.border.default },
  checkedDisabled: { backgroundColor: t.color.text.disabled, borderColor: t.color.text.disabled },
  hover: { backgroundColor: t.color.state.hover },
  dot: { backgroundColor: t.color.text.inverse, borderRadius: t.radius.full, height: t.space[8], width: t.space[8] },
  label: { flexShrink: 1 },
}));

/** §8: 22 visual inside a 44 target; radius 4 or full, 1 border.control; checked = bg.inverse + text.inverse glyph. */
export function SelectionControl({
  shape,
  checked,
  onChange,
  label,
  showLabel = false,
  alignFirstLine = false,
  disabled = false,
  dimLabel = true,
  error = false,
  style,
  testID,
}: SelectionControlProps & { shape: 'checkbox' | 'radio' }) {
  const styles = useStyles();
  const focus = useFocusRing();
  const theme = useTheme();
  const glyph: ColorToken = 'text.inverse';
  const topAligned = showLabel && alignFirstLine;
  // As tall as the label's first line at the font scale it renders with (body has no cap), so the box centres on it.
  const lineHeight = typography.body.lineHeight * (isWeb ? theme.fontScale : PixelRatio.getFontScale());

  return (
    <PressableScale
      role={shape}
      aria-label={label}
      aria-checked={checked}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
      ring="none"
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      onPress={() => {
        haptics.selection();
        onChange(shape === 'radio' ? true : !checked);
      }}
      testID={testID}
      style={[showLabel ? styles.row : styles.target, style]}
      contentStyle={[styles.inner, topAligned ? styles.innerTop : null]}
    >
      {(state) => {
        const box = (
          <View
            style={[
              styles.box,
              styles[shape],
              !checked && state.hovered ? styles.hover : null,
              error ? styles.error : null,
              disabled ? styles.disabled : null,
              checked ? (disabled ? styles.checkedDisabled : styles.checked) : null,
              focus.ringStyle,
            ]}
          >
            {checked && shape === 'checkbox' ? <Icon name="check" size={16} color={glyph} /> : null}
            {checked && shape === 'radio' ? <View style={styles.dot} /> : null}
          </View>
        );
        return (
          <>
            {topAligned ? <View style={[styles.firstLine, { height: lineHeight }]}>{box}</View> : box}
            {showLabel ? (
              <Text variant="body" color={disabled && dimLabel ? 'text.disabled' : 'text.primary'} selectable={false} style={styles.label}>
                {label}
              </Text>
            ) : null}
          </>
        );
      }}
    </PressableScale>
  );
}
