import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { createStyles, zIndex } from '@/theme';

const useStyles = createStyles(() => ({
  overlay: { position: 'absolute', zIndex: zIndex.sticky },
}));

/** Whether the block has reached its pinned place, outside React state: only the two places of the block listen. */
export type PinStore = { get: () => boolean; subscribe: (listener: () => void) => () => void };

function createPinStore() {
  let pinned = false;
  const listeners = new Set<() => void>();
  return {
    get: () => pinned,
    set: (next: boolean) => {
      if (next === pinned) return;
      pinned = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The scroll offset from which a block whose row starts at `rowTop` sits at `pinnedTop` (or above it, without the pin). */
export function pinsAt(scrollY: number, rowTop: number | undefined, pinnedTop: number): boolean {
  'worklet';
  if (rowTop === undefined || !Number.isFinite(rowTop)) return false;
  return scrollY >= rowTop - pinnedTop;
}

/**
 * R4-1.1: the pin of the web's phone and tablet layouts as one flip at the threshold. The block itself scrolls natively in its list
 * row (the browser moves it on the compositor, in step with the content); once the page has scrolled it to `pinnedTop`, a fixed copy
 * takes over (`FlowPinnedCopy`) and the row keeps its place empty. Nothing moves per frame, so a late scroll event cannot make the
 * block lag or jump (the per-frame `Pinned` stays for native and the desktop).
 */
export function usePinStore(
  scrollY: SharedValue<number>,
  rowTops: SharedValue<Record<string, number>>,
  anchorKey: string,
  pinnedTop: number,
  enabled: boolean,
): PinStore {
  const store = useMemo(() => createPinStore(), []);
  useAnimatedReaction(
    () => enabled && pinsAt(scrollY.get(), rowTops.get()[anchorKey], pinnedTop),
    (now, previous) => {
      if (now !== previous) scheduleOnRN(store.set, now);
    },
  );
  return store;
}

export function usePinned(store: PinStore): boolean {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export type FlowPinnedRowProps = {
  store: PinStore;
  /** The row's height while the copy is pinned, so the content under it keeps its place. */
  height: number;
  onHeight: (height: number) => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/** The block in its list row; while the copy is pinned an empty box of its height (one element carries the block's IDs). */
export function FlowPinnedRow({ store, height, onHeight, style, children }: FlowPinnedRowProps) {
  const pinned = usePinned(store);
  return (
    <View style={style}>
      {pinned ? (
        <View style={{ height }} />
      ) : (
        <View onLayout={(event: LayoutChangeEvent) => onHeight(Math.ceil(event.nativeEvent.layout.height))}>{children}</View>
      )}
    </View>
  );
}

export type FlowPinnedCopyProps = {
  store: PinStore;
  /** From the scroller's top (the list header that holds it is stuck there). */
  top: number;
  left: number;
  width: number;
  children: ReactNode;
  testID?: string;
};

/** The fixed copy at `top`, drawn only while the block is pinned. */
export function FlowPinnedCopy({ store, top, left, width, children, testID }: FlowPinnedCopyProps) {
  const styles = useStyles();
  const pinned = usePinned(store);
  if (!pinned) return null;
  return (
    <View style={[styles.overlay, { left, top, width }]} testID={testID}>
      {children}
    </View>
  );
}
