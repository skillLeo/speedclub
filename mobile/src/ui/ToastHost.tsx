import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, type AnimatedStyle } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, motion as motionTokens, size, space, typography, useBreakpoint, useTheme } from '@/theme';

import { motionDuration, useMotionPreference } from './motion';
import { useSwipeDismiss } from './motion/SwipeRow';
import { PressableScale } from './PressableScale';
import { useTopOverlay } from './overlayStack';
import { useStacksAtFontScale } from './rowParts';
import { useSafeInset } from './safeArea';
import { Text } from './Text';
import { dismissToast, useCurrentToast, type ToastItem } from './toast';
import {
  reportShellClearance,
  TOAST_GAP,
  toastBottom,
  toastBottomCss,
  toastFitsAbovePanel,
  toastKeyboardLift,
  useOverlayClearance,
  useOverlayPanel,
} from './toastPlacement';

/** §8: every toast stays for 4 s. */
export const TOAST_DURATION_MS = 4000;
/** SM20 (09 §4.7): a toast with an action (undo) stays 5 s, so the action can still be reached. */
export const TOAST_ACTION_DURATION_MS: number = motionTokens.signature.toast.autoDismiss;
const SLIDE = space[12];

/**
 * ADR-426 f: the message is running text (`body`, 400) and the action is the one tappable word (`bodyStrong`, 600), so
 * "Rückgängig" stands out from the message it undoes. The v1 roles were `supporting` and `labelS` (DQ-905).
 */
export const TOAST_MESSAGE_ROLE = 'body' as const;
export const TOAST_ACTION_ROLE = 'bodyStrong' as const;

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
  // Above the stacking font scale the action takes its own line at the end, so the message keeps the toast's whole width
  // (at most 2 lines for a standard undo toast at 360 and 200 %).
  stacked: { alignItems: 'stretch', flexDirection: 'column' },
  message: { flex: 1, paddingVertical: t.space[12] },
  messageStacked: { paddingBottom: 0, paddingRight: t.space[12], paddingTop: t.space[12] },
  action: { justifyContent: 'center', minHeight: t.size.touchMin, minWidth: t.size.touchMin },
  actionStacked: { alignSelf: 'flex-end' },
  actionContent: { alignItems: 'center', flexGrow: 0, paddingHorizontal: t.space[12] },
}));

/**
 * §8 toast: bottom, 8 above the tab bar, min 48, radius 8, inverse colours, 4 s. Mount one host at the root of the
 * screen tree. It clears a sticky CTA bar and the keyboard as well (toastPlacement.ts). Web announces through the
 * permanent `aria-live` region, native through AccessibilityInfo.
 */
export function ToastHost({ inOverlay = false, ...props }: ToastHostProps) {
  const overlayOpen = useTopOverlay() !== null;
  const { tabBarOffset = 0, stickyBarHeight = 0 } = props;
  // DQ-1006: the overlay's host clears what this one clears (the tab bar under a menu), and a sheet's footer above that.
  useEffect(() => {
    if (!inOverlay) reportShellClearance(tabBarOffset, stickyBarHeight);
  }, [inOverlay, stickyBarHeight, tabBarOffset]);
  if (inOverlay) return <OverlayHost {...props} />;
  return overlayOpen ? null : <Host {...props} />;
}

/**
 * DQ-1006 r3: inside an overlay with an open sheet, the toast sits 8 above the sheet's visible top edge (its text field and its
 * primary action stay free at every font scale), as wide as the sheet's content column at most; where that leaves no room under
 * the safe top (a sheet at its full snap), it goes to the top of the screen. Without a sheet (a context menu) it clears what the
 * shell host clears.
 */
function OverlayHost(props: Omit<ToastHostProps, 'inOverlay'>) {
  const clearance = useOverlayClearance();
  const panel = useOverlayPanel();
  const { height: windowHeight } = useWindowDimensions();
  const safeTop = useSafeInset('top');
  const { fontScale } = useTheme();
  if (!panel) return <Host {...props} tabBarOffset={clearance.tabBar} stickyBarHeight={clearance.stickyBar} />;
  // Two lines of message at the current scale: the toast's usual height, so the check holds for a long message too.
  const toastHeight = Math.max(size.toastMin, 2 * typography[TOAST_MESSAGE_ROLE].lineHeight * fontScale + 2 * space[12]);
  const above = toastFitsAbovePanel(panel.height, windowHeight, safeTop, toastHeight);
  return (
    <Host
      {...props}
      tabBarOffset={clearance.tabBar}
      stickyBarHeight={Math.max(clearance.stickyBar, panel.height)}
      maxWidth={panel.column}
      atTop={!above}
    />
  );
}

type HostProps = Omit<ToastHostProps, 'inOverlay'> & {
  /** DQ-1006 r3: no wider than the open sheet's content column. */
  maxWidth?: number;
  /** DQ-1006 r3: the sheet leaves no room above it: the toast sits under the safe top instead. */
  atTop?: boolean;
};

