import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptics } from '@/lib/haptics';
import { isIOS, isWeb } from '@/lib/platform';
import { createStyles, useMotion } from '@/theme';
import { Icon, PressableScale, Text } from '@/ui';
import { keyOf as keyOfEvent } from '@/ui/useRovingKeys';

import { deltaForKey, moveByKey, slotAt, slotPosition, type SlotCell } from '../model';

/** Touch holds this long on a cell before it lifts; the handle lifts at once, also for a mouse. */
const LONG_PRESS_MS = 250;
const LIFT_SCALE = 1.02;

export type SortableProps<T> = {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** The item's name for the handle and the announcement: "Nissan Skyline GT-R R34". */
  labelOf: (item: T) => string;
  /** 1 for a list, 3 for the photo grid. */
  columns?: number;
  /** A list row's height. */
  rowHeight?: number;
  /** A grid cell's width / height. */
  aspectRatio?: number;
  gap: number;
  /** The item; it places `<SortHandleSlot />` where its grip goes. */
  renderItem: (item: T, state: { index: number; active: boolean }) => ReactNode;
  /** The new order, after a drop or a key press. */
  onChange: (next: T[]) => void;
  /** While a pointer holds a cell, so the parent can stop scrolling. */
  onDragging?: (dragging: boolean) => void;
  disabled?: boolean;
  /** `onPhoto` draws the grip in white, for handles over photos (GAR-07). */
  handleTone?: 'default' | 'onPhoto';
  testID: string;
};

const useStyles = createStyles((t) => ({
  root: { position: 'relative' },
  cell: { left: 0, position: 'absolute', top: 0 },
  handle: { alignItems: 'center', height: t.size.touchMin, justifyContent: 'center', width: t.size.touchMin },
  handleVisual: { alignItems: 'center', borderRadius: t.radius.sm, height: t.size.touchMin, justifyContent: 'center', width: t.size.touchMin },
  live: { height: t.space[2], left: 0, opacity: 0, overflow: 'hidden', pointerEvents: 'none', position: 'absolute', top: 0, width: t.space[2] },
}));

type HandleContext = {
  handle: ReactNode;
  begin: () => void;
  follow: (event: { translationX: number; translationY: number }) => void;
  end: () => void;
  disabled: boolean;
  testID: string;
};

const SortHandleContext = createContext<HandleContext | null>(null);

/**
 * Reorder by touch, mouse and keyboard (GAR-01 "Sortieren", GAR-07, GAR-09). Cells sit at fixed slots and slide with
 * spring.snappy; a held cell follows the pointer on the UI thread and the others make room under it. The handle is a
 * button: arrow keys move its item by one place, screen readers get the same moves as actions, and every move is announced.
 * The order reaches the parent once per drop or key press. The sets are bounded (20 vehicles, 30 photos, a category's
 * mods), so every cell is mounted.
 */
