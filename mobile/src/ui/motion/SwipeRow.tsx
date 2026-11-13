import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { isWeb } from '@/lib/platform';
import { createStyles, size } from '@/theme';
import { motion as motionTokens } from '@/theme/tokens.generated';

import { Icon, type IconName } from '../icons/Icon';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';
import { hapticFor } from './haptics';
import { commitThreshold, crossed, shouldDismiss, swipeOffset, swipeSettle } from './math';
import { useMotionPreference } from './preference';
import { motionDuration } from './springs';

const SWIPE = motionTokens.signature.swipeActions;
/** The finger travels this far sideways before a row or toast moves; vertical first lets the list scroll. */
const ACTIVATE_X = SWIPE.activateX;
const FAIL_Y = SWIPE.failY;

export type SwipeAction = {
  key: string;
  /** Visible under the glyph and the accessible name ("Archivieren", "Löschen"). */
  label: string;
  icon: IconName;
  /** `destructive` sits on the accent fill (09 §5: destructive = accent). */
  tone?: 'default' | 'destructive';
  onPress: () => void;
};

const useStyles = createStyles((t) => ({
  root: { overflow: 'hidden' },
  actions: { bottom: 0, flexDirection: 'row', position: 'absolute', right: 0, top: 0 },
  action: { alignItems: 'center', flex: 1, gap: t.space[4], justifyContent: 'center', paddingHorizontal: t.space[8], width: t.size.row.withThumb },
  default: { backgroundColor: t.color.bg.raised },
  destructive: { backgroundColor: t.color.accent.fill },
  front: { backgroundColor: t.color.bg.surface },
  frontCanvas: { backgroundColor: t.color.bg.canvas },
}));

export type SwipeRowProps = {
  actions: readonly SwipeAction[];
  /**
   * The row's accessible name on native, where the row is one focusable element that carries the swipe actions (VoiceOver and
   * TalkBack only offer the actions of the focused element). Its content is read through this label.
   */
  label: string;
  /** What a double tap does on native (the row's own press, e.g. open the notification). */
  onPress?: () => void;
  /** A swipe past `swipeActions.commitRatio` of the row runs the first action (archive in notifications). */
  fullSwipe?: boolean;
  /** The row's own ground, which covers the actions while it is closed: `surface` (grouped lists, default) or `canvas` (HOME-02). */
  ground?: 'surface' | 'canvas';
  children: ReactNode;
  testID: string;
};

/**
 * SM11 swipe actions (notifications, conversations): a left swipe reveals the trailing actions with a rubber band past their
 * end, a light haptic when the release would change the outcome (open, or the full-swipe commit), and a spring.calm settle.
 * Screen readers get the actions as accessibility actions of the row itself, which is the focusable element on native (named by
 * `label`, activated by `onPress`); on web the actions stay in the tab order and open the row when they take focus. Reduced motion: the settle is the effect.default crossfade of the offset (springTo does that).
 */
