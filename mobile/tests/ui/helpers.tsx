import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '@/i18n';
import { ThemeProvider } from '@/theme';

/** Renders a primitive inside the providers the app root gives it. */
export function renderUi(element: ReactElement) {
  return render(
    <GestureHandlerRootView>
      <ThemeProvider>{element}</ThemeProvider>
    </GestureHandlerRootView>,
  );
}

export function flat(style: unknown): ViewStyle & { color?: string; fontSize?: number; lineHeight?: number } {
  return StyleSheet.flatten(style as ViewStyle) as ViewStyle;
}

/** A flattened text style (type role, colour, transform). */
export function textOf(style: unknown): TextStyle {
  return (StyleSheet.flatten(style as TextStyle) ?? {}) as TextStyle;
}

/** The style of the Animated.View inside a PressableScale: the visual with the metrics. */
export function visualOf(testID: string) {
  const pressable = screen.getByTestId(testID);
  const children = pressable.children.filter((child) => typeof child !== 'string');
  const last = children[children.length - 1];
  return flat(last && typeof last !== 'string' ? last.props.style : undefined);
}

type TestNode = ReturnType<typeof screen.getByTestId>;

/**
 * The SM7 tone layers inside a control or a removable chip's shell. The layer is decorative (aria-hidden) and has no test ID, so
 * a flow that lists controls by test-ID prefix never counts it; it is found by its marker (PRESS_TONE_DATASET).
 */
export function toneLayersIn(testID: string): TestNode[] {
  const found: TestNode[] = [];
  const walk = (node: TestNode) => {
    for (const child of node.children) {
      if (typeof child === 'string') continue;
      if ((child.props.dataSet as { pressTone?: string } | undefined)?.pressTone === 'layer') found.push(child);
      walk(child);
    }
  };
  walk(screen.getByTestId(testID));
  return found;
}

/**
 * A field's hidden measuring copy (TextInput, Composer): the web `mirror` text that sizes a textarea, or the native `line` of the
 * input role. It has no test ID (it would extend the control's prefix) and is found by its marker inside `<id>.field`.
 */
export function queryMeasureOf(id: string, kind: 'mirror' | 'line'): TestNode | null {
  const field = screen.getByTestId(`${id}.field`, { includeHiddenElements: true });
  const find = (node: TestNode): TestNode | null => {
    for (const child of node.children) {
      if (typeof child === 'string') continue;
      if ((child.props.dataSet as { qaMeasure?: string } | undefined)?.qaMeasure === kind) return child;
      const inner = find(child);
      if (inner) return inner;
    }
    return null;
  };
  return find(field);
}

/** queryMeasureOf, failing when the copy is missing. */
export function measureOf(id: string, kind: 'mirror' | 'line'): TestNode {
  const node = queryMeasureOf(id, kind);
  if (!node) throw new Error(`no ${kind} measuring copy in ${id}.field`);
  return node;
}

/** The one tone layer of a control (see toneLayersIn); fails when there is none or more than one. */
export function toneLayerOf(testID: string): TestNode {
  const layers = toneLayersIn(testID);
  expect(layers).toHaveLength(1);
  return layers[0] as TestNode;
}

/**
 * DQ-901: CSS paints a positioned box above in-flow content that is not positioned (Phosphor's `<svg>`), so a glyph may not
 * follow an absolutely positioned sibling anywhere up its chain, up to the control (`role="button"`) that holds it.
 */
export function assertNoPositionedSiblingBefore(node: TestNode) {
  let child: TestNode = node;
  let parent = node.parent;
  while (parent) {
    const siblings = parent.children.filter((entry): entry is TestNode => typeof entry !== 'string');
    for (const sibling of siblings.slice(0, Math.max(0, siblings.indexOf(child)))) {
      expect(flat(sibling.props.style).position).not.toBe('absolute');
    }
    if (parent.props.role === 'button') return;
    child = parent;
    parent = parent.parent;
  }
}
