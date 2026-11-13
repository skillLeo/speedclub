import { use, useRef, type ComponentRef, type ReactNode } from 'react';
import { View, type FocusEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { TabBarOverlayContext, useTabBarPadding } from '@/features/shell/tabBarLayout';
import { isWeb } from '@/lib/platform';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { Header, Screen, type HeaderAction } from '@/ui';
import { useCollapsingHeader } from '@/ui/useCollapsingHeader';
import { NO_BROWSER_OUTLINE, useFocusRing } from '@/ui/useFocusRing';

const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  box: { flex: 1 },
  scroll: { flex: 1, ...NO_BROWSER_OUTLINE },
  content: { flexGrow: 1 },
  // One readable column on wide screens, as the settings pages until their split views arrive. From 768 it starts on the
  // gutter under back, and the header's controls keep to it (DQ-156, M1.5's DQ-135 and DQ-136).
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, paddingBottom: t.space[32], paddingTop: t.space[16], width: '100%' },
}));

export type PushedPageProps = {
  routeId: string;
  /** `headline` in the compact bar. */
  title?: string;
  onBack: () => void;
  children: ReactNode;
  /** Viewer and sheets of the page. */
  overlays?: ReactNode;
  /** 44 × 44 icon buttons at the end of the bar, for example "Mehr" (VEH-05). */
  actions?: readonly HeaderAction[];
};

/**
 * A pushed page inside a tab (§9): back, the offline banner, one scrolling column that clears the tab bar, re-tap to top.
 * On web the scroller takes focus itself, because a page of spec rows can have nothing else to focus, and the keyboard must
 * still scroll it (WCAG 2.1.1). It draws the inset ring of ADR-118 and ends above the floating tab bar, as SettingsPage does.
 */
export function PushedPage({ routeId, title, onBack, children, overlays, actions }: PushedPageProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const { gutter, kind } = useBreakpoint();
  const padding = useTabBarPadding();
  const header = useCollapsingHeader();
  const ring = useFocusRing('inset');
  const barOverlay = use(TabBarOverlayContext);
  const above = isWeb && barOverlay;
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    scrollRef.current?.scrollTo({ y: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      {/* The column carries its own gutters, so its width is the header's: back on its edge, the title centred on it. */}
      <Header title={title} scroll={header} onBack={onBack} actions={actions} contentMaxWidth={kind === 'phone' ? undefined : layout.feedColumn} testID={`${routeId}.header`} />
      <ShellOfflineBanner />
      <View style={[styles.box, above ? padding : null]}>
        <Animated.ScrollView
          ref={scrollRef}
          {...header.scrollProps}
          {...(isWeb ? { tabIndex: 0 as const } : {})}
          // Focus bubbles: a control inside draws its own ring, this one is for the scroller alone.
          onFocus={(event: FocusEvent) => {
            if (event.target === event.currentTarget) ring.onFocus(event);
          }}
          onBlur={ring.onBlur}
          style={[styles.scroll, ring.ringStyle]}
          contentContainerStyle={[styles.content, above ? null : padding]}
          testID={`${routeId}.scroll`}
        >
          <View style={[styles.column, { paddingHorizontal: gutter }]}>{children}</View>
        </Animated.ScrollView>
      </View>
      {overlays}
    </Screen>
  );
}
