import { useId, useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TextInput as RNTextInput,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextInputProps as RNTextInputProps,
  type ViewStyle,
} from 'react-native';

import { isIOS, isWeb } from '@/lib/platform';
import { createStyles, resolveColor, size, typography, useTheme } from '@/theme';

import { FieldSurface } from './FieldSurface';
import { IconButton } from './IconButton';
import { Icon } from './icons/Icon';
import { useForcedVisualState } from './qaVisualState';
import { Spinner } from './Spinner';
import { Text, typeStyle } from './Text';
import { FIELD_ELLIPSIS, NO_BROWSER_OUTLINE } from './useFocusRing';

type InputRef = ComponentRef<typeof RNTextInput>;

export type TextInputProps = Omit<RNTextInputProps, 'style' | 'editable' | 'secureTextEntry' | 'aria-label'> & {
  /** Shown above the field and used as its accessible name. */
  label: string;
  /** Hint below the field; an error replaces it. */
  helper?: string;
  /** Error text: border, icon and text together, never colour alone. */
  error?: string;
  /** Unit after the value, for example "cm³". */
  suffix?: string;
  /** Password field with the show/hide toggle. */
  secure?: boolean;
  /** Grows with the content up to `maxRows`, then scrolls. */
  multiline?: boolean;
  maxRows?: number;
  disabled?: boolean;
  /** A spinner at the end of the field, for example while a value is checked. */
  loading?: boolean;
  /** Replaces the show/hide labels from namespace common. */
  showLabel?: string;
  hideLabel?: string;
  /** Trailing element inside the field. */
  trailing?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  ref?: Ref<InputRef>;
};

const DEFAULT_MAX_ROWS = 6;
const HIT_WRAPPER = { qaHitWrapper: 'true' } as const;

const useStyles = createStyles((t) => ({
  root: { gap: t.space[8] },
  field: {
    alignItems: 'stretch',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.sm,
    flexDirection: 'row',
    gap: t.space[8],
    minHeight: t.size.input,
    paddingHorizontal: t.space[16],
  },
  fieldCompactEnd: { paddingRight: t.space[4] },
  frame: {
    borderColor: t.color.border.control,
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    pointerEvents: 'none',
  },
  frameHover: { borderColor: t.color.text.secondary },
  frameFocus: { borderColor: t.color.text.primary, borderWidth: t.size.border.inputFocus },
  frameError: { borderColor: t.color.accent.fg },
  frameDisabled: { borderColor: t.color.border.default },
  inputBox: { flex: 1, justifyContent: 'center', minWidth: 0 },
  // DQ-153: the 12 above and below a multiline text belong to the field, not to the scrolling text, so a text longer than
  // `maxRows` ends at the content box instead of showing a cut line in the padding.
  inputBoxMultiline: { paddingVertical: t.space[12] },
  input: { flex: 1, minWidth: 0, ...NO_BROWSER_OUTLINE, padding: 0 },
  inputSingleLine: FIELD_ELLIPSIS,
  inputMultiline: { textAlignVertical: 'top' },
  mirrorBox: { minWidth: 0 },
  inputOverMirror: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  mirror: { opacity: 0, overflow: 'hidden', pointerEvents: 'none' },
  end: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: t.space[8] },
  note: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[4], marginTop: -t.space[4] },
  noteText: { flexShrink: 1 },
  noteIcon: { paddingTop: t.space[2] },
}));

/**
 * DQ-095: a browser draws a border in whole device pixels, so at a low pixel ratio 1.5 looks exactly like the resting 1. A
 * normal field still shows focus by its colour, but a field with an error keeps its colour in focus, so its frame would not
 * change at all: on such a screen it is 2 wide.
 */
export function errorFocusWidth(pixelRatio: number, web: boolean = isWeb): number {
  const { control, focusRing, inputFocus } = size.border;
  const distinct = Math.floor(pixelRatio * inputFocus) > Math.floor(pixelRatio * control);
  return web && !distinct ? focusRing : inputFocus;
}

/**
 * §8 text input: 52 high, radius 8, label above, helper or error below, focus border 1.5. The border lives on an
 * overlay, so 1 → 1.5 never shifts the text. With React Hook Form, inside a Controller:
 *
 *   <TextInput ref={field.ref} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur}
 *     label={t('…')} error={fieldState.error?.message} />
 */