export function Sortable<T>({
  items,
  keyOf,
  labelOf,
  columns = 1,
  rowHeight,
  aspectRatio = 1,
  gap,
  renderItem,
  onChange,
  onDragging,
  disabled = false,
  handleTone = 'default',
  testID,
}: SortableProps<T>) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [held, setHeld] = useState<string | null>(null);
  const keys = useMemo(() => items.map(keyOf), [items, keyOf]);
  const order = useSharedValue<string[]>(keys);
  const activeKey = useSharedValue<string | null>(null);

  useEffect(() => {
    order.set(keys);
  }, [keys, order]);

  const cellWidth = width > 0 ? (width - gap * (columns - 1)) / columns : 0;
  const cellHeight = rowHeight ?? (cellWidth > 0 ? cellWidth / aspectRatio : 0);
  const cell = useMemo<SlotCell>(() => ({ width: cellWidth, height: cellHeight, gap, columns }), [cellWidth, cellHeight, gap, columns]);
  const rows = Math.ceil(items.length / columns);
  const height = rows > 0 && cellHeight > 0 ? rows * cellHeight + (rows - 1) * gap : 0;

  const announce = (key: string, index: number) => {
    const item = items.find((entry) => keyOf(entry) === key);
    if (!item) return;
    const text = t('sort.position', { name: labelOf(item), position: index + 1, total: items.length });
    // The live region below speaks on web and Android; iOS has no live regions, so VoiceOver is told directly.
    setAnnouncement(text);
    if (isIOS) AccessibilityInfo.announceForAccessibility(text);
  };

  const lift = (key: string) => {
    haptics.light();
    setHeld(key);
    onDragging?.(true);
  };

  const drop = (nextKeys: string[]) => {
    const byKey = new Map(items.map((item) => [keyOf(item), item]));
    const next = nextKeys.flatMap((entry) => {
      const item = byKey.get(entry);
      return item ? [item] : [];
    });
    setHeld(null);
    onDragging?.(false);
    if (next.length === items.length && next.some((item, index) => item !== items[index])) onChange(next);
  };

  const moveByKeyboard = (key: string, delta: number) => {
    const moved = moveByKey(items, keyOf, key, delta);
    if (!moved) return;
    haptics.selection();
    onChange(moved.list);
    announce(key, moved.index);
  };

  return (
    <View style={[styles.root, { height }]} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)} testID={testID}>
      {cellWidth > 0
        ? items.map((item, index) => {
            const key = keyOf(item);
            return (
              <SortableCell
                key={key}
                itemKey={key}
                index={index}
                count={items.length}
                cell={cell}
                order={order}
                activeKey={activeKey}
                disabled={disabled}
                onLift={lift}
                onDrop={drop}
                onAnnounce={announce}
                handle={
                  <SortHandle
                    label={t('sort.handle', { name: labelOf(item) })}
                    hint={t('sort.hint')}
                    upLabel={t(columns > 1 ? 'sort.moveBack' : 'sort.moveUp')}
                    downLabel={t(columns > 1 ? 'sort.moveForward' : 'sort.moveDown')}
                    columns={columns}
                    tone={handleTone}
                    disabled={disabled}
                    onMove={(delta) => moveByKeyboard(key, delta)}
                    testID={`${testID}.${key}.handle`}
                  />
                }
                testID={`${testID}.${key}`}
              >
                {renderItem(item, { index, active: held === key })}
              </SortableCell>
            );
          })
        : null}
      <View aria-live="polite" role="status" style={styles.live} testID={`${testID}.announcement`}>
        <Text variant="caption">{announcement}</Text>
      </View>
    </View>
  );
}

type SortableCellProps = {
  itemKey: string;
  index: number;
  count: number;
  cell: SlotCell;
  order: SharedValue<string[]>;
  activeKey: SharedValue<string | null>;
  disabled: boolean;
  onLift: (key: string) => void;
  onDrop: (order: string[]) => void;
  onAnnounce: (key: string, index: number) => void;
  handle: ReactNode;
  children: ReactNode;
  testID: string;
};