function Host({ tabBarOffset = 0, stickyBarHeight = 0, testID = 'toast', maxWidth, atTop = false }: HostProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const { gutter } = useBreakpoint();
  const item = useCurrentToast();
  const inset = useSafeInset('bottom');
  const top = useSafeInset('top');
  const bottomPosition: ViewStyle = isWeb
    ? ({ bottom: toastBottomCss(tabBarOffset, stickyBarHeight) } as unknown as ViewStyle)
    : { bottom: toastBottom({ tabBar: tabBarOffset, stickyBar: stickyBarHeight, inset }) };
  const topPosition: ViewStyle = isWeb
    ? ({ top: `calc(env(safe-area-inset-top, 0px) + ${TOAST_GAP}px)` } as unknown as ViewStyle)
    : { top: top + TOAST_GAP };
  const position = atTop ? topPosition : bottomPosition;
  const keyboard = useReanimatedKeyboardAnimation();
  const progress = useSharedValue(0);
  const { effectTo, reduced } = motion;

  // The last toast stays rendered while it animates out.
  const [shown, setShown] = useState<ToastItem | null>(item);
  if (item && item !== shown) setShown(item);
  const id = item?.id;
  // SM20: a sideways swipe sends the toast away; a new toast starts at rest.
  const swipe = useSwipeDismiss(() => dismissToast(), testID);
  const resetSwipe = swipe.reset;

  useEffect(() => {
    if (id === undefined) {
      // SM20: exits use effect.fast; the toast stays rendered until it has settled.
      progress.set(effectTo(0, 'fast'));
      const timer = setTimeout(() => setShown(null), motionDuration('effect.fast'));
      return () => clearTimeout(timer);
    }
    resetSwipe();
    progress.set(0);
    progress.set(effectTo(1, 'default'));
    return undefined;
  }, [id, progress, effectTo, resetSwipe]);

  const animated = useAnimatedStyle(() => {
    // The keyboard height counts down from 0 while it opens. The lift is position, not motion, so it stays in reduced motion.
    const clearance = { tabBar: tabBarOffset, stickyBar: stickyBarHeight, inset };
    const lift = atTop ? 0 : toastKeyboardLift(clearance, -keyboard.height.get(), keyboard.progress.get());
    const slide = reduced ? 0 : interpolate(progress.get(), [0, 1], [atTop ? -SLIDE : SLIDE, 0]);
    return { opacity: progress.get(), transform: [{ translateY: slide - lift }] };
  });

  return (
    <View
      {...(isWeb ? { role: 'status' as const, 'aria-live': 'polite' as const } : {})}
      style={[styles.host, position, { paddingHorizontal: gutter }]}
      testID={`${testID}.host`}
    >
      {shown ? (
        <GestureDetector gesture={swipe.gesture} touchAction="pan-y">
          <Animated.View style={[styles.wrap, maxWidth === undefined ? null : { maxWidth }, animated]} onLayout={swipe.onLayout}>
            <ToastBody key={shown.id} item={shown} visible={item !== null} fallbackTestID={testID} swipeStyle={swipe.style} />
          </Animated.View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

type ToastBodyProps = { item: ToastItem; visible: boolean; fallbackTestID: string; swipeStyle?: AnimatedStyle<ViewStyle> };

function ToastBody({ item, visible, fallbackTestID, swipeStyle }: ToastBodyProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const [paused, setPaused] = useState(false);
  const testID = item.testID ?? fallbackTestID;
  const action = item.undo ? { label: t('actions.undo'), onPress: item.undo } : item.action;
  const { id, message, haptic } = item;
  const hasAction = action !== undefined;
  const stacked = useStacksAtFontScale() && hasAction;

  useEffect(() => {
    if (lastAnnouncedId === id) return;
    lastAnnouncedId = id;
    if (!isWeb) AccessibilityInfo.announceForAccessibility(message);
    if (haptic) haptics[haptic]();
  }, [id, message, haptic]);

  useEffect(() => {
    if (paused || !visible) return undefined;
    const timer = setTimeout(() => dismissToast(id), hasAction ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [id, paused, visible, hasAction]);

  return (
    <Animated.View
      testID={testID}
      style={[styles.toast, action ? styles.withAction : null, stacked ? styles.stacked : null, swipeStyle]}
      {...(isWeb ? ({ onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false) } as object) : {})}
    >
      <Text variant={TOAST_MESSAGE_ROLE} color="text.inverse" style={stacked ? styles.messageStacked : styles.message} testID={`${testID}.message`}>
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
          style={[styles.action, stacked ? styles.actionStacked : null]}
          contentStyle={styles.actionContent}
          testID={`${testID}.action`}
        >
          <Text variant={TOAST_ACTION_ROLE} color="text.inverse" selectable={false} hyphenate={false} testID={`${testID}.action.label`}>
            {action.label}
          </Text>
        </PressableScale>
      ) : null}
    </Animated.View>
  );
}
