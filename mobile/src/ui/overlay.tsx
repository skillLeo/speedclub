import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';

import { pushOverlay, useTopOverlay } from './overlayStack';
import { ToastHost } from './ToastHost';
import { NO_BROWSER_OUTLINE } from './useFocusRing';

const styles = StyleSheet.create({
  root: { flex: 1 },
  focusFallback: { height: 0, position: 'absolute', width: 0, ...NO_BROWSER_OUTLINE },
});

const APP_ROOT_ID = 'root';
let inertHolds = 0;

/**
 * Takes the app behind an open overlay out of the page for pointer, keyboard and assistive technology, also while
 * overlays stack. Returns the release. RN Web portals the Modal to the body, outside this root, and it has captured
 * the opener before the first hold, so the focus still returns there when the overlay closes.
 */
export function holdAppInert(root: Pick<Element, 'setAttribute' | 'removeAttribute'> | null = document.getElementById(APP_ROOT_ID)): () => void {
  if (!root) return () => undefined;
  inertHolds += 1;
  root.setAttribute('inert', '');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inertHolds -= 1;
    if (inertHolds === 0) root.removeAttribute('inert');
  };
}

const useStyles = createStyles((t) => ({
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.color.overlay.scrim },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
}));

export type OverlayModalProps = {
  children: ReactNode;
  /** Android back and, through React Native Web, Escape. */
  onRequestClose: () => void;
  /** Accessible name. React Native Web gives this Modal `role="dialog"` and `aria-modal`, and traps focus inside it. */
  label: string;
  /** `id` of the element that describes the dialog, on web. */
  describedBy?: string;
};

/**
 * The transparent RN Modal under every overlay, with its own gesture root so it also works above native modal
 * screens on iOS and Android (rules/mobile.md). On web the Modal returns focus to the opener when it unmounts.
 */
export function OverlayModal({ children, onRequestClose, label, describedBy }: OverlayModalProps) {
  const webA11y = isWeb ? ({ 'aria-label': label, 'aria-describedby': describedBy } as object) : {};
  const [token] = useState(() => Symbol('overlay'));
  const onTop = useTopOverlay() === token;
  useEffect(() => (isWeb ? holdAppInert() : undefined), []);
  useEffect(() => pushOverlay(token), [token]);
  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onRequestClose}
      {...webA11y}
    >
      <GestureHandlerRootView style={styles.root}>
        {children}
        {/* The Modal covers the app's host and, on web, the app is inert: a toast raised here has to live here. */}
        {onTop ? <ToastHost inOverlay /> : null}
        {/* RN Web focuses its trap container when nothing in it takes focus, with the browser's ring around the viewport. */}
        {isWeb ? <View tabIndex={-1} style={styles.focusFallback} /> : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

export type ScrimProps = {
  /** 0 to 1. */
  progress: SharedValue<number>;
  onPress?: () => void;
  testID?: string;
};

/**
 * The dimmed backdrop. A pointer-only way out: no role and no tab stop, because the keyboard has Escape, screen
 * readers have the accessibility escape and Android has back. On web a Pressable always carries a tabindex, which makes
 * it a control without a name and the first thing the focus trap lands on, so a plain view takes the click there.
 */
export function Scrim({ progress, onPress, testID }: ScrimProps) {
  const themed = useStyles();
  const animated = useAnimatedStyle(() => ({ opacity: progress.get() }));
  return (
    <Animated.View style={[themed.scrim, animated]}>
      {isWeb ? (
        <View style={themed.fill} testID={testID} {...({ onClick: onPress } as object)} />
      ) : (
        <Pressable
          accessible={false}
          focusable={false}
          importantForAccessibility="no"
          onPress={onPress}
          style={themed.fill}
          testID={testID}
        />
      )}
    </Animated.View>
  );
}

/** Keeps an overlay mounted for `exitMs` after `visible` turns false, so it can animate out. */
export function usePresence(visible: boolean, exitMs: number): boolean {
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) return undefined;
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [visible, exitMs]);

  return visible || mounted;
}
