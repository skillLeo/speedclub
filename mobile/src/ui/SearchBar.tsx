import { useEffect, useRef, useState, type ComponentRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TextInput as RNTextInput,
  StyleSheet,
  View,
  type StyleProp,
  type TextInputProps as RNTextInputProps,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { isIOS, isWeb } from '@/lib/platform';
import { createStyles, resolveColor, useBreakpoint, useMotion, useTheme } from '@/theme';

import { FieldSurface } from './FieldSurface';
import { Icon } from './icons/Icon';
import { PressableScale } from './PressableScale';
import { useForcedVisualState, WithoutForcedState } from './qaVisualState';
import { useStacksAtFontScale } from './rowParts';
import { Text, typeStyle } from './Text';
import { FIELD_ELLIPSIS, NO_BROWSER_OUTLINE, useFocusRing } from './useFocusRing';

type InputRef = ComponentRef<typeof RNTextInput>;
type RootRef = ComponentRef<typeof View>;
type FocusLoss = { relatedTarget?: unknown; target?: unknown };
type FocusTarget = { target?: unknown };
type RootFocusEvent = FocusLoss & { currentTarget?: unknown };
type RootKeyEvent = {
  target?: unknown;
  currentTarget?: unknown;
  preventDefault: () => void;
  nativeEvent: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };
};

/** Web only, where the ref of a View is its DOM node. */
function contains(root: RootRef | null, node: unknown): boolean {
  return node instanceof Node && ((root as unknown as HTMLElement | null)?.contains(node) ?? false);
}

// React Native Web reports a press 50 ms after the pointer goes down, and the field blurs at once. Reported only then, the
// blur would have removed the cancel action and moved the clear button from under the pointer, and the click would be lost.
const PRESS_IN_AT_ONCE = isWeb ? ({ delayPressIn: 0 } as object) : {};
const TAB_EXIT = { tabIndex: -1 };

export type SearchBarProps = Omit<RNTextInputProps, 'style' | 'value' | 'onChangeText' | 'multiline'> & {
  value: string;
  onChangeText: (text: string) => void;
  /** Visible hint and accessible name, for example "Marke, Modell, Mods oder Mitglieder". */
  placeholder: string;
  onSubmit?: (text: string) => void;
  /** Called after the cancel action, or Escape in the field on web, cleared and blurred the field. */
  onCancel?: () => void;
  /** Replaces the labels from namespace common. */
  clearLabel?: string;
  cancelLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  ref?: Ref<InputRef>;
};

const useStyles = createStyles((t) => ({
  root: { alignItems: 'center', borderRadius: t.radius.search, flexDirection: 'row', gap: t.space[4], ...NO_BROWSER_OUTLINE },
  // DQ-060: at a large font on a phone the action leaves the field too little room, so it takes its own line while open.
  rootStacked: { alignItems: 'stretch', flexDirection: 'column' },
  field: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.search,
    flexDirection: 'row',
    gap: t.space[8],
    minHeight: t.size.search,
    minWidth: 0,
    paddingLeft: t.space[12],
  },
  fieldInline: { flex: 1 },
  // DQ-038: without the clear button a long placeholder ends inside the field, not on its frame.
  fieldNoClear: { paddingRight: t.space[12] },
  frame: { borderRadius: t.radius.search, pointerEvents: 'none' },
  tabExit: { height: 0, position: 'absolute', width: 0, ...NO_BROWSER_OUTLINE },
  frameFocus: { borderColor: t.color.text.primary, borderWidth: t.size.border.inputFocus },
  input: { alignSelf: 'stretch', flex: 1, minWidth: 0, ...NO_BROWSER_OUTLINE, ...FIELD_ELLIPSIS, padding: 0 },
  clear: { alignItems: 'center', height: t.size.touchMin, justifyContent: 'center', width: t.size.touchMin },
  clearVisual: { alignItems: 'center', borderRadius: t.radius.sm, flexGrow: 0, justifyContent: 'center' },
  cancelStacked: { alignSelf: 'flex-end' },
  cancel: {
    alignItems: 'center',
    borderRadius: t.radius.sm,
    justifyContent: 'center',
    minHeight: t.size.touchMin,
    minWidth: t.size.touchMin,
    paddingHorizontal: t.space[8],
  },
}));

