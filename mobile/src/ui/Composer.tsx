import { useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { TextInput as RNTextInput, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, resolveColor, space, useBreakpoint, useTheme } from '@/theme';

import { FieldSurface } from './FieldSurface';
import { IconButton } from './IconButton';
import { Icon } from './icons/Icon';
import { PressableScale } from './PressableScale';
import { useForcedVisualState, WithoutForcedState } from './qaVisualState';
import { Spinner } from './Spinner';
import { Text, typeStyle } from './Text';
import { InputLineMeasure, MEASURE_MIRROR, multilineMaxHeight, resolveRows, useDrawnLine } from './TextInput';
import { NO_BROWSER_OUTLINE } from './useFocusRing';

type InputRef = ComponentRef<typeof RNTextInput>;

const HIT_WRAPPER = { qaHitWrapper: 'true' } as const;

/** The type role of the field and of the web mirror that sizes it (ADR-420 `input`). They must be one role (DQ-803). */
export const COMPOSER_TEXT_ROLE = 'input' as const;

export type ComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  /** Called with the trimmed text. The parent clears `value` (optimistic send). */
  onSend: (text: string) => void;
  /** Placeholder and the accessible name of the field. */
  placeholder: string;
  sendLabel: string;
  /** Shows the attach button; takes `attachLabel`. */
  onAttach?: () => void;
  attachLabel?: string;
  disabled?: boolean;
  /** The message is on its way: a spinner replaces the send glyph and presses are ignored. */
  sending?: boolean;
  maxLength?: number;
  /** Above the field, inside the composer's ground: the reply quote bar (09 §7.8 swipe-to-reply). */
  header?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  ref?: Ref<InputRef>;
};

const useStyles = createStyles((t) => {
  // Equal to `full` at the minimum height. It keeps that curve as the field grows, where a real `full` would round
  // the whole 5-line field off and cut into the first and last line.
  const curve = t.size.composerMin / 2;
  return {
    root: { alignItems: 'flex-end', flexDirection: 'row', gap: t.space[8], paddingVertical: t.space[8] },
    field: {
      backgroundColor: t.color.bg.raised,
      borderRadius: curve,
      flex: 1,
      justifyContent: 'center',
      minHeight: t.size.composerMin,
      minWidth: 0,
      paddingHorizontal: t.space[16],
    },
    // 8 + 24 + 8 is 40. §8 and the touch target need 44, and 10 is off the spacing scale, so a transparent border takes
    // the other 2 on each side: the field itself reaches 44 with the text in the middle. DQ-034: padding and border belong
    // to the field, not to the scrolling text, so a text longer than 5 lines ends at the text box, without a cut line below.
    box: {
      alignSelf: 'stretch',
      borderBottomWidth: t.space[2],
      borderColor: 'transparent',
      borderTopWidth: t.space[2],
      paddingVertical: t.space[8],
    },
    textBox: { minWidth: 0 },
    input: {
      alignSelf: 'stretch',
      minWidth: 0,
      ...NO_BROWSER_OUTLINE,
      padding: 0,
      textAlignVertical: 'top',
    },
    inputOverMirror: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    mirror: { opacity: 0, overflow: 'hidden', pointerEvents: 'none' },
    frame: {
      borderColor: t.color.text.primary,
      borderRadius: curve,
      borderWidth: t.size.border.inputFocus,
      pointerEvents: 'none',
    },
    send: { alignItems: 'center', height: t.size.touchMin, justifyContent: 'center', width: t.size.touchMin },
    sendVisual: {
      alignItems: 'center',
      // 09 §7.8: the send button is an accent-filled circle while it can send (a 44 disc, far under the 5 % red budget).
      backgroundColor: t.color.accent.fill,
      borderRadius: t.radius.full,
      flexGrow: 0,
      height: t.size.touchMin,
      justifyContent: 'center',
      width: t.size.touchMin,
    },
    sendDisabled: { backgroundColor: t.color.bg.raised },
    hoverDim: { opacity: t.opacity.pressed },
  };
});

type WebKeyEvent = {
  preventDefault?: () => void;
  nativeEvent: { key?: string; shiftKey?: boolean; isComposing?: boolean };
};

/** Web: Enter sends, Shift+Enter makes a new line, and Enter that confirms an input-method word does neither. */
export function sendsOnKey({ nativeEvent }: WebKeyEvent): boolean {
  return nativeEvent.key === 'Enter' && !nativeEvent.shiftKey && !nativeEvent.isComposing;
}

/**
 * §8 composer: at least 44, grows to 5 lines, then scrolls; attach 44; send 44 circle, disabled until there is text.
 * Render it edge to edge. It brings the screen gutter like the header: the plus sits on the gutter (minus the 12 of air
 * inside its 44 target), the send circle ends on the gutter, where the sender's own bubbles end.
 */
