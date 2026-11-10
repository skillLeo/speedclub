import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View, type ViewStyle } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, space, useBreakpoint, useMotion } from '@/theme';

import { PressableScale } from './PressableScale';
import { useTopOverlay } from './overlayStack';
import { useSafeInset } from './safeArea';
import { Text } from './Text';
import { dismissToast, useCurrentToast, type ToastItem } from './toast';
import { toastBottom, toastBottomCss, toastKeyboardLift } from './toastPlacement';

/** §8: every toast stays for 4 s. */
export const TOAST_DURATION_MS = 4000;
const SLIDE = space[12];

export type ToastHostProps = {
  /** Height of the tab bar without its safe inset (`size.tabBar`) on screens that have one; 0 elsewhere. */
  tabBarOffset?: number;
  /**
   * Height of the sticky CTA bar at the bottom of the screen, safe inset included (`useStickyBarHeight()`); 0 elsewhere.
   * The toast sits 8 above the higher of the two bars, and above the keyboard while it is open.
   */
  stickyBarHeight?: number;
  /** Used when a toast has no testID of its own. Sub-testIDs: `.host`, `.action`. */
  testID?: string;
  /** Set by the overlay that hosts it. Any other host stands aside while an overlay is open, so one host shows at a time. */
  inOverlay?: boolean;
};

/** A toast moves to a new host when an overlay opens or closes: it speaks and buzzes once. */
let lastAnnouncedId = 0;

const useStyles = createStyles((t) => ({
  host: {
    alignItems: 'center',
    left: 0,
    pointerEvents: 'box-none',
    position: 'absolute',
    right: 0,
    zIndex: t.zIndex.toast,
  },
  wrap: { maxWidth: t.layout.feedColumn, width: '100%' },
  toast: {
    alignItems: 'center',
    backgroundColor: t.color.bg.inverse,
    borderRadius: t.radius.sm,
    boxShadow: t.colorScheme === 'light' ? t.shadow.e2 : undefined,
    flexDirection: 'row',
    minHeight: t.size.toastMin,
    paddingHorizontal: t.space[16],
  },
  withAction: { paddingRight: t.space[4] },
  message: { flex: 1, paddingVertical: t.space[12] },
  action: { justifyContent: 'center', minHeight: t.size.touchMin, minWidth: t.size.touchMin },
  actionContent: { alignItems: 'center', flexGrow: 0, paddingHorizontal: t.space[12] },
}));

/**
 * §8 toast: bottom, 8 above the tab bar, min 48, radius 8, inverse colours, 4 s. Mount one host at the root of the
 * screen tree. It clears a sticky CTA bar and the keyboard as well (toastPlacement.ts). Web announces through the
 * permanent `aria-live` region, native through AccessibilityInfo.
 */
export function ToastHost({ inOverlay = false, ...props }: ToastHostProps) {
  const overlayOpen = useTopOverlay() !== null;
  return inOverlay || !overlayOpen ? <Host {...props} /> : null;
}

function Host({ tabBarOffset = 0, stickyBarHeight = 0, testID = 'toast' }: Omit<ToastHostProps, 'inOverlay'>) {
  const styles = useStyles();
  const motion = useMotion();
  const { gutter } = useBreakpoint();
  const item = useCurrentToast();
  const inset = useSafeInset('bottom');
  const position: ViewStyle = isWeb
    ? ({ bottom: toastBottomCss(tabBarOffset, stickyBarHeight) } as unknown as ViewStyle)
    : { bottom: toastBottom({ tabBar: tabBarOffset, stickyBar: stickyBarHeight, inset }) };
  const keyboard = useReanimatedKeyboardAnimation();
  const progress = useSharedValue(0);
  const { timingTo, reduced } = motion;

  // The last toast stays rendered while it animates out.
  const [shown, setShown] = useState<ToastItem | null>(item);
  if (item && item !== shown) setShown(item);
  const id = item?.id;

  useEffect(() => {
    if (id === undefined) {
      progress.set(timingTo(0, 'micro', 'accelerate'));
      const timer = setTimeout(() => setShown(null), motion.duration.micro);
      return () => clearTimeout(timer);
    }
    progress.set(0);
    progress.set(timingTo(1, 'small', 'decelerate'));
    return undefined;
  }, [id, motion.duration.micro, progress, timingTo]);

  const animated = useAnimatedStyle(() => {
    // The keyboard height counts down from 0 while it opens. The lift is position, not motion, so it stays in reduced motion.
    const clearance = { tabBar: tabBarOffset, stickyBar: stickyBarHeight, inset };
    const lift = toastKeyboardLift(clearance, -keyboard.height.get(), keyboard.progress.get());
    const slide = reduced ? 0 : interpolate(progress.get(), [0, 1], [SLIDE, 0]);
    return { opacity: progress.get(), transform: [{ translateY: slide - lift }] };
  });

  return (
    <View
      {...(isWeb ? { role: 'status' as const, 'aria-live': 'polite' as const } : {})}
      style={[styles.host, position, { paddingHorizontal: gutter }]}
      testID={`${testID}.host`}
    >
      {shown ? (
        <Animated.View style={[styles.wrap, animated]}>
          <ToastBody key={shown.id} item={shown} visible={item !== null} fallbackTestID={testID} />
        </Animated.View>
      ) : null}
    </View>
  );
}

function ToastBody({ item, visible, fallbackTestID }: { item: ToastItem; visible: boolean; fallbackTestID: string }) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const [paused, setPaused] = useState(false);
  const testID = item.testID ?? fallbackTestID;
  const action = item.undo ? { label: t('actions.undo'), onPress: item.undo } : item.action;
  const { id, message, haptic } = item;

  useEffect(() => {
    if (lastAnnouncedId === id) return;
    lastAnnouncedId = id;
    if (!isWeb) AccessibilityInfo.announceForAccessibility(message);
    if (haptic) haptics[haptic]();
  }, [id, message, haptic]);

  useEffect(() => {
    if (paused || !visible) return undefined;
    const timer = setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [id, paused, visible]);

  return (
    <View
      testID={testID}
      style={[styles.toast, action ? styles.withAction : null]}
      {...(isWeb ? ({ onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false) } as object) : {})}
    >
      <Text variant="supporting" color="text.inverse" style={styles.message}>
        {message}
      </Text>
      {action ? (
        <PressableScale
          role="button"
          aria-label={action.label}
          onPress={() => {
            action.onPress();
            dismissToast(id);
          }}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          style={styles.action}
          contentStyle={styles.actionContent}
          testID={`${testID}.action`}
        >
          <Text variant="labelS" color="text.inverse" selectable={false}>
            {action.label}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}
