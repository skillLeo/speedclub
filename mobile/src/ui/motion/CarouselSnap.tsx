import { useEffect, useState, type ReactNode } from 'react';
import { View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';
import { motion as motionTokens } from '@/theme/tokens.generated';

import { IconButton } from '../IconButton';
import { hapticFor } from './haptics';
import { carouselIndex, carouselNeighbour, carouselProgress, lerp, reorderShift, reorderTarget } from './math';
import { useMotionPreference } from './preference';

const CAROUSEL = motionTokens.signature.carousel;

const useStyles = createStyles(() => ({
  root: { alignSelf: 'stretch' },
  row: { flexDirection: 'row' },
  moves: { flexDirection: 'row', justifyContent: 'center' },
}));

export type CarouselSnapProps<T> = {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** The card's name for screen readers' move actions ("BMW M3 E46"). */
  labelOf: (item: T) => string;
  renderItem: (item: T, state: { index: number; reordering: boolean }) => ReactNode;
  /** Card width and the gap between cards. */
  itemWidth: number;
  gap: number;
  /** Long-press reorder; without it the carousel only snaps. */
  onReorder?: (from: number, to: number) => void;
  /** "Nach links schieben" / "Nach rechts schieben" from the caller's namespace. */
  moveLabels?: { left: string; right: string };
  /**
   * Sortieren as a mode the caller switches (a "Reihenfolge ändern" button): the cards stay at the reorder scale and every card
   * shows visible move buttons, the single-pointer and keyboard way to reorder (WCAG 2.5.7) next to the long-press drag.
   */
  editing?: boolean;
  /** A double tap on a card on native, where the card is the focusable element that carries the move actions. */
  onOpen?: (item: T) => void;
  /** Written on the UI thread: scroll offset / interval, for an SM2 `PageIndicator` under the cards. */
  progress?: SharedValue<number>;
  /** The centred card changed (also on the JS side, for one focused action row); not called for the first card at mount. */
  onIndexChange?: (index: number) => void;
  testID: string;
};

/**
 * SM16 garage carousel (09 §4.7): snapping cards, the centred one at full size, its neighbours at 0.94 scale and 0.7 opacity,
 * both read from the scroll position on the UI thread. A long press enters reorder mode: every card shrinks to 0.9 (spring.default),
 * the held one follows the finger and the others make room; medium haptic on pick-up (09 §4.8). Screen readers move a card
 * with its "move left/right" actions. Reduced motion: the neighbours keep full size (opacity still marks the focus), reorder
 * mode keeps the cards at full size.
 */
export function CarouselSnap<T>({
  items,
  keyOf,
  labelOf,
  renderItem,
  itemWidth,
  gap,
  onReorder,
  moveLabels,
  editing = false,
  onOpen,
  progress,
  onIndexChange,
  testID,
}: CarouselSnapProps<T>) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const [width, setWidth] = useState(0);
  const [reordering, setReordering] = useState(false);
  const scrollX = useSharedValue(0);
  const mode = useSharedValue(0);
  const dragFrom = useSharedValue(-1);
  const dragTo = useSharedValue(-1);
  const drag = useSharedValue(0);
  const interval = itemWidth + gap;
  // The first and last card sit in the middle at rest.
  const inset = Math.max(0, (width - itemWidth) / 2);

  const shrunk = reordering || editing;
  useEffect(() => {
    mode.set(motion.reduced ? (shrunk ? 1 : 0) : motion.springTo(shrunk ? 1 : 0, 'default'));
  }, [mode, motion, shrunk]);

  const focused = useSharedValue(0);
  const count = items.length;
  const announce = (index: number) => onIndexChange?.(index);
  const onScroll = useAnimatedScrollHandler((event) => {
    const x = event.contentOffset.x;
    scrollX.set(x);
    progress?.set(carouselProgress(x, interval));
    const index = carouselIndex(x, interval, count);
    if (index !== focused.get()) {
      focused.set(index);
      scheduleOnRN(announce, index);
    }
  });

  const pickUp = () => {
    hapticFor('reorderPickUp');
    setReordering(true);
  };
  const drop = (from: number, to: number) => {
    setReordering(false);
    if (from >= 0 && to >= 0 && from !== to) onReorder?.(from, to);
  };

  return (
    <View style={styles.root} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)} testID={testID}>
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={interval}
        decelerationRate="fast"
        scrollEnabled={!reordering}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.row, { gap, paddingHorizontal: inset }]}
        testID={`${testID}.scroll`}
      >
        {items.map((item, index) => (
          <CarouselCard
            key={keyOf(item)}
            index={index}
            count={items.length}
            interval={interval}
            width={itemWidth}
            scrollX={scrollX}
            mode={mode}
            drag={drag}
            dragFrom={dragFrom}
            dragTo={dragTo}
            reduced={motion.reduced}
            reorderable={onReorder !== undefined}
            editing={editing}
            onOpen={onOpen ? () => onOpen(item) : undefined}
            onPickUp={pickUp}
            onDrop={drop}
            label={labelOf(item)}
            moveLabels={moveLabels}
            onMove={(to) => onReorder?.(index, to)}
            testID={`${testID}.card.${keyOf(item)}`}
          >
            {renderItem(item, { index, reordering: shrunk })}
          </CarouselCard>
        ))}
      </Animated.ScrollView>
    </View>
  );
}