export function Composer({
  value,
  onChangeText,
  onSend,
  placeholder,
  sendLabel,
  onAttach,
  attachLabel,
  disabled = false,
  sending = false,
  maxLength,
  header,
  style,
  testID,
  ref,
}: ComposerProps) {
  const styles = useStyles();
  const theme = useTheme();
  const { gutter } = useBreakpoint();
  const forced = useForcedVisualState();
  const [inputFocused, setFocused] = useState(false);
  const focused = inputFocused || (forced?.focused ?? false);
  const part = (name: string) => (testID ? `${testID}.${name}` : undefined);
  const canAttach = Boolean(onAttach && attachLabel);

  const text = value.trim();
  const canSend = text.length > 0 && !disabled && !sending;
  const send = () => {
    if (canSend) onSend(text);
  };

  const scale = theme.fontScale;
  // 16/24 (input) and not body: Safari on iOS zooms the page when a focused field has text below 16.
  const body = typeStyle(COMPOSER_TEXT_ROLE, isWeb ? scale : 1, undefined, false);
  // At most `composerMaxLines` whole drawn lines (A7, round-3 review): web scales the role linearly (24 × the QA scale); native
  // measures one line of the role, as Android 14+ draws the 24 sp line at 36 at font scale 2.0, not 48. A cap in unscaled dp
  // (24 × 2 × 5 = 240) would then end inside the seventh line and show it cut.
  const { drawnLine, onMeasure } = useDrawnLine(scale);
  const maxHeight = multilineMaxHeight(drawnLine, resolveRows(theme.size.composerMaxLines, drawnLine));
  const inputRef = useRef<InputRef | null>(null);
  const attachRef = (node: InputRef | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  const row = (
    <View testID={header ? undefined : testID} style={[styles.root, { paddingLeft: canAttach ? gutter - space[12] : gutter, paddingRight: gutter }, header ? null : style]}>
      {onAttach && attachLabel ? (
        <WithoutForcedState>
          <IconButton icon="plus" label={attachLabel} onPress={onAttach} disabled={disabled} color="text.secondary" testID={part('attach')} />
        </WithoutForcedState>
      ) : null}
      <FieldSurface disabled={disabled} onPress={() => inputRef.current?.focus()} style={styles.field} testID={part('field')}>
        {/* A press on the padding focuses the text, so the DOM audit measures this box and not the text (one row is 24 high). */}
        <View style={styles.box} dataSet={isWeb ? HIT_WRAPPER : undefined} testID={part('box')}>
          <View style={styles.textBox}>
            {/* Web's textarea has no intrinsic height: a hidden copy of the text sizes it. Native grows by itself. DQ-038: an empty
                field is as tall as its placeholder, which may wrap at a large font, so that one is not cut either. */}
            {isWeb ? (
              <View aria-hidden style={[styles.mirror, { maxHeight }]}>
                {/* DQ-803: the textarea's own role (input, 16/24), so one line is 24 and the hit box 44, as on native. */}
                <Text variant={COMPOSER_TEXT_ROLE} hyphenate={false} dataSet={MEASURE_MIRROR}>{`${value || placeholder}​`}</Text>
              </View>
            ) : null}
            <RNTextInput
              ref={attachRef}
              multiline
              numberOfLines={isWeb ? 1 : undefined}
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              aria-label={placeholder}
              aria-disabled={disabled}
              editable={!disabled}
              maxLength={maxLength}
              submitBehavior="newline"
              placeholderTextColor={resolveColor(theme, 'text.tertiary')}
              selectionColor={resolveColor(theme, 'text.primary')}
              cursorColor={resolveColor(theme, 'text.primary')}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyPress={(event) => {
                if (!isWeb) return;
                const key = event as unknown as WebKeyEvent;
                if (sendsOnKey(key)) {
                  key.preventDefault?.();
                  send();
                }
              }}
              testID={part('input')}
              style={[
                body,
                { color: resolveColor(theme, disabled ? 'text.disabled' : 'text.primary'), maxHeight },
                styles.input,
                isWeb ? styles.inputOverMirror : null,
              ]}
            />
            {isWeb ? null : <InputLineMeasure onMeasure={onMeasure} />}
          </View>
        </View>
        {focused ? <View style={[StyleSheet.absoluteFill, styles.frame]} /> : null}
      </FieldSurface>
      <WithoutForcedState>
        <PressableScale
          role="button"
          aria-label={sendLabel}
          aria-busy={sending}
          disabled={!canSend}
          onPress={send}
          testID={part('send')}
          style={(state) => [styles.send, canSend && state.hovered ? styles.hoverDim : null]}
          contentStyle={[styles.sendVisual, canSend || sending ? null : styles.sendDisabled]}
        >
          {sending ? (
            <Spinner decorative size={20} color="text.onAccent" />
          ) : (
            <Icon name="arrow-right" size={20} color={canSend ? 'text.onAccent' : 'text.disabled'} />
          )}
        </PressableScale>
      </WithoutForcedState>
    </View>
  );
  return header ? (
    <View testID={testID} style={style}>
      {header}
      {row}
    </View>
  ) : (
    row
  );
}