export function SwipeRow({ actions, label, onPress, fullSwipe = false, ground = 'surface', children, testID }: SwipeRowProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const [rowWidth, setRowWidth] = useState(0);
  const [open, setOpen] = useState(false);
  const offset = useSharedValue(0);
  const start = useSharedValue(0);
  const actionsWidth = actions.length * size.row.withThumb;
  const threshold = fullSwipe ? commitThreshold(rowWidth, SWIPE.commitRatio) : -actionsWidth / 2;

  const settleTo = (target: 'closed' | 'open') => {
    offset.set(motion.springTo(target === 'open' ? -actionsWidth : 0, 'calm'));
    setOpen(target === 'open');
  };
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (returnTimer.current) clearTimeout(returnTimer.current);
    },
    [],
  );
  const commit = () => {
    setOpen(false);
    actions[0]?.onPress();
    // The row leaves, then comes back closed for a list that keeps it (undo).
    if (returnTimer.current) clearTimeout(returnTimer.current);
    returnTimer.current = setTimeout(() => {
      returnTimer.current = null;
      offset.set(motion.springTo(0, 'calm'));
    }, motionDuration('spring.calm'));
  };

  const pan = usePanGesture({
    activeOffsetX: [-ACTIVATE_X, ACTIVATE_X],
    failOffsetY: [-FAIL_Y, FAIL_Y],
    testID: `${testID}.pan`,
    onBegin: () => {
      'worklet';
      start.set(offset.get());
    },
    onUpdate: (event) => {
      'worklet';
      const previous = offset.get();
      // A row with a full-swipe commit follows the finger up to its own width; otherwise it resists past the actions.
      const next = swipeOffset(start.get(), event.translationX, fullSwipe ? Math.max(rowWidth, actionsWidth) : actionsWidth, rowWidth, SWIPE.rubberBand);
      offset.set(next);
      if (crossed(previous, next, threshold)) scheduleOnRN(hapticFor, 'swipeActionThreshold');
    },
    onDeactivate: (event) => {
      'worklet';
      const settle = swipeSettle(offset.get(), event.velocityX, actionsWidth, rowWidth, {
        commitRatio: SWIPE.commitRatio,
        flingVelocity: SWIPE.flingVelocity,
        fullSwipe,
      });
      if (settle === 'commit') {
        offset.set(motion.springTo(-rowWidth, 'calm'));
        scheduleOnRN(commit);
      } else {
        scheduleOnRN(settleTo, settle);
      }
    },
  });

  const frontStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  const onLayout = (event: LayoutChangeEvent) => setRowWidth(event.nativeEvent.layout.width);
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    if (name === 'activate') onPress?.();
    else actions.find((a) => a.key === name)?.onPress();
  };
  // The row is the focusable element on native, so its actions are reachable; web keeps the content's own focus order.
  const accessibilityActions = [...(onPress ? [{ name: 'activate', label }] : []), ...actions.map((a) => ({ name: a.key, label: a.label }))];
  // Native hides the actions behind a closed row; screen readers reach them as actions of the row instead.
  const hidden = !isWeb && !open;

  return (
    <View style={styles.root} onLayout={onLayout} testID={testID}>
      <View style={[styles.actions, { width: actionsWidth }]} aria-hidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
        {actions.map((action) => (
          <PressableScale
            key={action.key}
            role="button"
            aria-label={action.label}
            onPress={() => {
              settleTo('closed');
              action.onPress();
            }}
            onFocus={isWeb ? () => settleTo('open') : undefined}
            style={[styles.action, action.tone === 'destructive' ? styles.destructive : styles.default]}
            testID={`${testID}.action.${action.key}`}
          >
            <Icon name={action.icon} size={20} color={action.tone === 'destructive' ? 'text.onAccent' : 'text.primary'} />
            <Text variant="caption" color={action.tone === 'destructive' ? 'text.onAccent' : 'text.primary'} numberOfLines={1} hyphenate={false}>
              {action.label}
            </Text>
          </PressableScale>
        ))}
      </View>
      <GestureDetector gesture={pan} touchAction="pan-y">
        <Animated.View
          style={[styles.front, ground === 'canvas' ? styles.frontCanvas : null, frontStyle]}
          accessible={!isWeb}
          role={isWeb ? undefined : onPress ? 'button' : undefined}
          aria-label={isWeb ? undefined : label}
          accessibilityActions={isWeb ? undefined : accessibilityActions}
          onAccessibilityAction={isWeb ? undefined : onAccessibilityAction}
          testID={`${testID}.front`}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/* ------------------------------------------------------------------ swipe to dismiss (SM20 toast) */

/**
 * A sideways swipe that dismisses (the toast, SM20): it follows the finger, leaves past `toast.swipeDismissRatio` of its width
 * or on a fling, and springs back (spring.calm) otherwise. `onDismiss` runs on the JS thread once.
 */
export function useSwipeDismiss(onDismiss: () => void, testID?: string) {
  const motion = useMotionPreference();
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const width = useSharedValue(0);
  const pan = usePanGesture({
    activeOffsetX: [-ACTIVATE_X, ACTIVATE_X],
    failOffsetY: [-FAIL_Y, FAIL_Y],
    testID: testID ? `${testID}.swipe` : undefined,
    // Interruptible: a finger that catches the toast mid-spring continues from where it is, not from 0.
    onBegin: () => {
      'worklet';
      start.set(x.get());
    },
    onUpdate: (event) => {
      'worklet';
      x.set(start.get() + event.translationX);
    },
    onDeactivate: (event) => {
      'worklet';
      const travelled = start.get() + event.translationX;
      if (shouldDismiss(travelled, event.velocityX, width.get(), motionTokens.signature.toast.swipeDismissRatio, SWIPE.flingVelocity)) {
        x.set(motion.effectTo(Math.sign(travelled) * width.get(), 'fast'));
        scheduleOnRN(onDismiss);
      } else {
        x.set(motion.springTo(0, 'calm'));
      }
    },
  });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const onLayout = (event: LayoutChangeEvent) => width.set(event.nativeEvent.layout.width);
  /** Back to rest at once, for the next item in the same place (a new toast replaces a swiped one). */
  const reset = useCallback(() => x.set(0), [x]);
  return { gesture: pan, style, onLayout, reset };
}
