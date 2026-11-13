/**
 * OTPInput (09 §5): six cells drawn over one real input, so paste, one-time-code autofill (iOS `oneTimeCode`, Android and web
 * `one-time-code`), screen readers and the web keyboard all work without moving focus from cell to cell.
 *
 * Error: the row shakes horizontally (spring.fast impulse; none under reduced motion) with the warning haptic, each time
 * `errorKey` changes — the screen clears the value. Success: the digits resolve into one check (effect.default) with the success
 * haptic.
 */
import { useEffect, useImperativeHandle, useRef, useState, type ComponentRef, type Ref } from 'react';
import { TextInput as RNTextInput, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, resolveColor, size, space, useTheme } from '@/theme';

import { Icon } from './icons/Icon';
import { useMotionPreference } from './motion';
import { SkeletonBlock } from './Skeleton';
import { Text, typeStyle } from './Text';

export const OTP_LENGTH = 6;

type InputRef = ComponentRef<typeof RNTextInput>;
type WebField = { focus: (options: { preventScroll: boolean }) => void; scrollIntoView?: (options: { block: 'nearest' }) => void };

/** The impulse of the error shake: the row is pushed this far and springs back through zero. */
const SHAKE_OFFSET = space[12];

/** DQ-151: what stays free under the field when the screen scrolls it into view. */
const scrollMargin = (bottom: number) => ({ scrollMarginBottom: bottom }) as TextStyle;

/** What a typed, pasted or autofilled value holds: digits, at most `length`. A pasted "123 456" counts as a code. */
export function sanitizeOtp(text: string, length: number = OTP_LENGTH): string {
  return text.replace(/\D/g, '').slice(0, length);
}

const useStyles = createStyles((t) => ({
  root: { gap: t.space[8] },
  row: { position: 'relative' },
  cells: { flexDirection: 'row', gap: t.space[8] },
  // DQ-992 (09 §5): portrait cells of `size.otpCell` 48 × 56, narrower only where six do not fit (360: about 47), from the start.
  width: { maxWidth: '100%' },
  cell: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderColor: t.color.border.control,
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    flex: 1,
    justifyContent: 'center',
    maxWidth: t.size.otpCell.width,
    minHeight: t.size.otpCell.height,
    minWidth: 0,
  },
  cellActive: { borderColor: t.color.text.primary, borderWidth: t.size.border.inputFocus },
  cellError: { borderColor: t.color.accent.fg },
  cellInert: { backgroundColor: t.color.bg.canvas, borderColor: t.color.border.subtle },
  check: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  // Over the whole row, so a tap on any cell focuses it and text selection stays out of sight.
  input: {
    bottom: 0,
    color: 'transparent',
    left: 0,
    opacity: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '100%',
  },
  skeletonCell: { flex: 1, maxWidth: t.size.otpCell.width },
  note: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[4] },
  noteIcon: { paddingTop: t.space[2] },
  noteText: { flexShrink: 1 },
}));

/** The row of `length` full cells and their gaps; a narrower column shrinks the cells. */
export function otpRowWidth(length: number): number {
  return length * size.otpCell.width + (length - 1) * space[8];
}

/** The cells as skeleton blocks, for the loading state of the screens around it (same geometry). */
export function OTPInputSkeleton({ length = OTP_LENGTH }: { length?: number }) {
  const styles = useStyles();
  return (
    <View style={[styles.cells, { width: otpRowWidth(length) }, styles.width]}>
      {Array.from({ length }, (_, index) => (
        <View key={index} style={styles.skeletonCell}>
          <SkeletonBlock height={size.otpCell.height} corner="sm" />
        </View>
      ))}
    </View>
  );
}

export type OTPInputProps = {
  value: string;
  onChange: (code: string) => void;
  /** Runs once all digits are there, typed or pasted (auto-submit). */
  onComplete?: (code: string) => void;
  onBlur?: () => void;
  /** The accessible name of the one real input behind the cells. */
  label: string;
  error?: string;
  /** A new value shakes the row and plays the warning haptic (a refused code). */
  errorKey?: number;
  /** The code was accepted: the digits resolve into a check. */
  success?: boolean;
  disabled?: boolean;
  /**
   * DQ-1004: the field cannot take a code for a while (the lock after too many wrong ones): disabled, and drawn in the disabled tone
   * (border.subtle on the canvas, no active ring) so the cells do not look ready. `disabled` alone (a code being checked) keeps the tone.
   */
  inert?: boolean;
  autoFocus?: boolean;
  length?: number;
  /** The input takes this ID; `.cell{n}`, `.error` and `.check` are added. */
  testID?: string;
  ref?: Ref<InputRef>;
};

