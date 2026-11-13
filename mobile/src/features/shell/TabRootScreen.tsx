import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, type ComponentRef, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';
import { motionDuration, useMotionPreference } from '@/ui/motion';
import { Header, HeaderLargeTitle, Screen, type HeaderAction } from '@/ui';
import { useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { useTabScrollToTop } from './retap';
import { ShellOfflineBanner } from './ShellOfflineBanner';
import { useTabBarPadding } from './tabBarLayout';

/** The Header owns the top inset (see its `safeTop`), the tab bar the bottom one. */
const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles(() => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
  body: { flexGrow: 1 },
}));

export type TabRootScreenProps = {
  /** From the register: sets `<ROUTE-ID>.root` on the screen and `<ROUTE-ID>.header` on the bar. */
  routeId: string;
  /** Translated. The large title, then the compact title once it scrolls away. */
  title: string;
  actions?: readonly HeaderAction[];
  /** Extra id on the body. */
  bodyTestID?: string;
  /** What the offline banner says on this screen; the generic line by default. */
  offlineLabel?: string;
  children?: ReactNode;
};

/**
 * The frame of a tab root (§8): large title that collapses on scroll, offline banner under the header, content that
 * clears the tab bar, and re-tap to top. A screen with a FlashList follows this file with CollapsingFlashList.
 */
export function TabRootScreen({ routeId, title, actions, bodyTestID, offlineLabel, children }: TabRootScreenProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const header = useCollapsingHeader();
  const padding = useTabBarPadding();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);

  // A hidden tab is display:none on web. The browser keeps the offset, but the scroll event on the way can report 0, so
  // on web the element is the truth.
  const readOffset = () => {
    const node = scrollRef.current?.getScrollableNode() as unknown as { scrollTop?: number } | null | undefined;
    return isWeb && typeof node?.scrollTop === 'number' ? node.scrollTop : header.scrollY.get();
  };

  useTabScrollToTop(() => {
    const before = readOffset();
    if (before <= 0) return false;
    scrollRef.current?.scrollTo({ y: 0, animated: motion.enabled && !motion.reduced });
    if (isWeb) {
      // WebKit ignores element.scroll() on an element that was display:none, until something else scrolls it.
      const node = scrollRef.current?.getScrollableNode() as unknown as { scrollTop: number };
      setTimeout(() => {
        if (node.scrollTop === before) node.scrollTop = 0;
      }, motionDuration('effect.default'));
    }
    return true;
  });

  // The header follows the real offset again when the tab returns, after the browser has shown it.
  useFocusEffect(
    useCallback(() => {
      if (!isWeb) return undefined;
      const frame = requestAnimationFrame(() => {
        const node = scrollRef.current?.getScrollableNode() as unknown as { scrollTop?: number } | null | undefined;
        if (typeof node?.scrollTop === 'number') header.scrollY.set(node.scrollTop);
      });
      return () => cancelAnimationFrame(frame);
    }, [header.scrollY]),
  );

  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      <Header variant="large" title={title} scroll={header} actions={actions} testID={`${routeId}.header`} />
      <ShellOfflineBanner label={offlineLabel} />
      <Animated.ScrollView
        ref={scrollRef}
        {...header.scrollProps}
        style={styles.scroll}
        contentContainerStyle={[styles.content, padding]}
      >
        <HeaderLargeTitle title={title} scroll={header} testID={`${routeId}.title`} />
        <View style={styles.body} testID={bodyTestID}>
          {children}
        </View>
      </Animated.ScrollView>
    </Screen>
  );
}
