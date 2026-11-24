/**
 * QA-C05 (client QA 2026-11-23, zero-error crawl): on the member web the floating tab bar grows by the CSS bottom safe area (TabBar pads
 * itself with env(safe-area-inset-bottom)), but `useTabBarInset` answered only `size.tabBar` there. Every list end and floating control
 * placed with it (VEH-01/GAR-02's OwnerCapsule, EVT-02's RSVP bar, Shop, Crews, Dex …) sat that many pixels under the bar in an iPhone
 * home-screen app (34 px home indicator). The number must carry the CSS inset on web, as it carries the device inset on native.
 */
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { TabBarOverlayContext, useTabBarInset } from '@/features/shell/tabBarLayout';
import { size } from '@/theme';
import * as safeArea from '@/ui/safeArea';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));

const HOME_INDICATOR = 34;

/** The measured insets are cached per page; each case starts from its own CSS. Optional, so the test also runs on the code before QA-C05. */
const resetCssSafeInsets = () => (safeArea as { resetCssSafeInsetsForTests?: () => void }).resetCssSafeInsetsForTests?.();

/**
 * The browser's answer for env(safe-area-inset-*). This Jest environment has no DOM (tests/ui/fakeCanvas.ts), so a minimal document and
 * getComputedStyle stand in: an element whose inline CSS reads the env() insets computes to the given pixels, as a browser does.
 */
function withCssInsets(bottom: number, top = 0): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle };
  const body = { appendChild: (node: unknown) => node, removeChild: (node: unknown) => node };
  g.document = { body, createElement: () => ({ style: { cssText: '' }, remove() {} }) };
  g.getComputedStyle = (element: { style: { cssText: string } }) => {
    const css = element.style.cssText;
    return {
      paddingBottom: css.includes('env(safe-area-inset-bottom') ? `${bottom}px` : '0px',
      paddingTop: css.includes('env(safe-area-inset-top') ? `${top}px` : '0px',
    };
  };
  resetCssSafeInsets();
  return () => {
    g.document = saved.document;
    g.getComputedStyle = saved.getComputedStyle;
    resetCssSafeInsets();
  };
}

const overlay = ({ children }: { children: ReactNode }) => <TabBarOverlayContext value>{children}</TabBarOverlayContext>;

describe('useTabBarInset on web (QA-C05)', () => {
  it('includes the CSS bottom safe area the tab bar itself grows by', async () => {
    const restore = withCssInsets(HOME_INDICATOR);
    try {
      const { result } = await renderHook(() => useTabBarInset(), { wrapper: overlay });
      expect(result.current).toBe(size.tabBar + HOME_INDICATOR);
    } finally {
      restore();
    }
  });

  it('is the bar height alone without a safe area (a desktop browser, Android Chrome)', async () => {
    const restore = withCssInsets(0);
    try {
      const { result } = await renderHook(() => useTabBarInset(), { wrapper: overlay });
      expect(result.current).toBe(size.tabBar);
    } finally {
      restore();
    }
  });

  it('is 0 where no tab bar floats over the tree', async () => {
    const restore = withCssInsets(HOME_INDICATOR);
    try {
      const { result } = await renderHook(() => useTabBarInset());
      expect(result.current).toBe(0);
    } finally {
      restore();
    }
  });
});