function SortableCell({ itemKey, index, count, cell, order, activeKey, disabled, onLift, onDrop, onAnnounce, handle, children, testID }: SortableCellProps) {
  const styles = useStyles();
  const { springTo } = useMotion();
  const home = slotPosition(index, cell);
  const x = useSharedValue(home.x);
  const y = useSharedValue(home.y);
  const start = useSharedValue({ x: 0, y: 0 });
  const lifted = useSharedValue(0);

  // Every cell sits where the shared order puts it: a neighbour's drag slides it aside, a new layout places it directly.
  useAnimatedReaction(
    () => order.get().indexOf(itemKey),
    (slot, previous) => {
      if (slot === -1 || activeKey.get() === itemKey) return;
      const target = slotPosition(slot, cell);
      if (previous === null) {
        x.set(target.x);
        y.set(target.y);
      } else if (slot !== previous) {
        x.set(springTo(target.x));
        y.set(springTo(target.y));
      }
    },
    // Native follows the closure by itself and warns about dependencies; the web needs them.
    isWeb ? [cell, itemKey] : undefined,
  );

  const begin = () => {
    'worklet';
    activeKey.set(itemKey);
    start.set({ x: x.get(), y: y.get() });
    lifted.set(springTo(1));
    scheduleOnRN(onLift, itemKey);
  };

  const follow = (event: { translationX: number; translationY: number }) => {
    'worklet';
    if (activeKey.get() !== itemKey) return;
    const nextX = start.get().x + event.translationX;
    const nextY = start.get().y + event.translationY;
    x.set(nextX);
    y.set(nextY);
    const slot = slotAt(nextX, nextY, cell, count);
    const current = order.get();
    const from = current.indexOf(itemKey);
    if (from !== -1 && slot !== from) {
      const next = current.slice();
      next.splice(from, 1);
      next.splice(slot, 0, itemKey);
      order.set(next);
      scheduleOnRN(onAnnounce, itemKey, slot);
    }
  };

  const end = () => {
    'worklet';
    if (activeKey.get() !== itemKey) return;
    const slot = Math.max(0, order.get().indexOf(itemKey));
    const target = slotPosition(slot, cell);
    x.set(springTo(target.x));
    y.set(springTo(target.y));
    lifted.set(springTo(0));
    activeKey.set(null);
    scheduleOnRN(onDrop, order.get());
  };

  const cellPan = usePanGesture({
    enabled: !disabled,
    activateAfterLongPress: LONG_PRESS_MS,
    onActivate: begin,
    onUpdate: follow,
    onDeactivate: end,
    testID: `${testID}.pan`,
  });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: 1 + (LIFT_SCALE - 1) * lifted.get() }],
    zIndex: activeKey.get() === itemKey ? 1 : 0,
  }));

  const context: HandleContext = { handle, begin, follow, end, disabled, testID };

  return (
    <GestureDetector gesture={cellPan} touchAction="pan-y" userSelect="none">
      <Animated.View style={[styles.cell, { width: cell.width, height: cell.height }, style]} testID={testID}>
        <SortHandleContext value={context}>{children}</SortHandleContext>
      </Animated.View>
    </GestureDetector>
  );
}

/** Where an item puts its grip, usually at the trailing edge of its row. Dragging it lifts the cell at once. */
export function SortHandleSlot() {
  const context = use(SortHandleContext);
  // Only the worklets travel to the UI thread, not the rest of the context.
  const begin = context?.begin;
  const follow = context?.follow;
  const end = context?.end;
  const pan = usePanGesture({
    enabled: context ? !context.disabled : false,
    minDistance: 0,
    onActivate: () => {
      'worklet';
      begin?.();
    },
    onUpdate: (event) => {
      'worklet';
      follow?.(event);
    },
    onDeactivate: () => {
      'worklet';
      end?.();
    },
    testID: context ? `${context.testID}.handlePan` : undefined,
  });
  if (!context) return null;
  return (
    <GestureDetector gesture={pan} touchAction="none" userSelect="none">
      <View>{context.handle}</View>
    </GestureDetector>
  );
}

type SortHandleProps = {
  label: string;
  hint: string;
  upLabel: string;
  downLabel: string;
  columns: number;
  tone: 'default' | 'onPhoto';
  disabled: boolean;
  onMove: (delta: number) => void;
  testID: string;
};

/** A 44 button with the grip glyph. Arrow keys move; screen readers get "Nach oben" and "Nach unten" as actions. */
function SortHandle({ label, hint, upLabel, downLabel, columns, tone, disabled, onMove, testID }: SortHandleProps) {
  const styles = useStyles();
  const onKeyDown = (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    const delta = deltaForKey(keyOfEvent(event), columns);
    if (delta === null) return;
    event.preventDefault?.();
    onMove(delta);
  };
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'moveUp') onMove(columns > 1 ? -1 : -columns);
    if (event.nativeEvent.actionName === 'moveDown') onMove(columns > 1 ? 1 : columns);
  };
  return (
    <PressableScale
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      accessibilityHint={isWeb ? undefined : hint}
      accessibilityActions={[
        { name: 'moveUp', label: upLabel },
        { name: 'moveDown', label: downLabel },
      ]}
      onAccessibilityAction={onAccessibilityAction}
      disabled={disabled}
      feedback={false}
      style={styles.handle}
      contentStyle={styles.handleVisual}
      testID={testID}
      {...({ onKeyDown, 'aria-describedby': undefined } as object)}
    >
      <Icon name="list" size={20} color={tone === 'onPhoto' ? 'onPhoto.primary' : 'text.tertiary'} />
    </PressableScale>
  );
}