type CardProps = {
  index: number;
  count: number;
  interval: number;
  width: number;
  scrollX: SharedValue<number>;
  mode: SharedValue<number>;
  drag: SharedValue<number>;
  dragFrom: SharedValue<number>;
  dragTo: SharedValue<number>;
  reduced: boolean;
  reorderable: boolean;
  editing: boolean;
  onOpen?: () => void;
  onPickUp: () => void;
  onDrop: (from: number, to: number) => void;
  label: string;
  moveLabels?: { left: string; right: string };
  onMove: (to: number) => void;
  children: ReactNode;
  testID: string;
};

function CarouselCard(props: CardProps) {
  const { index, count, interval, width, scrollX, mode, drag, dragFrom, dragTo, reduced, reorderable, editing, onOpen, onPickUp, onDrop, label, moveLabels, onMove, children, testID } =
    props;
  const styles = useStyles();
  const motion = useMotionPreference();
  const pan = usePanGesture({
    enabled: reorderable,
    activateAfterLongPress: CAROUSEL.longPress,
    testID: `${testID}.reorder`,
    onActivate: () => {
      'worklet';
      dragFrom.set(index);
      dragTo.set(index);
      drag.set(0);
      scheduleOnRN(onPickUp);
    },
    onUpdate: (event) => {
      'worklet';
      drag.set(event.translationX);
      dragTo.set(reorderTarget(index, event.translationX, interval, count));
    },
    onDeactivate: () => {
      'worklet';
      const from = dragFrom.get();
      const to = dragTo.get();
      // The card settles into its new slot from where the finger left it. The dragged index holds until the spring has
      // settled, so the card is not handed to the shift of the others mid-flight (it would jump); then the list reorders.
      drag.set(
        motion.springTo((to - from) * interval, 'calm', () => {
          'worklet';
          scheduleOnRN(settled, from, to);
        }),
      );
    },
  });
  /** After the settle: the new order first, then the drag state goes, in the same JS turn as the re-render. */
  function settled(from: number, to: number) {
    onDrop(from, to);
    dragFrom.set(-1);
    dragTo.set(-1);
    drag.set(0);
  }

  const style = useAnimatedStyle(() => {
    const neighbour = carouselNeighbour(scrollX.get(), index, interval, CAROUSEL.neighbourScale, CAROUSEL.neighbourOpacity, reduced);
    const m = mode.get();
    const scale = reduced ? 1 : lerp(neighbour.scale, CAROUSEL.reorderScale, m);
    const opacity = lerp(neighbour.opacity, 1, m);
    const from = dragFrom.get();
    const dragging = from === index;
    const shift = from >= 0 && !dragging ? reorderShift(index, from, dragTo.get(), interval) : 0;
    return {
      opacity,
      zIndex: dragging ? 1 : 0,
      transform: [{ translateX: dragging ? drag.get() : shift }, { scale }],
    };
  });

  const canLeft = index > 0;
  const canRight = index < count - 1;
  const moves = reorderable && moveLabels ? moveLabels : undefined;
  const actions = [
    ...(onOpen ? [{ name: 'activate', label }] : []),
    ...(moves && canLeft ? [{ name: 'moveLeft', label: moves.left }] : []),
    ...(moves && canRight ? [{ name: 'moveRight', label: moves.right }] : []),
  ];
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    if (name === 'activate') onOpen?.();
    if (name === 'moveLeft' && canLeft) onMove(index - 1);
    if (name === 'moveRight' && canRight) onMove(index + 1);
  };
  // Native: the card is one focusable element, so VoiceOver and TalkBack offer its actions (they only list the actions of the
  // focused element). Web keeps the content's own focus order and reorders through the visible move buttons.
  const focusable = !isWeb && actions.length > 0;

  return (
    <View style={{ width }}>
      <GestureDetector gesture={pan} touchAction="pan-x">
        <Animated.View
          accessible={focusable}
          role={focusable && onOpen ? 'button' : undefined}
          aria-label={focusable ? label : undefined}
          accessibilityActions={focusable ? actions : undefined}
          onAccessibilityAction={focusable ? onAccessibilityAction : undefined}
          style={[{ width }, style]}
          testID={testID}
        >
          {children}
        </Animated.View>
      </GestureDetector>
      {editing && moves ? (
        <View style={styles.moves}>
          <IconButton
            icon="caret-left"
            label={`${moves.left}: ${label}`}
            disabled={!canLeft}
            onPress={() => onMove(index - 1)}
            testID={`${testID}.moveLeft`}
          />
          <IconButton
            icon="caret-right"
            label={`${moves.right}: ${label}`}
            disabled={!canRight}
            onPress={() => onMove(index + 1)}
            testID={`${testID}.moveRight`}
          />
        </View>
      ) : null}
    </View>
  );
}
