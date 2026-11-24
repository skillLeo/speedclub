import { useSyncExternalStore } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';

type Edge = 'top' | 'bottom';
type Property = 'padding' | 'position';

const STYLE_KEY: Record<Property, Record<Edge, 'paddingTop' | 'paddingBottom' | 'top' | 'bottom'>> = {
  padding: { top: 'paddingTop', bottom: 'paddingBottom' },
  position: { top: 'top', bottom: 'bottom' },
};

/**
 * The device inset of an edge plus `extra`, as a style. Web reads CSS `env()`, because SDK 58 no longer
 * provides insets on web through the context (03_DESIGN_SYSTEM.md §5).
 */
export function useSafeEdge(edge: Edge, extra: number = 0, property: Property = 'padding'): ViewStyle {
  const insets = useSafeAreaInsets();
  const key = STYLE_KEY[property][edge];
  if (isWeb) {
    const value = `calc(env(safe-area-inset-${edge}, 0px) + ${extra}px)`;
    return { [key]: value } as unknown as ViewStyle;
  }
  return { [key]: insets[edge] + extra };
}

/** The numeric inset. Zero on web, where the CSS inset is part of the padding already. */
export function useSafeInset(edge: Edge): number {
  const insets = useSafeAreaInsets();
  return isWeb ? 0 : insets[edge];
}

// --- The CSS insets as numbers (web) ----------------------------------------------------------------------------------------------

type CssInsets = Record<Edge, number>;
const NO_INSETS: CssInsets = { top: 0, bottom: 0 };
let cssInsets: CssInsets | null = null;

/** What the browser resolves env(safe-area-inset-*) to, read from a probe element; 0 without a DOM. */
function measureCssInsets(): CssInsets {
  const doc = (globalThis as { document?: Document }).document;
  const computed = (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
  if (!doc?.body || !computed) return NO_INSETS;
  const probe = doc.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px);padding-bottom:env(safe-area-inset-bottom, 0px)';
  doc.body.appendChild(probe);
  const style = computed(probe);
  const read = (value: string) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };
  const insets = { top: read(style.paddingTop), bottom: read(style.paddingBottom) };
  doc.body.removeChild(probe);
  return insets;
}

function cssInsetsSnapshot(): CssInsets {
  cssInsets ??= measureCssInsets();
  return cssInsets;
}

/** The insets change with the orientation and when an installed web app starts (standalone): measured again on resize. */
function subscribeCssInsets(notify: () => void): () => void {
  const target = globalThis as { addEventListener?: Window['addEventListener']; removeEventListener?: Window['removeEventListener'] };
  if (typeof target.addEventListener !== 'function') return () => undefined;
  const onResize = () => {
    const next = measureCssInsets();
    if (cssInsets && next.top === cssInsets.top && next.bottom === cssInsets.bottom) return;
    cssInsets = next;
    notify();
  };
  target.addEventListener('resize', onResize);
  return () => target.removeEventListener?.('resize', onResize);
}

const noSubscribe = () => () => undefined;
const zero = () => 0;

/**
 * QA-C05: the CSS inset of an edge as a number on web (what `env(safe-area-inset-<edge>)` resolves to), 0 on native. For the few places
 * that need the web inset as a number (a list's padding, a floating control's `bottom`), where `useSafeEdge`'s calc() cannot go.
 */
export function useCssSafeInset(edge: Edge): number {
  return useSyncExternalStore(
    isWeb ? subscribeCssInsets : noSubscribe,
    isWeb ? () => cssInsetsSnapshot()[edge] : zero,
    zero,
  );
}

/** Tests: the next read measures again. */
export function resetCssSafeInsetsForTests(): void {
  cssInsets = null;
}