export function TextInput({
  label,
  helper,
  error,
  suffix,
  secure = false,
  multiline = false,
  maxRows = DEFAULT_MAX_ROWS,
  disabled = false,
  loading = false,
  showLabel,
  hideLabel,
  trailing,
  containerStyle,
  testID,
  ref,
  onFocus,
  onBlur,
  onChangeText,
  value,
  defaultValue,
  placeholderTextColor,
  ...rest
}: TextInputProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const theme = useTheme();
  const forced = useForcedVisualState();
  const [inputFocused, setFocused] = useState(false);
  const focused = inputFocused || (forced?.focused ?? false);
  const [hovered, setHovered] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [uncontrolledText, setUncontrolledText] = useState(defaultValue ?? '');
  const noteId = useId();
  const { scale: pixelRatio } = useWindowDimensions();
  const inputRef = useRef<InputRef | null>(null);
  const attachRef = (node: InputRef | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  const scale = isWeb ? theme.fontScale : 1;
  const body = typeStyle('body', scale, undefined, false);
  const rowHeight = typography.body.lineHeight * scale;
  // The text's own box: the field's vertical padding sits outside it (inputBoxMultiline).
  const maxHeight = rowHeight * maxRows;
  // A single-line iOS field misplaces its text when it has a line height.
  const textStyle = isIOS && !multiline ? { ...body, lineHeight: undefined } : body;
  const color = disabled ? 'text.disabled' : 'text.primary';
  const note = error ?? helper;
  const hasToggle = secure && !disabled;
  // Web's textarea has no intrinsic height: a hidden copy of the text sizes the field. Native grows by itself.
  const mirrored = multiline && isWeb;
  // DQ-153: an empty field is as tall as its placeholder, which may wrap.
  const mirrorText = (value ?? uncontrolledText) || rest.placeholder || '';
  const describedBy = isWeb && note ? ({ 'aria-describedby': noteId } as object) : {};

  const input = (
    <RNTextInput
      ref={attachRef}
      {...rest}
      {...describedBy}
      value={value}
      defaultValue={defaultValue}
      testID={testID}
      aria-label={suffix ? `${label} (${suffix})` : label}
      aria-disabled={disabled}
      aria-invalid={error ? true : undefined}
      aria-busy={loading}
      editable={!disabled}
      multiline={multiline}
      numberOfLines={multiline && isWeb ? 1 : rest.numberOfLines}
      secureTextEntry={secure && !revealed}
      autoCapitalize={secure ? 'none' : rest.autoCapitalize}
      autoCorrect={secure ? false : rest.autoCorrect}
      placeholderTextColor={placeholderTextColor ?? resolveColor(theme, 'text.tertiary')}
      selectionColor={resolveColor(theme, 'text.primary')}
      cursorColor={resolveColor(theme, 'text.primary')}
      onChangeText={(text) => {
        if (value === undefined) setUncontrolledText(text);
        onChangeText?.(text);
      }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[
        textStyle,
        { color: resolveColor(theme, color) },
        styles.input,
        multiline ? styles.inputMultiline : styles.inputSingleLine,
        multiline ? { maxHeight } : null,
        mirrored ? styles.inputOverMirror : null,
      ]}
    />
  );

  return (
    <View style={[styles.root, containerStyle]}>
      <Text variant="labelS" color="text.secondary">
        {label}
      </Text>
      <FieldSurface
        testID={testID ? `${testID}.field` : undefined}
        disabled={disabled}
        onPress={() => inputRef.current?.focus()}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[styles.field, hasToggle || trailing ? styles.fieldCompactEnd : null]}
      >
        {/* The padded box is the multiline field's target: a press in its padding focuses the text through FieldSurface,
            so the DOM audit measures the box and not the text alone (one row is 24 high). */}
        <View style={[styles.inputBox, multiline ? styles.inputBoxMultiline : null]} dataSet={mirrored ? HIT_WRAPPER : undefined}>
          {mirrored ? (
            // The textarea covers the copy's box exactly: the copy sizes it, and both end at the content box.
            <View style={styles.mirrorBox}>
              <View aria-hidden style={[styles.mirror, { maxHeight }]}>
                <Text variant="body" hyphenate={false}>{`${mirrorText}​`}</Text>
              </View>
              {input}
            </View>
          ) : (
            input
          )}
        </View>
        {suffix || loading || hasToggle || trailing ? (
          <View style={styles.end}>
            {suffix ? (
              <Text variant="body" color="text.secondary">
                {suffix}
              </Text>
            ) : null}
            {loading ? <Spinner decorative size={16} color="text.secondary" /> : null}
            {hasToggle ? (
              <IconButton
                icon={revealed ? 'eye-slash' : 'eye'}
                label={revealed ? (hideLabel ?? t('actions.hidePassword')) : (showLabel ?? t('actions.showPassword'))}
                color="text.secondary"
                // DQ-113, ADR-118: 4 from the frame, an outer ring would end on it and merge with a red error frame.
                ring="inset"
                onPress={() => setRevealed((shown) => !shown)}
                testID={testID ? `${testID}.toggle` : undefined}
              />
            ) : null}
            {trailing}
          </View>
        ) : null}
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.frame,
            disabled ? styles.frameDisabled : null,
            !disabled && hovered ? styles.frameHover : null,
            focused ? styles.frameFocus : null,
            error ? styles.frameError : null,
            error && focused ? { borderWidth: errorFocusWidth(pixelRatio) } : null,
          ]}
        />
      </FieldSurface>
      {note ? (
        <View style={styles.note} nativeID={noteId}>
          {error ? (
            <View style={styles.noteIcon}>
              <Icon name="warning" size={16} color="accent.fg" />
            </View>
          ) : null}
          <Text
            variant="helper"
            color={error ? 'accent.fg' : 'text.secondary'}
            role={error ? 'alert' : undefined}
            testID={testID ? `${testID}.${error ? 'error' : 'helper'}` : undefined}
            style={styles.noteText}
          >
            {note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
