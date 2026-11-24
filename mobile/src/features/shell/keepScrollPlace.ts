/**
 * R4B-013: the reader keeps their place when the web window crosses a breakpoint (shell.spec "crossing a breakpoint", ±1 px).
 *
 * A breakpoint changes what sits above a screen's content: from layout.breakpoints.desktop the sidebar lists Entdecken and Treffen,
 * so DISC-01's sticky band drops its Builds · Treffen control (48), and it comes back below that width. Chromium's CSS scroll anchoring
 * moved scrollTop by that height; WebKit's did so only now and then (3 of 6 runs kept scrollTop, so the content jumped by the band's
 * height). So the shell does it itself, the same way on both engines: when a resize is about to cross a breakpoint (before React
 * renders the new layout), it notes in every scrolled scroller of the frame the first element at or below the scroller's top edge and
 * that element's offset; after the new layout has rendered, and on the frames after it while react-native-web settles its
 * measurements, it moves scrollTop so that element is back at its offset. The browser's own anchoring is off on those scrollers for
 * that time, so the two never add up. Any input of the reader (wheel, touch, pointer, key) ends it at once. Native never crosses a
 * breakpoint this way and does nothing.
 */
import { useLayoutEffect, useRef, type ComponentRef } from 'react';
import type { View } from 'react-native';

import { isWeb } from '@/lib/platform';
import { breakpointFor, type BreakpointKind } from '@/theme';

/** One scroller's place: the element the reader sees at the top and its distance from the scroller's top edge. */
export type ScrollPlace = { scroller: HTMLElement; anchor: Element; offset: number; anchoring: string };

/** How long after the switch the place is held while react-native-web lays the new widths out (onLayout, then a render). */
export const SETTLE_MS = 1000;
const INPUTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

function scrolls(el: Element): el is HTMLElement {
  const { overflowY } = getComputedStyle(el);
  return (overflowY === 'auto' || overflowY === 'scroll') && (el as HTMLElement).scrollTop > 0;
}

/** Not a candidate, as CSS scroll anchoring has it: out of the flow, opted out, or nothing drawn. Sticky stays put while content moves. */
function excluded(el: Element): boolean {
  const style = getComputedStyle(el);
  if (style.position === 'absolute' || style.position === 'fixed' || style.position === 'sticky') return true;
  if ((style as CSSStyleDeclaration & { overflowAnchor?: string }).overflowAnchor === 'none' || style.display === 'none') return true;
  const box = el.getBoundingClientRect();
  return box.width === 0 && box.height === 0;
}

/**
 * The element the reader's place hangs on: walking the content in document order, the first element that starts at or below the
 * scroller's top edge; one that straddles the edge is walked into, and is the anchor itself when nothing inside it starts below.
 */
export function anchorOf(scroller: HTMLElement): { anchor: Element; offset: number } | null {
  const top = scroller.getBoundingClientRect().top;
  const walk = (parent: Element): Element | null => {
    for (const child of Array.from(parent.children)) {
      if (excluded(child)) continue;
      const box = child.getBoundingClientRect();
      if (box.bottom <= top) continue;
      if (box.top >= top) return child;
      return walk(child) ?? child;
    }
    return null;
  };
  const anchor = walk(scroller);
  return anchor ? { anchor, offset: anchor.getBoundingClientRect().top - top } : null;
}

/** Every scrolled scroller inside `root` with its place. The browser's anchoring is turned off on it until `release`. */
export function notePlaces(root: Element): ScrollPlace[] {
  const places: ScrollPlace[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (!scrolls(el)) continue;
    const found = anchorOf(el);
    if (!found) continue;
    const style = el.style as CSSStyleDeclaration & { overflowAnchor: string };
    places.push({ scroller: el, ...found, anchoring: style.overflowAnchor });
    style.overflowAnchor = 'none';
  }
  return places;
}

/** Moves each scroller so its anchor is back at its offset (whole pixels, so an equal layout gives an equal scrollTop). */
export function restorePlaces(places: readonly ScrollPlace[]): void {
  for (const { scroller, anchor, offset } of places) {
    if (!scroller.isConnected || !anchor.isConnected) continue;
    const delta = Math.round(anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset);
    if (delta !== 0) scroller.scrollTop += delta;
  }
}

/** The browser's own anchoring back as it was. */
export function releasePlaces(places: readonly ScrollPlace[]): void {
  for (const { scroller, anchoring } of places) (scroller.style as CSSStyleDeclaration & { overflowAnchor: string }).overflowAnchor = anchoring;
}

/**
 * The shell's side (ShellFrame): `watch` notes the places when a resize is about to cross a breakpoint, `settle` holds them after the
 * layout for that breakpoint has committed. One instance per frame.
 */
export function createScrollPlaceKeeper(root: () => Element | null) {
  let committed: BreakpointKind | null = null;
  let places: ScrollPlace[] = [];
  let frame = 0;
  let until = 0;

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    releasePlaces(places);
    places = [];
    for (const type of INPUTS) window.removeEventListener(type, stop, true);
  }

  const onResize = () => {
    const next = breakpointFor(window.innerWidth).kind;
    if (committed === null || next === committed || places.length > 0) return;
    const node = root();
    if (!node) return;
    places = notePlaces(node);
    if (places.length === 0) return;
    for (const type of INPUTS) window.addEventListener(type, stop, { capture: true, passive: true });
    // Held from here on: the new width reflows the page before React renders the new layout, and a resize that never commits a new
    // breakpoint (back across it before the render) ends on its own.
    hold();
  };

  function hold() {
    until = performance.now() + SETTLE_MS;
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function tick() {
    restorePlaces(places);
    frame = performance.now() < until ? requestAnimationFrame(tick) : 0;
    if (!frame) stop();
  }

  return {
    watch(): () => void {
      window.addEventListener('resize', onResize);
      return () => {
        window.removeEventListener('resize', onResize);
        stop();
      };
    },
    /** The layout for `kind` has committed: put every noted place back, and keep it there while the layout settles. */
    settle(kind: BreakpointKind): void {
      const first = committed === null;
      committed = kind;
      if (first || places.length === 0) return;
      restorePlaces(places);
      hold();
    },
  };
}

/** ShellFrame: the ref goes on the frame; the reader's place is kept whenever `kind` changes (web only). */
export function useKeepScrollPlace(kind: BreakpointKind) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const keeper = useRef<ReturnType<typeof createScrollPlaceKeeper> | null>(null);
  useLayoutEffect(() => {
    if (!isWeb) return undefined;
    const created = createScrollPlaceKeeper(() => ref.current as unknown as Element | null);
    keeper.current = created;
    const unwatch = created.watch();
    return () => {
      unwatch();
      keeper.current = null;
    };
  }, []);
  // Declared after the one above, so it runs after it on mount; and after every child's layout effect of a commit: the new layout
  // is in the document.
  useLayoutEffect(() => keeper.current?.settle(kind), [kind]);
  return ref;
}