export function OTPInput({
  value,
  onChange,
  onComplete,
  onBlur,
  label,
  error,
  errorKey,
  success = false,
  disabled = false,
  inert = false,
  autoFocus,
  length = OTP_LENGTH,
  testID,
  ref,
}: OTPInputProps) {
  const styles = useStyles();
  const theme = useTheme();
  const motion = useMotionPreference();
  const [focused, setFocused] = useState(false);
  const lastCompleted = useRef<string | null>(null);
  const input = useRef<InputRef>(null);
  useImperativeHandle(ref, () => input.current as InputRef, []);

  const shift = useSharedValue(0);
  const resolved = useSharedValue(success ? 1 : 0);
  const firstErrorKey = useRef(errorKey);

  // DQ-151: the browser centres an autofocused field, which at 200 % opens the screen in the middle of its first sentence. On web the
  // field takes focus without that scroll; native keeps its own behaviour, where the keyboard decides.
  useEffect(() => {
    if (!isWeb || !autoFocus) return;
    const field = input.current as unknown as WebField | null;
    field?.focus({ preventScroll: true });
    field?.scrollIntoView?.({ block: 'nearest' });
    // Only on arrival: a later change of the prop must not take the focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A refused code: one shake and one warning haptic per refusal, never on mount.
  useEffect(() => {
    if (errorKey === undefined || errorKey === firstErrorKey.current) return;
    firstErrorKey.current = errorKey;
    haptics.warning();
    if (motion.reduced) return;
    shift.set(SHAKE_OFFSET);
    shift.set(motion.springTo(0, 'fast'));
  }, [errorKey, motion, shift]);

  useEffect(() => {
    resolved.set(motion.effectTo(success ? 1 : 0, 'default'));
    if (success) haptics.success();
  }, [motion, resolved, success]);

  // Six digits complete once, as long as they stay. A screen can empty the field from outside, as after a refusal: the same code
  // pasted again is then a new attempt (BH-31).
  useEffect(() => {
    if (value.length < length) lastCompleted.current = null;
  }, [length, value]);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.get() }] }));
  const digitsStyle = useAnimatedStyle(() => ({ opacity: 1 - resolved.get() }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: resolved.get() }));

  // Invisible, but still the field the browser renders and measures: it takes the type scale like every input.
  const inputType = typeStyle('input', isWeb ? theme.fontScale : 1, undefined, false);
  const activeIndex = Math.min(value.length, length - 1);
  const digits = Array.from({ length }, (_, index) => value[index] ?? '');

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.row, { width: otpRowWidth(length) }, styles.width, rowStyle]}>
        <Animated.View style={[styles.cells, digitsStyle]}>
          {digits.map((digit, index) => (
            <View
              key={index}
              aria-hidden
              style={[
                styles.cell,
                inert ? styles.cellInert : null,
                error && !inert ? styles.cellError : null,
                focused && !success && !inert && index === activeIndex ? styles.cellActive : null,
              ]}
              testID={testID ? `${testID}.cell${index}` : undefined}
            >
              <Text variant="title2" numeric selectable={false} hyphenate={false}>
                {digit}
              </Text>
            </View>
          ))}
        </Animated.View>
        {success ? (
          <Animated.View aria-hidden style={[styles.check, checkStyle]} testID={testID ? `${testID}.check` : undefined}>
            <Icon name="check" size={24} color="text.primary" />
          </Animated.View>
        ) : null}
        <RNTextInput
          ref={input}
          value={value}
          onChangeText={(text) => {
            const code = sanitizeOtp(text, length);
            onChange(code);
            if (code.length < length) {
              lastCompleted.current = null;
            } else if (lastCompleted.current !== code) {
              lastCompleted.current = code;
              onComplete?.(code);
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          editable={!disabled && !inert && !success}
          autoFocus={isWeb ? undefined : autoFocus}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-disabled={disabled || inert}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoCorrect={false}
          spellCheck={false}
          maxLength={isWeb ? undefined : length}
          caretHidden
          selectionColor={resolveColor(theme, 'bg.raised')}
          style={[inputType, styles.input, isWeb ? scrollMargin(theme.space[16]) : null]}
          testID={testID}
        />
      </Animated.View>
      {error ? (
        <View style={styles.note}>
          <View style={styles.noteIcon}>
            <Icon name="warning" size={16} color="accent.fg" />
          </View>
          <Text variant="caption" color="accent.fg" role="alert" style={styles.noteText} testID={testID ? `${testID}.error` : undefined}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
