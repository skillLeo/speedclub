import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, useWindowDimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { KeyboardAwareScrollView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { keepShortNamesTogether } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, size, space, useBreakpoint, useMotion } from '@/theme';

import { Hairline } from './Hairline';
import { OverlayModal, Scrim, usePresence } from './overlay';
import { PressableScale } from './PressableScale';
import { useSafeEdge, useSafeInset } from './safeArea';
import { contentOffset, footerTranslate, moveFocusIntoSheet, panelTranslate, settleTarget, type SheetTarget } from './sheetMath';
import { Text } from './Text';
import { NO_BROWSER_OUTLINE } from './useFocusRing';

export type SheetSnap = 'content' | 'full';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Rendered in `title.m`, and the accessible name of the dialog. */
  title?: string;
  /** Accessible name when there is no visible title. */
  label?: string;
  children?: ReactNode;
  /** Sticky at the visible bottom edge, above the keyboard, for example a Button with `fullWidth`. */
  footer?: ReactNode;
  initialSnap?: SheetSnap;
  /** False keeps the sheet at the content snap. */
  expandable?: boolean;
  /** For a short choice without a form: from 768 the panel is 480 wide and not the full 640. */
  narrow?: boolean;
  /** False ignores scrim, Escape, Android back and dragging down. */
  dismissable?: boolean;
  onSnapChange?: (snap: SheetSnap) => void;
  /** Sub-testIDs: `.scrim`, `.header`, `.grabber`, `.title`, `.headerLine`, `.body`, `.footer`. */
  testID?: string;
};

/** Web: takes focus from code and is no tab stop. */
const FOCUS_TARGET = (isWeb ? { tabIndex: -1 } : {}) as object;

const HEADER_ACTIVATION: [number, number] = [-space[4], space[4]];
const BODY_ACTIVATION: [number, number] = [-space[8], space[8]];
const BODY_FAIL_X: [number, number] = [-space[16], space[16]];

const useStyles = createStyles((t) => ({
  // `clip` on web: focus lands in the sheet while the panel is still below the screen, and a `hidden` box would scroll to it,
  // which leaves the panel at full height for good.
  root: { flex: 1, overflow: (isWeb ? 'clip' : 'hidden') as 'hidden' },
  anchor: { alignItems: 'center', bottom: 0, left: 0, pointerEvents: 'box-none', position: 'absolute', right: 0 },
  panel: {
    backgroundColor: t.color.bg.raised,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
    boxShadow: t.colorScheme === 'light' ? t.shadow.sheet : undefined,
    maxWidth: t.layout.feedColumn,
    width: '100%',
  },
  // Three quarters of the feed column.
  panelNarrow: { maxWidth: (t.layout.feedColumn * 3) / 4 },
  header: { paddingBottom: t.space[8] },
  grabberTarget: { alignSelf: 'center', marginTop: t.space[8] },
  grabber: {
    backgroundColor: t.color.border.strong,
    borderRadius: t.radius.xs,
    flexGrow: 0,
    height: t.size.grabber.height,
    width: t.size.grabber.width,
  },
  title: { marginTop: t.space[12], ...NO_BROWSER_OUTLINE },
  focusStart: { height: 0, position: 'absolute', width: 0, ...NO_BROWSER_OUTLINE },
  bodyArea: { flex: 1, minHeight: 0 },
  footer: {
    backgroundColor: t.color.bg.raised,
    bottom: 0,
    left: 0,
    paddingTop: t.space[12],
    position: 'absolute',
    right: 0,
  },
  footerLine: { left: 0, position: 'absolute', right: 0, top: 0 },
  // DQ-334, §8 header: the hairline under the title shows once the body scrolls under it. Over the header's bottom padding, so
  // the header keeps its height and nothing moves when it appears.
  headerLine: { bottom: 0, left: 0, position: 'absolute', right: 0 },
  exiting: { pointerEvents: 'none' },
}));

/**
 * §8 bottom sheet: top radius 16, grabber 36 × 4, snap points content and 90 %, spring.sheet, scrim fade 200.
 * Motion stays on transform and opacity: the panel is always 90 % high and rests partly below the screen at the
 * content snap, with the footer counter-translated to the visible edge.
 */
export function Sheet(props: SheetProps) {
  const motion = useMotion();
  const mounted = usePresence(props.visible, motion.duration.medium);
  return mounted ? <SheetPanel {...props} /> : null;
}