/** §8 search bar: 44 high, radius 10, leading 20 icon, clear button, text action while focused. */
export function SearchBar({
  value,
  onChangeText,
  placeholder,
  onSubmit,
  onCancel,
  clearLabel,
  cancelLabel,
  style,
  testID,
  ref,
  onFocus,
  onBlur,
  onKeyPress,
  ...rest
}: SearchBarProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const theme = useTheme();
  const rootRef = useRef<RootRef | null>(null);
  const inputRef = useRef<InputRef | null>(null);
  const tabExitRef = useRef<RootRef | null>(null);
  const rootFocus = useFocusRing();
  const forced = useForcedVisualState();
  const [inputActive, setActive] = useState(false);
  const active = inputActive || (forced?.focused ?? false);
  // On web a press blurs the field first; the cancel action must survive until its press ends.
  const pressingAction = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motion = useMotion();
  const body = typeStyle('body', isWeb ? theme.fontScale : 1, undefined, false);
  const largeFont = useStacksAtFontScale();
  const { kind } = useBreakpoint();
  const stacked = active && largeFont && kind === 'phone';

  const startAction = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    pressingAction.current = true;
  };
  const finishAction = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    pressingAction.current = false;
  };
  // A press can be abandoned by sliding off, and then no onPress follows. Web clicks only after the release, so the action
  // has to stay a moment, or removing it here would swallow a real press.
  const settleAction = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      pressingAction.current = false;
      const focusStays = isWeb ? contains(rootRef.current, document.activeElement) : inputRef.current?.isFocused();
      if (!focusStays) setActive(false);
    }, motion.duration.micro);
  };
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  // On web the field, clear and cancel are one focus scope: moving between them keeps the bar open, or Tab would remove
  // the action it is heading for. Switching window also blurs, but focus has not moved and comes back to the same element.
  const collapseIfFocusLeft = (event: FocusLoss) => {
    if (pressingAction.current) return;
    if (isWeb && (contains(rootRef.current, event.relatedTarget) || document.activeElement === event.target)) return;
    setActive(false);
  };
  const cancel = () => {
    finishAction();
    setActive(false);
    onChangeText('');
    if (isWeb) (rootRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
    else inputRef.current?.blur();
    onCancel?.();
  };

  // DQ-098: the bar opens whichever way focus enters it. A press on clear does not open it: that would move clear from under
  // the pointer (see PRESS_IN_AT_ONCE), and the press puts focus in the field anyway.
  const openOnKeyboardFocus = ({ target }: FocusTarget) => {
    if (!isWeb || (target as Element | undefined)?.matches?.(':focus-visible')) setActive(true);
  };

  // DQ-097, web: after cancel the bar itself holds focus, as a named search landmark and no tab stop, because removing the
  // focused action would drop focus on the page, where engines disagree on what Tab does next and WebKit reopens the field.
  const rootProps = {
    role: 'search',
    'aria-label': placeholder,
    tabIndex: -1,
    testID: testID ? `${testID}.focusAnchor` : undefined,
    onFocus: (event: RootFocusEvent) => {
      if (event.target === event.currentTarget) rootFocus.onFocus(event);
    },
    onBlur: (event: RootFocusEvent) => {
      if (event.target !== event.currentTarget) return;
      rootFocus.onBlur();
      collapseIfFocusLeft(event);
    },
    onKeyDown: (event: RootKeyEvent) => {
      if (event.target !== event.currentTarget) return;
      const { key, altKey, ctrlKey, metaKey } = event.nativeEvent;
      // Tab starts from the end of the bar: forward goes on past it, back returns to the field.
      if (key === 'Tab') (tabExitRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
      else if (altKey || ctrlKey || metaKey) return;
      else if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        inputRef.current?.focus();
        // A typed character lands in the field, which has focus by the time the browser inserts it.
      } else if (key.length === 1) inputRef.current?.focus();
    },
  };

  const attachRef = (node: InputRef | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <View ref={rootRef} {...(isWeb ? (rootProps as object) : {})} style={[styles.root, stacked ? styles.rootStacked : null, forced?.focused ? null : rootFocus.ringStyle, style]}>
      <FieldSurface
        testID={testID ? `${testID}.field` : undefined}
        onPress={() => inputRef.current?.focus()}
        style={[styles.field, stacked ? null : styles.fieldInline, value ? null : styles.fieldNoClear]}
      >
        <Icon name="magnifying-glass" size={20} color="text.secondary" />
        <RNTextInput
          {...rest}
          ref={attachRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={resolveColor(theme, 'text.tertiary')}
          selectionColor={resolveColor(theme, 'text.primary')}
          cursorColor={resolveColor(theme, 'text.primary')}
          role="searchbox"
          aria-label={placeholder}
          returnKeyType="search"
          testID={testID}
          onSubmitEditing={(event) => {
            onSubmit?.(value);
            rest.onSubmitEditing?.(event);
          }}
          onFocus={(event) => {
            setActive(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            collapseIfFocusLeft(event);
            onBlur?.(event);
          }}
          onKeyPress={(event) => {
            if (isWeb && event.nativeEvent.key === 'Escape') cancel();
            onKeyPress?.(event);
          }}
          style={[
            isIOS ? { ...body, lineHeight: undefined } : body,
            { color: resolveColor(theme, 'text.primary') },
            styles.input,
          ]}
        />
        {value ? (
          <WithoutForcedState>
            <PressableScale
              {...PRESS_IN_AT_ONCE}
              role="button"
              aria-label={clearLabel ?? t('actions.clear')}
              testID={testID ? `${testID}.clear` : undefined}
              onPressIn={startAction}
              onPressOut={settleAction}
              onFocus={openOnKeyboardFocus}
              onBlur={collapseIfFocusLeft}
              onPress={() => {
                finishAction();
                onChangeText('');
                inputRef.current?.focus();
              }}
              style={styles.clear}
              contentStyle={styles.clearVisual}
            >
              <Icon name="x" size={20} color="text.secondary" />
            </PressableScale>
          </WithoutForcedState>
        ) : null}
        {active ? <View style={[StyleSheet.absoluteFill, styles.frame, styles.frameFocus]} /> : null}
      </FieldSurface>
      {active ? (
        <WithoutForcedState>
          <CancelAction
            label={cancelLabel ?? t('actions.cancel')}
            testID={testID ? `${testID}.cancel` : undefined}
            onPressIn={startAction}
            onPressOut={settleAction}
            onBlur={collapseIfFocusLeft}
            onPress={cancel}
            stacked={stacked}
          />
        </WithoutForcedState>
      ) : null}
      {isWeb ? (
        <View
          ref={tabExitRef}
          {...(TAB_EXIT as object)}
          // Part of the scope like clear and cancel: Tab from the root rests here, and leaving from here closes the bar.
          {...({ onBlur: collapseIfFocusLeft } as object)}
          testID={testID ? `${testID}.tabExit` : undefined}
          style={styles.tabExit}
        />
      ) : null}
    </View>
  );
}

function CancelAction({
  label,
  onPress,
  onPressIn,
  onPressOut,
  onBlur,
  stacked,
  testID,
}: {
  label: string;
  onPress: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
  onBlur: (event: FocusLoss) => void;
  stacked: boolean;
  testID: string | undefined;
}) {
  const styles = useStyles();
  const motion = useMotion();
  const opacity = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  useEffect(() => {
    opacity.set(motion.timingTo(1, 'micro'));
  }, [motion, opacity]);

  // ADR-118 inset ring: the action sits only space 4 from the field, and while it holds focus the field keeps its frame. An
  // outer ring (2 + 2) would end exactly on that frame and merge with it. The side padding keeps the label clear of it.
  return (
    <Animated.View style={[animatedStyle, stacked ? styles.cancelStacked : null]}>
      <PressableScale
        {...PRESS_IN_AT_ONCE}
        role="button"
        aria-label={label}
        ring="inset"
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onBlur={onBlur}
        testID={testID}
        contentStyle={styles.cancel}
      >
        <Text variant="labelS" selectable={false} hyphenate={false}>
          {label}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}
