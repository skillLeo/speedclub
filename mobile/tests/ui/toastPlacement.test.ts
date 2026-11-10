import { act, renderHook } from '@testing-library/react-native';

import { size, space } from '@/theme';
import {
  reportStickyBar,
  TOAST_GAP,
  toastBottom,
  toastBottomCss,
  toastKeyboardLift,
  useStickyBarHeight,
  type ToastClearance,
} from '@/ui/toastPlacement';

/** A sticky bar of one row: hairline, 12 + button L + 12, and the inset it pads itself. */
const bar = (inset: number) => 1 + space[12] + size.button.l + space[12] + inset;
/** The same at 200 % font, where the primary wraps under the draft action. */
const wrappedBar = (inset: number) => bar(inset) + size.button.s + space[8];
const INSET = 34;
const KEYBOARD = 336;

describe('where the toast sits with the keyboard closed', () => {
  it('8 above the bottom edge, or the safe inset, without bars', () => {
    expect(TOAST_GAP).toBe(8);
    expect(toastBottom({ tabBar: 0, stickyBar: 0, inset: 0 })).toBe(8);
    expect(toastBottom({ tabBar: 0, stickyBar: 0, inset: INSET })).toBe(INSET + 8);
  });

  it('8 above the tab bar and its inset', () => {
    expect(toastBottom({ tabBar: size.tabBar, stickyBar: 0, inset: INSET })).toBe(size.tabBar + INSET + 8);
  });

  it.each([0, INSET])('8 above a sticky bar, whose height holds the inset %i already', (inset) => {
    expect(toastBottom({ tabBar: 0, stickyBar: bar(inset), inset })).toBe(bar(inset) + 8);
  });

  it('higher when the bar wraps at 200 % font', () => {
    const clearance = { tabBar: 0, inset: INSET };
    expect(toastBottom({ ...clearance, stickyBar: wrappedBar(INSET) })).toBe(wrappedBar(INSET) + 8);
    expect(toastBottom({ ...clearance, stickyBar: wrappedBar(INSET) })).toBeGreaterThan(toastBottom({ ...clearance, stickyBar: bar(INSET) }));
  });

  it('above the higher of tab bar and sticky bar when a screen has both', () => {
    expect(toastBottom({ tabBar: size.tabBar, stickyBar: bar(INSET), inset: INSET })).toBe(Math.max(size.tabBar + INSET, bar(INSET)) + 8);
    expect(toastBottom({ tabBar: size.tabBar, stickyBar: 40, inset: INSET })).toBe(size.tabBar + INSET + 8);
  });
});

describe('the same on web, where CSS adds the inset', () => {
  it('keeps the old rule without a sticky bar', () => {
    expect(toastBottomCss(0, 0)).toBe('calc(env(safe-area-inset-bottom, 0px) + 0px + 8px)');
    expect(toastBottomCss(size.tabBar, 0)).toBe(`calc(env(safe-area-inset-bottom, 0px) + ${size.tabBar}px + 8px)`);
  });

  it('clears the measured bar, which holds the CSS inset already, or the tab bar if that is higher', () => {
    expect(toastBottomCss(0, 77)).toBe('calc(max(env(safe-area-inset-bottom, 0px) + 0px, 77px) + 8px)');
    expect(toastBottomCss(size.tabBar, 77)).toBe(`calc(max(env(safe-area-inset-bottom, 0px) + ${size.tabBar}px, 77px) + 8px)`);
  });
});

describe('with the keyboard', () => {
  const bottomWith = (clearance: ToastClearance, keyboard: number, progress = keyboard > 0 ? 1 : 0) =>
    toastBottom(clearance) + toastKeyboardLift(clearance, keyboard, progress);

  it('does not move while the keyboard is closed', () => {
    expect(toastKeyboardLift({ tabBar: 0, stickyBar: bar(INSET), inset: INSET }, 0, 0)).toBe(0);
    expect(toastKeyboardLift({ tabBar: size.tabBar, stickyBar: 0, inset: INSET }, 0, 0)).toBe(0);
  });

  it('sits 8 above the keyboard on a screen without bars', () => {
    expect(bottomWith({ tabBar: 0, stickyBar: 0, inset: INSET }, KEYBOARD)).toBe(KEYBOARD + 8);
  });

  it('sits 8 above the sticky bar riding on the keyboard, whose inset lies behind it', () => {
    const clearance = { tabBar: 0, stickyBar: bar(INSET), inset: INSET };
    // StickyCTABar: translateY = -keyboard + inset, so its top edge is the bar without inset above the keyboard.
    expect(bottomWith(clearance, KEYBOARD)).toBe(KEYBOARD + bar(INSET) - INSET + 8);
  });

  it('follows the bar through the animation', () => {
    const clearance = { tabBar: 0, stickyBar: bar(INSET), inset: INSET };
    const halfway = KEYBOARD / 2;
    expect(bottomWith(clearance, halfway, 0.5)).toBe(bar(INSET) + halfway - 0.5 * INSET + 8);
  });

  it('a keyboard lower than the tab bar, as the bar of a hardware keyboard, leaves it above the tab bar', () => {
    const clearance = { tabBar: size.tabBar, stickyBar: 0, inset: INSET };
    expect(toastKeyboardLift(clearance, 44, 1)).toBe(0);
    expect(bottomWith(clearance, KEYBOARD)).toBe(KEYBOARD + 8);
  });
});

describe('the registry of sticky bars', () => {
  afterEach(async () => {
    await act(async () => {
      ['a', 'b'].forEach((key) => reportStickyBar(key, null));
    });
  });

  it('is empty at first, holds a reported bar and lets it go', async () => {
    const { result } = await renderHook(() => useStickyBarHeight());
    expect(result.current).toBe(0);
    await act(async () => reportStickyBar('a', 85));
    expect(result.current).toBe(85);
    await act(async () => reportStickyBar('a', null));
    expect(result.current).toBe(0);
  });

  it('follows a new height of the same bar, and a height of 0 takes it out', async () => {
    const { result } = await renderHook(() => useStickyBarHeight());
    await act(async () => reportStickyBar('a', 85));
    await act(async () => reportStickyBar('a', 129));
    expect(result.current).toBe(129);
    await act(async () => reportStickyBar('a', 0));
    expect(result.current).toBe(0);
  });

  it('with two bars the tallest counts, and the other stays when one goes', async () => {
    const { result } = await renderHook(() => useStickyBarHeight());
    await act(async () => {
      reportStickyBar('a', 85);
      reportStickyBar('b', 129);
    });
    expect(result.current).toBe(129);
    await act(async () => reportStickyBar('b', null));
    expect(result.current).toBe(85);
  });

  it('does not render again when nothing changed', async () => {
    let renders = 0;
    await renderHook(() => {
      renders += 1;
      return useStickyBarHeight();
    });
    await act(async () => reportStickyBar('a', 85));
    const after = renders;
    await act(async () => {
      reportStickyBar('a', 85);
      reportStickyBar('b', 40);
    });
    expect(renders).toBe(after);
  });
});
