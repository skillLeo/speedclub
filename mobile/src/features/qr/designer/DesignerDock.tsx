import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptics } from '@/lib/haptics';
import { createStyles, size, space } from '@/theme';
import { PressableScale } from '@/ui/PressableScale';
import { useMotionPreference } from '@/ui/motion';
import { SHEET_FLICK_VELOCITY } from '@/ui/sheetMath';

/** The expanded detent: this share of the room above the action bar, so the preview always keeps a strip (10 §2.3). */
export const DOCK_EXPANDED_RATIO = 0.72;
const HEADER_ACTIVATION: [number, number] = [-space[4], space[4]];

export type DockDetent = 'compact' | 'expanded';

/** Where a released dock settles (the Sheet's rule, without "close": the editor's controls never go away). */
export function dockTarget(offset: number, velocityY: number, travel: number): DockDetent {
  'worklet';
  if (velocityY > SHEET_FLICK_VELOCITY) return 'compact';
  if (velocityY < -SHEET_FLICK_VELOCITY) return 'expanded';
  return offset < travel / 2 ? 'expanded' : 'compact';
}

const useStyles = createStyles((t) => ({
  panel: {
    backgroundColor: t.color.bg.raised,
    borderTopLeftRadius: t.radius.xl,
    borderTopRightRadius: t.radius.xl,
    boxShadow: t.colorScheme === 'light' ? t.shadow.sheet : undefined,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  header: { paddingBottom: t.space[8] },
  grabberTarget: { alignSelf: 'center', marginTop: t.space[8] },
  grabber: {
    backgroundColor: t.color.border.strong,
    borderRadius: t.radius.xs,
    height: t.size.grabber.height,
    width: t.size.grabber.width,
  },
  body: { flex: 1 },
}));

export type DesignerDockProps = {
  /** The room between the stage's top and the action bar. */
  room: number;
  /** Over the grabber, always visible: the template rail. */
  header: ReactNode;
  children: ReactNode;
  /** 0 at the compact detent, 1 expanded: the stage scales with it. */
  progress: SharedValue<number>;
  /** Reports the compact detent's height, so the stage takes the rest. */
  onCompactHeight: (height: number) => void;
  gutter: number;
  /** The detent it opens at (the matrix's `qaDesigner=expanded` capture). */
  initialDetent?: DockDetent;
  testID: string;
};

/**
 * STK-05's controls (10 §2.3 "controls in a bottom sheet with detents"): the in-house sheet's anatomy (radius 20, grabber 36 × 4,
 * spring.default, drag with flick, the grabber as a button) but **non-modal**: no scrim and no focus trap, because the member edits
 * while watching the live preview above it. Two detents: compact (the template rail) and expanded (every option). Transform only.
 */
export function DesignerDock({ room, header, children, progress, onCompactHeight, gutter, initialDetent = 'compact', testID }: DesignerDockProps) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const motion = useMotionPreference();
  const { springTo } = motion;
  const [headerHeight, setHeaderHeight] = useState(0);
  const [detent, setDetent] = useState<DockDetent>(initialDetent);
  // The options exist only while they can be seen (expanded, or being dragged up): off-screen controls would still take focus.
  const [dragging, setDragging] = useState(false);
  const expandedHeight = Math.max(headerHeight, Math.round(room * DOCK_EXPANDED_RATIO));
  const travel = Math.max(0, expandedHeight - headerHeight);

  const y = useSharedValue(travel);
  const start = useSharedValue(0);
  const travelShared = useSharedValue(travel);

  useEffect(() => {
    travelShared.set(travel);
    const target = detent === 'expanded' ? 0 : travel;
    y.set(motion.springTo(target, 'default'));
    progress.set(motion.springTo(detent === 'expanded' ? 1 : 0, 'default'));
  }, [detent, travel, motion, y, progress, travelShared]);

  const settle = (next: DockDetent) => {
    if (next !== detent) haptics.selection();
    setDetent(next);
    setDragging(false);
  };

  const pan = usePanGesture({
    onBegin: () => {
      'worklet';
      start.set(y.get());
    },
    onActivate: () => {
      'worklet';
      scheduleOnRN(setDragging, true);
    },
    onUpdate: (event: { translationY: number }) => {
      'worklet';
      const max = travelShared.get();
      const next = Math.max(0, Math.min(max, start.get() + event.translationY));
      y.set(next);
      progress.set(max > 0 ? 1 - next / max : 0);
    },
    onDeactivate: (event: { velocityY: number }) => {
      'worklet';
      const target = dockTarget(y.get(), event.velocityY, travelShared.get());
      y.set(springTo(target === 'expanded' ? 0 : travelShared.get(), 'default'));
      progress.set(springTo(target === 'expanded' ? 1 : 0, 'default'));
      scheduleOnRN(settle, target);
    },
    activeOffsetY: HEADER_ACTIVATION,
    testID: `${testID}.dockPan`,
  });

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));

  const onHeaderLayout = (event: LayoutChangeEvent) => {
    const height = Math.round(event.nativeEvent.layout.height);
    setHeaderHeight(height);
    onCompactHeight(height);
  };

  return (
    <Animated.View
      style={[styles.panel, { height: expandedHeight }, panelStyle]}
      role="region"
      aria-label={t('designer.dock.label')}
      testID={`${testID}.dock`}
    >
      <GestureDetector gesture={pan} touchAction="none" userSelect="none">
        <View style={styles.header} onLayout={onHeaderLayout}>
          <PressableScale
            role="button"
            aria-label={t(detent === 'expanded' ? 'designer.dock.collapse' : 'designer.dock.expand')}
            aria-expanded={detent === 'expanded'}
            feedback={false}
            visualHeight={size.grabber.height}
            visualWidth={size.grabber.width}
            onPress={() => settle(detent === 'expanded' ? 'compact' : 'expanded')}
            style={styles.grabberTarget}
            contentStyle={styles.grabber}
            testID={`${testID}.grabber`}
          />
          <View style={{ paddingHorizontal: gutter }}>{header}</View>
        </View>
      </GestureDetector>
      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: space[24] }}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={detent === 'expanded'}
        testID={`${testID}.dockBody`}
      >
        {detent === 'expanded' || dragging ? children : null}
      </ScrollView>
    </Animated.View>
  );
}
