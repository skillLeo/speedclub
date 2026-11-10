/**
 * BH-41, §9 "Each tab keeps its own stack + scroll position", for a FlashList on web. A screen behind another one or in another tab
 * is display:none there: the list loses its height, the browser clamps its offset to 0, and when it comes back FlashList has to measure
 * itself first and passes through a short list (scrollHeight 2252 of 9700, then offset 0). So the place is kept here while the screen
 * is on show, and put back on return, again and again until it holds. Native keeps a covered screen laid out, and needs none of this.
 *
 * The list need not be mounted when the screen is focused, and FlashList may swap its scroller: the node is looked up again (below).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { isWeb } from '@/lib/platform';

export type RetainedList = {
  scrollToOffset: (params: { offset: number; animated?: boolean }) => void;
  getScrollableNode: () => unknown;
};

type ScrollNode = Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'addEventListener' | 'removeEventListener'>;

/** The measured list settles within about 200 ms, and resets its offset once on the way: a place held for less proves nothing. */
const SETTLE_MS = 400;
/** A list that stays shorter than the place, because builds went away meanwhile, ends where it can. */
const GIVE_UP_MS = 2500;
const SAME_PLACE_PX = 1;
/** A person who takes over ends the restore: the list is theirs. */
const USER_INPUT = ['wheel', 'touchstart', 'mousedown', 'keydown'] as const;

function scrollNodeOf(list: RetainedList | null): ScrollNode | null {
  try {
    return (list?.getScrollableNode() as ScrollNode | null | undefined) ?? null;
  } catch {
    return null;
  }
}

export type RetainedListScroll = {
  /** Before a jump to the top (re-tap of the tab, a new query): there is no old place to come back to. */
  forget: () => void;
};

type Refs = { list: RefObject<RetainedList | null>; place: { current: number }; endRestore: { current: (() => void) | null } };

/**
 * Follows one scroll node while its screen is on show: puts the place back first if there is one, then records it from the scroll
 * events. Returns what lets go of the node again.
 */
function follow(node: ScrollNode, { list, place, endRestore }: Refs): () => void {
  // While hidden the node has no height and reads 0, which is not where the member left it.
  const track = () => {
    if (node.clientHeight > 0) place.current = node.scrollTop;
  };

  let frame: number | null = null;
  const stopRestore = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    for (const input of USER_INPUT) node.removeEventListener(input, finish);
    endRestore.current = null;
  };
  function finish() {
    stopRestore();
    node.addEventListener('scroll', track);
  }

  if (place.current > 0) {
    const target = place.current;
    const started = Date.now();
    const step = () => {
      const elapsed = Date.now() - started;
      // Until FlashList has its size back there is nothing to scroll.
      if (node.clientHeight > 0) {
        if (Math.abs(node.scrollTop - target) <= SAME_PLACE_PX) {
          if (elapsed >= SETTLE_MS) {
            finish();
            return;
          }
        } else {
          list.current?.scrollToOffset({ offset: target, animated: false });
          // WebKit ignores element.scroll() on an element that was display:none, until something else scrolls it.
          if (Math.abs(node.scrollTop - target) > SAME_PLACE_PX) node.scrollTop = target;
        }
      }
      if (elapsed >= GIVE_UP_MS) {
        finish();
        return;
      }
      frame = requestAnimationFrame(step);
    };
    for (const input of USER_INPUT) node.addEventListener(input, finish);
    endRestore.current = finish;
    frame = requestAnimationFrame(step);
  } else {
    node.addEventListener('scroll', track);
  }

  return () => {
    stopRestore();
    node.removeEventListener('scroll', track);
  };
}

/**
 * The scroll node is looked up again whenever it may have changed, not once per focus: on focus, after every render of the screen (a
 * list that mounts after the first focus because the screen showed a state first, or a FlashList that replaced its scroller), and
 * frame by frame for a while when the screen is focused with no list yet. A new node takes over the place where the old one left it.
 */
export function useRetainedListScroll(listRef: RefObject<RetainedList | null>): RetainedListScroll {
  const place = useRef(0);
  const endRestore = useRef<(() => void) | null>(null);
  const focused = useRef(false);
  const followed = useRef<{ node: ScrollNode; release: () => void } | null>(null);

  /** Follows the list's current node, if that is not the one followed already. */
  const resolve = useCallback(() => {
    if (!isWeb || !focused.current) return;
    const node = scrollNodeOf(listRef.current);
    if (node === (followed.current?.node ?? null)) return;
    followed.current?.release();
    followed.current = node ? { node, release: follow(node, { list: listRef, place, endRestore }) } : null;
  }, [listRef]);

  useFocusEffect(
    useCallback(() => {
      if (!isWeb) return undefined;
      focused.current = true;
      resolve();
      // No list yet: look again each frame until it is there, up to the restore's own limit; renders of the screen look too.
      let frame: number | null = null;
      const started = Date.now();
      const wait = () => {
        frame = null;
        resolve();
        if (!followed.current && Date.now() - started < GIVE_UP_MS) frame = requestAnimationFrame(wait);
      };
      if (!followed.current) frame = requestAnimationFrame(wait);
      return () => {
        if (frame !== null) cancelAnimationFrame(frame);
        focused.current = false;
        followed.current?.release();
        followed.current = null;
      };
    }, [resolve]),
  );

  useEffect(() => {
    resolve();
  });

  const forget = useCallback(() => {
    place.current = 0;
    endRestore.current?.();
  }, []);
  return { forget };
}
