import type { TabsDescriptor, TabsSlotRenderOptions } from 'expo-router/ui';
import { defaultTabsSlotRender } from 'expo-router/ui';
import { useLayoutEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { isViewAsTab } from '@/api/clientViewAs';
import { ViewAsMessagesScreen } from '@/features/viewAs/ViewAsMessagesScreen';
import { isWeb } from '@/lib/platform';
import { NO_BROWSER_OUTLINE } from '@/ui/useFocusRing';

/** react-native-web passes `visibility` through; React Native's ViewStyle does not list it. */
type WebViewStyle = ViewStyle & { visibility?: 'hidden' | 'visible' };

// Out of sight and still laid out. `inert` (set on the node) takes it out of pointer, keyboard and the accessibility tree.
// Under the shown pane: it follows it in the DOM, and WebKit still sent the mouse wheel to a scroller in a hidden pane
// stacked on top, so Start no longer scrolled after Start → Alle → back (verify run 3, f-home WebKit).
const HIDDEN: WebViewStyle = { bottom: 0, left: 0, pointerEvents: 'none', position: 'absolute', right: 0, top: 0, visibility: 'hidden', zIndex: -1 };

/** The Nachrichten tab: its trigger's name, or its group's should the router hand that over. */
const MESSAGES_TAB = /^\(?messages\)?$/;

const styles = StyleSheet.create({
  // The pane takes focus itself when the one before took it along (tabIndex -1): no ring of its own.
  tab: { flex: 1, height: '100%', position: 'relative', ...NO_BROWSER_OUTLINE },
});

/**
 * A screen of its own in place of a tab's stack (VIEWAS-MSG fs2): TabSlot's container grows with what is in its flow
 * (flexShrink 0, flexBasis auto), and only the stack's screens kept out of it. In the flow, a 200 % Nachrichten state grew the
 * container to its own height, past the window, so its ScrollView never scrolled and the root clipped it under the tab bar.
 * Filling the pane the way a stack screen does, its ScrollView is the pane's height again.
 */
export function StandaloneTabScreen({ children }: { children: ReactNode }) {
  return (
    // Out of the flow and filling the pane, as the stack lays out each of its screens (native-stack on web: absoluteFill).
    <View style={StyleSheet.absoluteFill} testID="shell.tab.standalone">
      {children}
    </View>
  );
}

/** What this file needs of the DOM element react-native-web renders for a View, and of the document. */
export type PaneNode = { inert: boolean; contains: (node: unknown) => boolean; focus: (options?: { preventScroll?: boolean }) => void };
type FocusTarget = { isConnected?: boolean; focus: (options?: { preventScroll?: boolean }) => void };
export type PaneDocument = { activeElement: unknown; body: unknown };
export type PaneMemory = { focused: boolean | null; remembered: FocusTarget | null };

const isPaneNode = (node: unknown): node is PaneNode =>
  typeof node === 'object' && node !== null && typeof (node as PaneNode).contains === 'function' && typeof (node as PaneNode).focus === 'function';

/** Whether nothing useful holds the focus: <body>, or an element inside a pane that is inert now. `body` false: only the latter. */
function focusLost(pane: PaneNode, doc: PaneDocument, body: boolean): boolean {
  const active = doc.activeElement as { closest?: (selector: string) => unknown } | null;
  if (active && pane.contains(active)) return false;
  if (!active || active === doc.body) return body;
  return Boolean(active.closest?.('[inert]'));
}

/**
 * One tab pane's part of a switch (M2.8 code review S1). A pane left behind remembers the element that had the focus and turns
 * `inert`: aria-hidden on a pane that still held the focus (a button inside that switched tabs, as Start's rail) was blocked by
 * Chrome and dropped focus on <body>. The pane shown takes the focus back when nothing holds it: the element it had when it was
 * left, or else the pane itself. A first visit leaves the page's own start of focus (<body>) alone. The check runs after the
 * commit, because the pane left behind may turn inert after this one.
 */
export function updatePane(pane: PaneNode, focused: boolean, memory: PaneMemory, doc: PaneDocument, later: (task: () => void) => void): void {
  const before = memory.focused;
  memory.focused = focused;
  if (!focused) {
    if (doc.activeElement && pane.contains(doc.activeElement)) memory.remembered = doc.activeElement as FocusTarget;
    pane.inert = true;
    return;
  }
  pane.inert = false;
  if (before === true) return;
  const firstVisit = before === null;
  later(() => {
    if (!focusLost(pane, doc, !firstVisit)) return;
    const back = memory.remembered;
    const target = back && back.isConnected !== false && pane.contains(back) ? back : pane;
    target.focus({ preventScroll: true });
  });
}

/** One tab on web: laid out, hidden and inert while inactive (`updatePane`). */
function WebTabPane({ focused, testID, children }: { focused: boolean; testID: string; children: ReactNode }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const memory = useRef<PaneMemory>({ focused: null, remembered: null });

  useLayoutEffect(() => {
    const pane: unknown = ref.current;
    if (!isPaneNode(pane) || typeof document === 'undefined') return;
    updatePane(pane, focused, memory.current, document, queueMicrotask);
  }, [focused]);

  return (
    <View ref={ref} tabIndex={-1} style={[styles.tab, focused ? null : HIDDEN]} testID={testID}>
      {children}
    </View>
  );
}

/**
 * Web: an inactive tab stays laid out at its size instead of `display: none`. Hidden that way, every layout in it reported 0 × 0:
 * FlashList then recycled its cells and photos picked the variant for width 0, so each tab switch re-created images (Discover's
 * Kollektionen, Start's cards and stream). Lazy images re-created in a hidden tab only load once it shows, which offline logged a
 * failed load for each (M2.8 round 3, shell "follows the connection"). Native keeps expo-router's own screens. A view-as tab (web
 * only) shows ViewAsMessagesScreen in place of the whole Nachrichten stack.
 */
export function renderTabSlot(descriptor: TabsDescriptor, options: TabsSlotRenderOptions) {
  if (!isWeb) return defaultTabsSlotRender(descriptor, options);
  const { isFocused, loaded } = options;
  const { lazy = true, unmountOnBlur } = descriptor.options;
  if (unmountOnBlur && !isFocused) return null;
  if (lazy && !loaded && !isFocused) return null;
  // View-as (m3.2-contract §3): the Nachrichten tab holds the designed "nicht verfügbar" state, and none of messaging mounts.
  const content =
    isViewAsTab() && MESSAGES_TAB.test(descriptor.route.name) ? (
      <StandaloneTabScreen>
        <ViewAsMessagesScreen />
      </StandaloneTabScreen>
    ) : (
      descriptor.render()
    );
  return (
    <WebTabPane key={descriptor.route.key} focused={isFocused} testID={`shell.tab.${descriptor.route.name}`}>
      {content}
    </WebTabPane>
  );
}
