/**
 * Re-tap of the active tab (§9): scroll to top, then pop to root. A focused screen that scrolls registers itself; only
 * the focused screen can ever be registered, because focus decides it, so nothing here needs to know the tab.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

/** Scrolls to the top. Returns false when the screen is at the top already, which lets the re-tap pop instead. */
export type ScrollToTop = () => boolean;

let focusedScroller: ScrollToTop | null = null;

export function registerScroller(scroller: ScrollToTop): () => void {
  focusedScroller = scroller;
  return () => {
    if (focusedScroller === scroller) focusedScroller = null;
  };
}

export type RetapResult = 'scrolled' | 'popped' | 'none';

/** One tap does one thing, so a long list needs two: to the top, then to the root. */
export function runRetap(stackDepth: number, popToRoot: () => void): RetapResult {
  if (focusedScroller?.()) return 'scrolled';
  if (stackDepth <= 1) return 'none';
  popToRoot();
  return 'popped';
}

/**
 * For any screen inside a tab that scrolls. TabRootScreen does this already.
 *
 *   useTabScrollToTop(() => {
 *     if (header.scrollY.get() <= 0) return false;
 *     listRef.current?.scrollToOffset({ offset: 0, animated: true });
 *     return true;
 *   });
 */
export function useTabScrollToTop(scroller: ScrollToTop): void {
  const latest = useRef(scroller);
  useEffect(() => {
    latest.current = scroller;
  });
  useFocusEffect(useCallback(() => registerScroller(() => latest.current()), []));
}
