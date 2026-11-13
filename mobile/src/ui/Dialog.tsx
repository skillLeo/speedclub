import { useEffect, useId, useState, type ReactNode } from 'react';
import { ScrollView, useWindowDimensions, View, type FocusEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useKeyboardState, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { keepShortNamesTogether } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, motion as motionTokens, space, useBreakpoint } from '@/theme';

import { motionDuration, useMotionPreference } from './motion';
import { Button } from './Button';
import { Hairline } from './Hairline';
import { OverlayModal, Scrim, usePresence } from './overlay';
import { useSafeInset } from './safeArea';
import { Text } from './Text';
import { NO_BROWSER_OUTLINE, useFocusRing } from './useFocusRing';

export type DialogAction = {
  label: string;
  onPress: () => void;
  /** Filled red, placed last, warning haptic on press. Reserved for the final confirm of an irreversible action. */
  destructive?: boolean;
  /** `secondary` for the way out, `primary` for a non-destructive confirm. */
  variant?: 'primary' | 'secondary' | 'tertiary';
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
};

export type DialogProps = {
  visible: boolean;
  /** Scrim, Escape, Android back. Without it the dialog can only be left through its actions. */
  onClose?: () => void;
  title: string;
  body?: string;
  /** Extra content between the body and the actions, for example a typed confirmation. */
  children?: ReactNode;
  actions: readonly DialogAction[];
  /** Sub-testIDs: `.scrim`, `.scroll`, `.title`, `.body`. */
  testID?: string;
};

/** The free space kept above and below the panel. */
const PANEL_MARGIN = space[24];

const useStyles = createStyles((t) => ({
  center: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'box-none',
  },
  panel: {
    backgroundColor: t.color.bg.overlay,
    // 09 §5: dialogs take the sheet radius (20) and, on the member web, up to 400 wide.
    borderRadius: t.radius.xl,
    boxShadow: t.colorScheme === 'light' ? t.shadow.e2 : undefined,
    maxWidth: isWeb ? t.size.dialogMaxWidthWeb : t.size.dialogMaxWidth,
    padding: t.space[24],
    width: '100%',
  },
  // Takes the keyboard's arrow keys, so it can hold focus: ADR-118 inset ring, and the padding keeps the text clear of it
  // while the margin keeps the text on the panel's own edge.
  scroll: {
    borderRadius: t.radius.sm,
    flexGrow: 0,
    flexShrink: 1,
    margin: -t.space[8],
    minHeight: 0,
    ...NO_BROWSER_OUTLINE,
  },
  scrollContent: { padding: t.space[8] },
  scrollBox: { flexShrink: 1, minHeight: 0 },
  // DQ-454: while the text runs on under the buttons, a hairline says so (as the header's when content scrolls under it).
  // border.strong: border.subtle is lost on bg.overlay (DQ-454, round 4).
  moreRule: { backgroundColor: t.color.border.strong, bottom: 0, left: 0, pointerEvents: 'none', position: 'absolute', right: 0 },
  text: { gap: t.space[8] },
  content: { marginTop: t.space[16] },
  stacked: { gap: t.space[8], marginTop: t.space[24] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], justifyContent: 'flex-end', marginTop: t.space[24] },
  rowButton: { flexGrow: 1 },
  exiting: { pointerEvents: 'none' },
}));

/** Destructive actions go last, whatever order the caller used (§8). */
export function orderActions(actions: readonly DialogAction[]): DialogAction[] {
  return [...actions.filter((action) => !action.destructive), ...actions.filter((action) => action.destructive)];
}

/**
 * §8 dialog: max width 320, radius 12, bg.overlay, stacked buttons on narrow widths, focus trapped on web. Text and content
 * scroll inside the panel when they do not fit, at 200 % or above the keyboard, so the actions always stay on screen.
 */
export function Dialog(props: DialogProps) {
  const motion = useMotionPreference();
  const mounted = usePresence(props.visible, motion.enabled ? motionDuration('effect.fast') : 0);
  return mounted ? <DialogPanel {...props} /> : null;
}

