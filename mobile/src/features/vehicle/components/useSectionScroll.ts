import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { cancelAnimation, useAnimatedReaction, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { isWeb } from '@/lib/platform';
import { useMotionPreference } from '@/ui/motion';

import { activeSectionAt, sectionScrollTarget, type ProfileAnchor, type ProfileSection, type SpyGeometry } from '../sections';

/** What a reader does on web to scroll on their own: the jump lets go at once (interruptible, 09 §4.7). Native has the drag event. */
const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'keydown'] as const;
/** Exact corrections after a jump, each two frames apart: rows drawn on the way can move the target more than once. */
const SETTLE_ROUNDS = 4;

type EventTarget = { addEventListener: (type: string, listener: (event: unknown) => void, options: { passive: boolean }) => void; removeEventListener: (type: string, listener: (event: unknown) => void) => void };

/** Two frames later: the list has drawn and measured the rows a scroll reached. */
function afterFrames(run: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(run));
}

function isEventTarget(value: unknown): value is EventTarget {
  return typeof value === 'object' && value !== null && 'addEventListener' in value && 'removeEventListener' in value;
}

/**
 * The section in view, outside React state: the spy changes it while the reader scrolls, and only the index listens
 * (`useCurrentSection`), so a change never renders the page's rows again.
 */
export type CurrentSectionStore = {
  get: () => ProfileSection | null;
  subscribe: (listener: () => void) => () => void;
};

