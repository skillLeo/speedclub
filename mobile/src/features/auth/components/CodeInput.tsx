import { useEffect, useImperativeHandle, useRef, useState, type ComponentRef, type Ref } from 'react';
import { TextInput as RNTextInput, View, type TextStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, resolveColor, size, useTheme } from '@/theme';
import { Icon, SkeletonBlock, Text } from '@/ui';
import { typeStyle } from '@/ui/Text';

import { sanitizeCode } from '../code';
import { CODE_LENGTH } from '../schemas';

type InputRef = ComponentRef<typeof RNTextInput>;
type WebField = { focus: (options: { preventScroll: boolean }) => void; scrollIntoView?: (options: { block: 'nearest' }) => void };

/** DQ-151: what stays free under the field when the screen scrolls it into view. */
const scrollMargin = (bottom: number) => ({ scrollMarginBottom: bottom }) as TextStyle;

const useStyles = createStyles((t) => ({
  root: { gap: t.space[8] },
  cells: { flexDirection: 'row', gap: t.space[8] },
  cell: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderColor: t.color.border.control,
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    flex: 1,
    justifyContent: 'center',
    minHeight: t.size.input,
    minWidth: 0,
  },
  cellActive: { borderColor: t.color.text.primary, borderWidth: t.size.border.inputFocus },
  cellError: { borderColor: t.color.accent.fg },
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
  skeletonCell: { flex: 1 },
  note: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[4] },
  noteIcon: { paddingTop: t.space[2] },
  noteText: { flexShrink: 1 },
}));


/** The six cells as skeleton blocks, for the loading state of the screens around it. */
export function CodeInputSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.cells}>
      {Array.from({ length: CODE_LENGTH }, (_, index) => (
        <View key={index} style={styles.skeletonCell}>
          <SkeletonBlock height={size.input} corner="sm" />
        </View>
      ))}
    </View>
  );
}

export type CodeInputProps = {
  value: string;
  onChange: (code: string) => void;
  /** Runs once all six digits are there, typed or pasted. */
  onComplete?: (code: string) => void;
  onBlur?: () => void;
  /** The accessible name of the one real input behind the cells. */
  label: string;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** The input takes this ID; `.error` is added for the message. */
  testID?: string;
  ref?: Ref<InputRef>;
};

/**
 * Six cells drawn over a single real input. That one input is why paste, one-time-code autofill, screen readers and the web
 * keyboard (backspace, selection) all simply work: nothing has to be moved from cell to cell.
 */
export function CodeInput({ value, onChange, onComplete, onBlur, label, error, disabled = false, autoFocus, testID, ref }: CodeInputProps) {
  const styles = useStyles();
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const lastCompleted = useRef<string | null>(null);
  const input = useRef<InputRef>(null);
  useImperativeHandle(ref, () => input.current as InputRef, []);
  // DQ-151: the browser centres an autofocused field, which at 200 % opens the screen in the middle of its first sentence. On web the
  // field takes focus without that scroll, and the screen moves only as far as it takes to show it. Native keeps its own behaviour,
  // where the keyboard decides.
  useEffect(() => {
    if (!isWeb || !autoFocus) return;
    const field = input.current as unknown as WebField | null;
    field?.focus({ preventScroll: true });
    field?.scrollIntoView?.({ block: 'nearest' });
    // Only on arrival: a later change of the prop must not take the focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Invisible, but still the field the browser renders and measures: it takes the type scale like every input.
  const inputType = typeStyle('body', isWeb ? theme.fontScale : 1, undefined, false);
  // Six digits complete once, as long as they stay. A screen can empty the field from outside, without a change event, as after a
  // refusal: the same code pasted again is then a new attempt, and the mail may well hold nothing else (BH-31).
  useEffect(() => {
    if (value.length < CODE_LENGTH) lastCompleted.current = null;
  }, [value]);
  const activeIndex = Math.min(value.length, CODE_LENGTH - 1);
  const digits = Array.from({ length: CODE_LENGTH }, (_, index) => value[index] ?? '');

  return (
    <View style={styles.root}>
      <View style={styles.cells}>
        {digits.map((digit, index) => (
          <View
            key={index}
            aria-hidden
            style={[
              styles.cell,
              error ? styles.cellError : null,
              focused && index === activeIndex ? styles.cellActive : null,
            ]}
            testID={testID ? `${testID}.cell${index}` : undefined}
          >
            <Text variant="specStrip" selectable={false} hyphenate={false}>
              {digit}
            </Text>
          </View>
        ))}
        <RNTextInput
          ref={input}
          value={value}
          onChangeText={(text) => {
            const code = sanitizeCode(text);
            onChange(code);
            if (code.length < CODE_LENGTH) {
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
          editable={!disabled}
          autoFocus={isWeb ? undefined : autoFocus}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-disabled={disabled}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoCorrect={false}
          spellCheck={false}
          maxLength={isWeb ? undefined : CODE_LENGTH}
          caretHidden
          selectionColor={resolveColor(theme, 'bg.raised')}
          style={[inputType, styles.input, isWeb ? scrollMargin(theme.space[16]) : null]}
          testID={testID}
        />
      </View>
      {error ? (
        <View style={styles.note}>
          <View style={styles.noteIcon}>
            <Icon name="warning" size={16} color="accent.fg" />
          </View>
          <Text variant="helper" color="accent.fg" role="alert" style={styles.noteText} testID={testID ? `${testID}.error` : undefined}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