function DialogPanel({ visible, onClose, title, body, children, actions, testID }: DialogProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const { gutter, kind } = useBreakpoint();
  const { height: windowHeight } = useWindowDimensions();
  const { height: keyboardLift } = useReanimatedKeyboardAnimation();
  const keyboardHeight = useKeyboardState((state) => state.height);
  const safeTop = useSafeInset('top');
  const safeBottom = useSafeInset('bottom');
  const bodyId = useId();
  const progress = useSharedValue(0);
  const { effectTo, reduced } = motion;
  const scrollRing = useFocusRing('inset');
  const [box, setBox] = useState({ height: 0, content: 0, offset: 0 });
  const moreBelow = box.height > 0 && box.content > box.height + 1 && box.offset + box.height < box.content - 1;
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    setBox((current) => (Math.abs(current.offset - offset) < 1 ? current : { ...current, offset }));
  };

  useEffect(() => {
    // Enter with the effect.default crossfade, leave with effect.fast: exits are quick (09 §4.7).
    progress.set(visible ? effectTo(1, 'default') : effectTo(0, 'fast'));
  }, [visible, progress, effectTo]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    // Centred on the screen, so half the keyboard's height centres it in what the keyboard leaves free.
    transform: [
      { translateY: keyboardLift.get() / 2 },
      ...(reduced ? [] : [{ scale: interpolate(progress.get(), [0, 1], [motionTokens.press.scale, 1]) }]),
    ],
  }));

  // Stays mounted for the exit animation: nothing in it may fire a second time, by touch, keyboard or Escape.
  const close = () => {
    if (visible) onClose?.();
  };
  const stacked = kind === 'phone';
  const maxHeight = windowHeight - keyboardHeight - 2 * (PANEL_MARGIN + Math.max(safeTop, keyboardHeight > 0 ? 0 : safeBottom));

  return (
    <OverlayModal label={title} describedBy={body ? bodyId : undefined} onRequestClose={close}>
      <Scrim progress={progress} onPress={close} testID={testID ? `${testID}.scrim` : undefined} />
      <View style={[styles.center, { paddingHorizontal: gutter }]}>
        <Animated.View
          {...(isWeb ? {} : { role: 'dialog' as const, 'aria-modal': true, 'aria-label': title })}
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          testID={testID}
          style={[styles.panel, { maxHeight }, panelStyle, visible ? null : styles.exiting]}
        >
          <View style={styles.scrollBox}>
            <ScrollView
              style={[styles.scroll, scrollRing.ringStyle]}
              onLayout={(event) => {
                const height = event.nativeEvent.layout.height;
                setBox((current) => (current.height === height ? current : { ...current, height }));
              }}
              onContentSizeChange={(_width, content) => setBox((current) => (current.content === content ? current : { ...current, content }))}
              onScroll={onScroll}
              scrollEventThrottle={16}
              contentContainerStyle={styles.scrollContent}
              // Focus bubbles: a field inside draws its own ring, this one is for the scroller alone.
              onFocus={(event: FocusEvent) => {
                if (event.target === event.currentTarget) scrollRing.onFocus(event);
              }}
              onBlur={scrollRing.onBlur}
              keyboardShouldPersistTaps="handled"
              overScrollMode="never"
              testID={testID ? `${testID}.scroll` : undefined}
            >
              <View style={styles.text}>
                <Text variant="headline" role="heading" testID={testID ? `${testID}.title` : undefined}>
                  {keepShortNamesTogether(title)}
                </Text>
                {body ? (
                  <Text
                    variant="body"
                    color="text.secondary"
                    nativeID={bodyId}
                    testID={testID ? `${testID}.body` : undefined}
                  >
                    {keepShortNamesTogether(body)}
                  </Text>
                ) : null}
              </View>
              {children ? <View style={styles.content}>{children}</View> : null}
            </ScrollView>
            {moreBelow ? <Hairline style={styles.moreRule} testID={testID ? `${testID}.more` : undefined} /> : null}
          </View>
          <View style={stacked ? styles.stacked : styles.row}>
            {orderActions(actions).map((action) => (
              <Button
                key={action.label}
                label={action.label}
                size="m"
                variant={action.destructive ? 'destructive' : (action.variant ?? 'secondary')}
                filled={action.destructive}
                fullWidth={stacked}
                loading={action.loading}
                disabled={action.disabled}
                style={stacked ? undefined : styles.rowButton}
                testID={action.testID}
                onPress={() => {
                  if (!visible) return;
                  if (action.destructive) haptics.warning();
                  action.onPress();
                }}
              />
            ))}
          </View>
        </Animated.View>
      </View>
    </OverlayModal>
  );
}