function createCurrentStore(initial: readonly ProfileSection[]) {
  let index = -1;
  let sections = initial;
  let current: ProfileSection | null = null;
  const listeners = new Set<() => void>();
  const publish = () => {
    const next = sections[index] ?? null;
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => current,
    setIndex: (next: number) => {
      index = next;
      publish();
    },
    setSections: (next: readonly ProfileSection[]) => {
      sections = next;
      publish();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The section in view, for the index. */
export function useCurrentSection(store: CurrentSectionStore): ProfileSection | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export type SectionScroll = {
  current: CurrentSectionStore;
  /**
   * Scrolls to a section (spring.calm; the effect.default move under reduced motion; at once with `animated: false` or motion off).
   * `onArrive` runs once the section is in place and drawn (focus to its heading).
   */
  scrollTo: (anchor: ProfileAnchor, options?: { animated?: boolean; onArrive?: () => void }) => void;
  /** Reads the rows' offsets from the list again: after its first layout and whenever its content height changes. */
  refresh: () => void;
  /** Each row's top in the page by its key, on the UI thread, for the pinned blocks (missing before its layout). */
  rowTops: SharedValue<Record<string, number>>;
  /** The list's own events, spread on it. */
  listEvents: {
    onLoad: () => void;
    onContentSizeChange: (width: number, height: number) => void;
    onLayout: (event: { nativeEvent: { layout: { height: number } } }) => void;
    onScrollBeginDrag: () => void;
  };
  /** Ends the hold on the jumped-to section (re-tap to top, any scroll the page makes itself). */
  release: () => void;
  /** The list's opacity: under reduced motion a jump crossfades the list (effect.default) instead of moving it. */
  listOpacity: SharedValue<number>;
  /** Content height and viewport, on the UI thread, for the pinned blocks' clamp. */
  contentHeight: SharedValue<number>;
  viewport: SharedValue<number>;
};

export type UseSectionScrollArgs<T> = {
  listRef: RefObject<FlashListRef<T> | null>;
  scrollY: SharedValue<number>;
  /** The list's rows; `keyOf` names the row of each section and of every pinned anchor. */
  rows: readonly T[];
  keyOf: (row: T) => string;
  sections: readonly ProfileSection[];
  geometry: SpyGeometry;
};

/**
 * VEH-01's section index (10 §5.5, ADR-505): scroll-to with spring.calm and scroll-spy over one virtualised list. The sections'
 * offsets come from the list's own layout (`getLayout`), read again whenever its content height changes, so a section that grows
 * (an inline expand, a page of the rail) moves the targets with it. While a jump runs the spy holds the target, so the index does
 * not flicker through the sections in between; a drag or a scroll by the reader ends the jump where it is.
 */
export function useSectionScroll<T>({ listRef, scrollY, rows, keyOf, sections, geometry }: UseSectionScrollArgs<T>): SectionScroll {
  const motion = useMotionPreference();
  const [store] = useState(() => createCurrentStore(sections));
  useEffect(() => store.setSections(sections), [sections, store]);
  const setCurrentIndex = store.setIndex;
  const anchors = useSharedValue<number[]>([]);
  const spy = useSharedValue<SpyGeometry>(geometry);
  const contentHeight = useSharedValue(0);
  const viewport = useSharedValue(0);
  const driving = useSharedValue(false);
  const drive = useSharedValue(0);
  const rowTops = useSharedValue<Record<string, number>>({});
  const pendingAnchor = useRef<{ anchor: ProfileAnchor; animated: boolean } | null>(null);
  const arrive = useRef<(() => void) | null>(null);
  // The current jump; a settle of an older one stops.
  const settling = useRef(0);
  // The section the page is held at, for a settle again when the geometry changes under it (the index measured, the side list).
  const heldAnchor = useRef<ProfileAnchor | null>(null);
  // Review N2, DQ-M53-01: the section a jump went to stays current until the reader scrolls (a drag, wheel, touch, key or pointer),
  // whatever the anchors still estimate and wherever the end-of-list rule would point.
  const holding = useSharedValue(false);
  const heldIndex = useSharedValue(-1);
  const listOpacity = useSharedValue(1);

  useEffect(() => {
    spy.set(geometry);
  }, [geometry, spy]);

  const indexOfKey = useCallback((key: string) => rows.findIndex((row) => keyOf(row) === key), [keyOf, rows]);

  const topOf = useCallback(
    (key: string): number => {
      const list = listRef.current;
      const index = indexOfKey(key);
      if (!list || index < 0) return Number.NaN;
      const layout = list.getLayout(index);
      return layout ? layout.y + list.getFirstItemOffset() : Number.NaN;
    },
    [indexOfKey, listRef],
  );

  const refresh = useCallback(() => {
    const next = sections.map((section) => topOf(section));
    anchors.set(next);
    const byKey: Record<string, number> = {};
    for (const row of rows) {
      const top = topOf(keyOf(row));
      if (Number.isFinite(top)) byKey[keyOf(row)] = top;
    }
    rowTops.set(byKey);
  }, [anchors, keyOf, rowTops, rows, sections, topOf]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Scroll-spy on the UI thread; React hears only a change of section.
  useAnimatedReaction(
    () => {
      if (driving.get()) return -2;
      if (holding.get()) return heldIndex.get();
      const max = Math.max(0, contentHeight.get() - viewport.get());
      return activeSectionAt(scrollY.get(), anchors.get(), spy.get(), viewport.get(), max);
    },
    (now, previous) => {
      if (now !== -2 && now !== previous) scheduleOnRN(setCurrentIndex, now);
    },
  );

  /** After two frames: the list has drawn the rows the jump reached, so the heading exists to take focus. */
  const runArrive = useCallback(() => {
    const done = arrive.current;
    arrive.current = null;
    if (done) requestAnimationFrame(() => requestAnimationFrame(done));
  }, []);

  const stop = useCallback(() => {
    if (!driving.get()) return;
    cancelAnimation(drive);
    driving.set(false);
  }, [drive, driving]);

  /** The reader scrolls on their own: a running jump ends where it is and the spy follows the page again. */
  const takeOver = useCallback(() => {
    stop();
    holding.set(false);
    heldAnchor.current = null;
    settling.current += 1;
  }, [holding, stop]);

  // Web: a wheel, a touch or a key in the list ends a running jump where it is (native ends it with onScrollBeginDrag).
  useEffect(() => {
    if (!isWeb) return;
    const node: unknown = listRef.current?.getScrollableNode();
    if (!isEventTarget(node)) return;
    // DQ-M53R2-05: a press on content (a toggle, a link) is no scroll; only a pointer on the scroller itself (its scrollbar) is.
    const pointer = (event: unknown) => {
      if ((event as { target?: unknown }).target === node) takeOver();
    };
    for (const type of TAKEOVER_EVENTS) node.addEventListener(type, takeOver, { passive: true });
    node.addEventListener('pointerdown', pointer, { passive: true });
    return () => {
      for (const type of TAKEOVER_EVENTS) node.removeEventListener(type, takeOver);
      node.removeEventListener('pointerdown', pointer);
    };
  }, [listRef, takeOver]);

  const apply = useCallback(
    (offset: number) => {
      if (driving.get()) listRef.current?.scrollToOffset({ offset, animated: false });
    },
    [driving, listRef],
  );

  // The next settle round calls the settle of that render (a callback cannot name itself in its own body).
  const settleAgain = useRef<(key: string, round: number, run: number) => void>(() => undefined);

  /**
   * DQ-M53-01: every jump ends here, the spring's and the instant ones alike. The target is read again from the list's layout and
   * the list corrected to it, two frames apart, until it holds (rows drawn on the way replace their estimates); the section stays
   * current, then focus may follow (`onArrive`). A newer jump or the reader's own scroll cancels a running settle.
   */
  const settle = useCallback(
    (key: string, round: number = 0, run: number = settling.current) => {
      if (run !== settling.current) return;
      driving.set(false);
      const top = topOf(key);
      if (!Number.isFinite(top)) {
        runArrive();
        return;
      }
      const max = Math.max(0, contentHeight.get() - viewport.get());
      const target = sectionScrollTarget(top, spy.get(), max);
      const off = Math.abs(target - scrollY.get()) > 1;
      if (off) listRef.current?.scrollToOffset({ offset: target, animated: false });
      refresh();
      if (off && round < SETTLE_ROUNDS) {
        afterFrames(() => settleAgain.current(key, round + 1, run));
        return;
      }
      runArrive();
    },
    [contentHeight, driving, listRef, refresh, runArrive, scrollY, spy, topOf, viewport],
  );

  useEffect(() => {
    settleAgain.current = settle;
  }, [settle, settleAgain]);

  // DQ-M53-01: a jump that happened before the index was measured (a deep link on the first frames) or before the desktop knew its
  // width lands again once the geometry it aimed with changes, while the page still holds it.
  useEffect(() => {
    const anchor = heldAnchor.current;
    if (!anchor || driving.get()) return;
    afterFrames(() => settleAgain.current(anchor, 0, settling.current));
  }, [driving, geometry]);

  useAnimatedReaction(
    () => (driving.get() ? drive.get() : null),
    (offset) => {
      if (offset !== null) scheduleOnRN(apply, offset);
    },
  );

  const scrollTo = useCallback(
    (anchor: ProfileAnchor, options: { animated?: boolean; onArrive?: () => void } = {}) => {
      const list = listRef.current;
      const index = indexOfKey(anchor);
      if (!list || index < 0) return;
      const sectionIndex = sections.indexOf(anchor as ProfileSection);
      if (sectionIndex >= 0) setCurrentIndex(sectionIndex);
      heldIndex.set(sectionIndex);
      holding.set(sectionIndex >= 0);
      heldAnchor.current = anchor;
      settling.current += 1;
      const run = settling.current;
      arrive.current = options.onArrive ?? null;
      const top = topOf(anchor);
      const offset = -(geometry.pinnedTop + geometry.indexHeight + geometry.gap);
      if (!Number.isFinite(top) || viewport.get() === 0) {
        // Before the list has measured anything (a deep link on the first frame): the list finds the row itself.
        pendingAnchor.current = { anchor, animated: false };
        void list.scrollToIndex({ index, animated: false, viewOffset: offset });
        return;
      }
      stop();
      // A deep link jumps: the list resolves the row's place itself, rows above it measured or not; then the exact settle.
      if (options.animated === false) {
        void list.scrollToIndex({ index, animated: false, viewOffset: offset });
        afterFrames(() => settle(anchor, 0, run));
        return;
      }
      const max = Math.max(0, contentHeight.get() - viewport.get());
      const target = sectionScrollTarget(top, geometry, max);
      // Reduced motion (and motion off): no travel. The list jumps and, under reduced motion, fades back in on effect.default.
      if (!motion.enabled || motion.reduced) {
        if (motion.enabled) listOpacity.set(0);
        list.scrollToOffset({ offset: target, animated: false });
        if (motion.enabled) listOpacity.set(motion.effectTo(1, 'default'));
        afterFrames(() => settle(anchor, 0, run));
        return;
      }
      drive.set(scrollY.get());
      driving.set(true);
      drive.set(
        motion.springTo(target, 'calm', (finished) => {
          'worklet';
          if (finished) scheduleOnRN(settle, anchor, 0, run);
        }),
      );
    },
    [contentHeight, drive, driving, geometry, heldIndex, holding, indexOfKey, listOpacity, listRef, motion, scrollY, sections, setCurrentIndex, settle, stop, topOf, viewport],
  );

  const retryPending = useCallback(() => {
    const pending = pendingAnchor.current;
    if (!pending || viewport.get() === 0 || !Number.isFinite(topOf(pending.anchor))) return;
    pendingAnchor.current = null;
    scrollTo(pending.anchor, { animated: pending.animated });
  }, [scrollTo, topOf, viewport]);

  const listEvents = {
    onLoad: () => {
      refresh();
      retryPending();
    },
    onContentSizeChange: (_width: number, height: number) => {
      contentHeight.set(height);
      refresh();
      retryPending();
      // DQ-M53-01: rows above that finish loading after the jump (the score, a rail) move the section: the held page follows it.
      const anchor = heldAnchor.current;
      if (anchor && !driving.get()) afterFrames(() => settleAgain.current(anchor, 0, settling.current));
    },
    onLayout: (event: { nativeEvent: { layout: { height: number } } }) => {
      viewport.set(event.nativeEvent.layout.height);
      retryPending();
    },
    onScrollBeginDrag: takeOver,
  };

  return {
    current: store,
    scrollTo,
    refresh,
    rowTops,
    release: takeOver,
    listOpacity,
    listEvents,
    contentHeight,
    viewport,
  };
}