function SheetPanel({
  visible,
  onClose,
  title,
  label,
  children,
  footer,
  initialSnap = 'content',
  expandable = true,
  narrow = false,
  dismissable = true,
  onSnapChange,
  testID,
}: SheetProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const motion = useMotion();
  const { height: windowHeight } = useWindowDimensions();
  const { gutter, kind } = useBreakpoint();
  const safeInset = useSafeInset('bottom');
  const { height: keyboardHeight, progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const { springTo, timingTo, reduced } = motion;

  const [stageHeight, setStageHeight] = useState(windowHeight);
  const panelHeight = Math.round(stageHeight * size.sheetMaxHeightRatio);
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const [footerHeight, setFooterHeight] = useState<number | null>(null);
  const [snap, setSnapState] = useState<SheetSnap>(initialSnap);
  const [scrolledUnder, setScrolledUnder] = useState(false);
  // Only the crossing re-renders, not every scroll event.
  const onBodyScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const under = event.nativeEvent.contentOffset.y > 0;
    setScrolledUnder((current) => (current === under ? current : under));
  };

  const measured = headerHeight !== null && bodyHeight !== null && (!footer || footerHeight !== null);
  const footerSpace = footer ? (footerHeight ?? 0) : 0;
  const contentHeight = (headerHeight ?? 0) + (bodyHeight ?? 0) + footerSpace;
  const contentY = contentOffset(panelHeight, contentHeight);
  const canExpand = expandable && contentY > 0;
  const scrollable = measured && contentHeight > panelHeight;
  const restingY = snap === 'full' ? 0 : contentY;

  // Starts below the screen; reduced motion shows it in place through a crossfade instead.
  const y = useSharedValue(windowHeight);
  const fade = useSharedValue(reduced ? 0 : 1);
  const scrim = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const restingYShared = useSharedValue(windowHeight);
  const contentYShared = useSharedValue(contentY);
  const panelHeightShared = useSharedValue(panelHeight);

  const visibleRef = useRef(visible);
  const snapRef = useRef(snap);
  const stageRef = useRef<unknown>(null);
  const focusStartRef = useRef<unknown>(null);
  const setStage = (node: unknown) => {
    stageRef.current = node;
  };
  const setFocusStart = (node: unknown) => {
    focusStartRef.current = node;
  };

  useEffect(() => {
    if (isWeb) moveFocusIntoSheet(stageRef.current as HTMLElement | null, focusStartRef.current as HTMLElement | null, document.activeElement);
  }, []);

  useEffect(() => {
    visibleRef.current = visible;
    if (!visible) {
      scrim.set(timingTo(0, 'small'));
      if (reduced) fade.set(timingTo(0, 'small'));
      else y.set(springTo(panelHeight, 'sheet'));
      return;
    }
    if (!measured) return;
    scrim.set(timingTo(1, 'small'));
    contentYShared.set(contentY);
    panelHeightShared.set(panelHeight);
    restingYShared.set(restingY);
    if (reduced) {
      y.set(restingY);
      fade.set(timingTo(1, 'small'));
    } else {
      y.set(springTo(restingY, 'sheet'));
    }
  }, [
    visible,
    measured,
    restingY,
    contentY,
    panelHeight,
    reduced,
    springTo,
    timingTo,
    y,
    fade,
    scrim,
    contentYShared,
    panelHeightShared,
    restingYShared,
  ]);

  const setSnap = (next: SheetSnap) => {
    if (snapRef.current === next) return;
    if (next === 'full') haptics.light();
    snapRef.current = next;
    setSnapState(next);
    onSnapChange?.(next);
  };

  const requestClose = () => {
    // Stays mounted for the exit animation: the scrim, Escape and Android back must not close it a second time.
    if (!dismissable || !visibleRef.current) return;
    onClose();
    // A parent that keeps the sheet open, for example behind a guard, gets it back at its resting point.
    requestAnimationFrame(() => {
      if (visibleRef.current) y.set(springTo(restingY, 'sheet'));
    });
  };

  const onDragEnd = (target: SheetTarget) => {
    if (target === 'close') requestClose();
    else setSnap(target);
  };

  const onPanBegin = () => {
    'worklet';
    dragStart.set(y.get());
  };
  const onPanUpdate = (event: { translationY: number }) => {
    'worklet';
    y.set(Math.max(0, dragStart.get() + event.translationY));
  };
  const onPanEnd = (event: { velocityY: number }) => {
    'worklet';
    const target = settleTarget(
      y.get(),
      event.velocityY,
      contentYShared.get(),
      panelHeightShared.get(),
      expandable,
      dismissable,
    );
    if (target !== 'close') y.set(springTo(target === 'full' ? 0 : contentYShared.get(), 'sheet'));
    scheduleOnRN(onDragEnd, target);
  };
  const headerPan = usePanGesture({
    onBegin: onPanBegin,
    onUpdate: onPanUpdate,
    onDeactivate: onPanEnd,
    activeOffsetY: HEADER_ACTIVATION,
    testID: testID ? `${testID}.headerPan` : undefined,
  });
  // A body that scrolls keeps its own gesture; only the header moves the sheet then.
  const bodyPan = usePanGesture({
    onBegin: onPanBegin,
    onUpdate: onPanUpdate,
    onDeactivate: onPanEnd,
    activeOffsetY: BODY_ACTIVATION,
    failOffsetX: BODY_FAIL_X,
    enabled: !scrollable,
    testID: testID ? `${testID}.bodyPan` : undefined,
  });

  const panelStyle = useAnimatedStyle(() => {
    const lift = keyboardHeight.get() + keyboardProgress.get() * safeInset;
    return { opacity: fade.get(), transform: [{ translateY: panelTranslate(y.get(), lift) }] };
  });
  const footerStyle = useAnimatedStyle(() => {
    const lift = keyboardHeight.get() + keyboardProgress.get() * safeInset;
    return { transform: [{ translateY: footerTranslate(y.get(), lift, restingYShared.get()) }] };
  });

  const footerSafe = useSafeEdge('bottom', space[12]);
  const bodySafe = useSafeEdge('bottom', space[16]);
  const accessibleName = title ?? label ?? '';

  const heightFrom = (setter: (value: number) => void) => (event: LayoutChangeEvent) =>
    setter(event.nativeEvent.layout.height);

  return (
    <OverlayModal label={accessibleName} onRequestClose={requestClose}>
      <View ref={setStage} style={styles.root} onLayout={heightFrom(setStageHeight)}>
        <Scrim progress={scrim} onPress={requestClose} testID={testID ? `${testID}.scrim` : undefined} />
        <View style={styles.anchor}>
          <Animated.View
            {...(isWeb ? {} : { role: 'dialog' as const, 'aria-modal': true, 'aria-label': accessibleName })}
            accessibilityViewIsModal
            onAccessibilityEscape={requestClose}
            testID={testID}
            style={[styles.panel, narrow && kind !== 'phone' ? styles.panelNarrow : null, { height: panelHeight }, panelStyle, visible ? null : styles.exiting]}
          >
            <GestureDetector gesture={headerPan} touchAction="none" userSelect="none">
              <View style={styles.header} onLayout={heightFrom(setHeaderHeight)} testID={testID ? `${testID}.header` : undefined}>
                {isWeb && !title ? <View ref={setFocusStart} {...FOCUS_TARGET} style={styles.focusStart} testID={testID ? `${testID}.focusStart` : undefined} /> : null}
                {canExpand ? (
                  <PressableScale
                    role="button"
                    aria-label={t('a11y.sheetGrabber')}
                    aria-expanded={snap === 'full'}
                    feedback={false}
                    visualHeight={size.grabber.height}
                    visualWidth={size.grabber.width}
                    onPress={() => setSnap(snap === 'full' ? 'content' : 'full')}
                    style={styles.grabberTarget}
                    contentStyle={styles.grabber}
                    testID={testID ? `${testID}.grabber` : undefined}
                  />
                ) : (
                  <View aria-hidden style={[styles.grabberTarget, styles.grabber]} />
                )}
                {title ? (
                  <Text
                    ref={setFocusStart}
                    {...FOCUS_TARGET}
                    variant="titleM"
                    role="heading"
                    style={[styles.title, { paddingHorizontal: gutter }]}
                    testID={testID ? `${testID}.title` : undefined}
                  >
                    {keepShortNamesTogether(title)}
                  </Text>
                ) : null}
                {scrolledUnder ? <Hairline style={styles.headerLine} testID={testID ? `${testID}.headerLine` : undefined} /> : null}
              </View>
            </GestureDetector>
            <GestureDetector gesture={bodyPan} touchAction={scrollable ? 'pan-y' : 'none'}>
              <View style={styles.bodyArea}>
                <KeyboardAwareScrollView
                  bottomOffset={footerSpace + size.touchMin}
                  bounces={scrollable}
                  keyboardShouldPersistTaps="handled"
                  overScrollMode="never"
                  scrollEnabled={scrollable}
                  showsVerticalScrollIndicator={scrollable}
                  onScroll={onBodyScroll}
                >
                  <View
                    dataSet={{ qaExempt: 'safe-area' }}
                    onLayout={heightFrom(setBodyHeight)}
                    style={[{ paddingHorizontal: gutter }, footer ? null : bodySafe]}
                    testID={testID ? `${testID}.body` : undefined}
                  >
                    {children}
                  </View>
                  {footer ? <View style={{ height: footerSpace }} /> : null}
                </KeyboardAwareScrollView>
              </View>
            </GestureDetector>
            {footer ? (
              <Animated.View
                dataSet={{ qaExempt: 'safe-area' }}
                onLayout={heightFrom(setFooterHeight)}
                style={[styles.footer, { paddingHorizontal: gutter }, footerSafe, footerStyle]}
                testID={testID ? `${testID}.footer` : undefined}
              >
                <Hairline style={styles.footerLine} />
                {footer}
              </Animated.View>
            ) : null}
          </Animated.View>
        </View>
      </View>
    </OverlayModal>
  );
}
