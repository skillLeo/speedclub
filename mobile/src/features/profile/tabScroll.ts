import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useWindowDimensions, type View } from 'react-native';
import type Animated from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isWeb } from '@/lib/platform';
import { size } from '@/theme';

/**
 * CR2-3: where the profile scroller rests after a tab switch. While the tab bar is still below the header (`current` up to
 * `anchor`), nothing moves: the tap never shifts the page under the finger. Once the member has scrolled into a tab, the new tab
 * opens where it was left (`saved`), at least with its tab bar right under the header, never back in the header or the old tab's
 * depth.
 */
export function tabSwitchOffset(current: number, anchor: number, saved: number | undefined): number {
  if (current <= anchor) return Math.max(0, current);
  return Math.max(anchor, saved ?? anchor);
}

/**
 * CR2-3: the height the new tab's panel needs so that the page can still rest at `target` (a short tab used to clamp the scroll
 * and drop the tab bar down the screen). 0 when the panel's own content is enough; the panel grows from `panelTop`.
 */
export function panelMinHeight(target: number, viewport: number, panelTop: number): number {
  return Math.max(0, Math.ceil(target + viewport - panelTop));
}

type ScrollRef = ComponentRef<typeof Animated.ScrollView>;

/**
 * The tab state of PROF-01/02 with a sane scroll position per tab (CR2-3): the tab follows `?tab=` while the page is open, a tap
 * switches at once, the page keeps its place (or the tab's own) and never jumps because the new panel is shorter.
 *
 * The bar is measured in the window at the tap (`measureInWindow`, the DOM box on the web): a stored onLayout position goes
 * stale when the cover or the badge row above it moves the bar without resizing it.
 */
export function useProfileTabScroll<T extends string>(initial: T, scrollY: SharedValue<number>) {
  const scrollRef = useRef<ScrollRef>(null);
  const barRef = useRef<ComponentRef<typeof View>>(null);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<T>(initial);
  const [minHeight, setMinHeight] = useState(0);
  const [param, setParam] = useState<T>(initial);
  const saved = useRef<Partial<Record<T, number>>>({});
  const pending = useRef<number | null>(null);

  // A link to `?tab=updates` while the profile is open switches the tab (the state only read the param at mount). Adjusted
  // during render, as React's "storing information from previous renders" pattern, not in an effect.
  if (param !== initial) {
    setParam(initial);
    setTab(initial);
  }

  const switchTo = (next: T, barWindowY: number | null) => {
    const from = tab;
    if (next === from) return;
    if (barWindowY !== null) {
      const offset = scrollY.get();
      saved.current[from] = offset;
      // The offset at which the bar rests right under the header (the header's bottom edge in the window).
      const anchor = Math.max(0, offset + barWindowY - insets.top - size.header);
      const target = tabSwitchOffset(offset, anchor, saved.current[next]);
      setMinHeight(panelMinHeight(target, height, offset + barWindowY + size.contentTab));
      pending.current = Math.abs(target - offset) < 1 ? null : target;
    }
    setTab(next);
  };

  const select = (next: T) => {
    const bar = barRef.current;
    if (!bar) {
      switchTo(next, null);
      return;
    }
    if (isWeb) {
      // The DOM box, at once: react-native-web's measureInWindow (and onLayout) add up offsetTop and came out 355 short on PROF-01
      // in WebKit, which put the page in the cover instead of under the bar.
      const node = bar as unknown as { getBoundingClientRect?: () => { top: number } };
      const top = node.getBoundingClientRect?.().top;
      switchTo(next, typeof top === 'number' && Number.isFinite(top) ? top : null);
      return;
    }
    // Fabric answers measureInWindow synchronously; where it would answer later (or not, as the test renderer), the tap must not
    // wait: the tab switches at once without the scroll care.
    let done = false;
    bar.measureInWindow((_x: number, y: number) => {
      if (done) return;
      done = true;
      switchTo(next, Number.isFinite(y) ? y : null);
    });
    if (!done) {
      done = true;
      switchTo(next, null);
    }
  };

  useEffect(() => {
    const target = pending.current;
    if (target === null) return;
    pending.current = null;
    scrollRef.current?.scrollTo({ y: target, animated: false });
  }, [tab]);

  return { tab, select, scrollRef, barRef, panelStyle: { minHeight } };
}
