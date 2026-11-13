import { useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset, useTabBarPadding } from '@/features/shell/tabBarLayout';
import { isWeb } from '@/lib/platform';
import { createStyles, layout as layoutTokens, size, space, zIndex } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { Header, Screen, type HeaderAction } from '@/ui';
import type { CollapsingHeader } from '@/ui/useCollapsingHeader';

import type { ProfileLayout } from '../layout';

const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles(() => ({
  body: { flex: 1 },
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
  overlay: { left: 0, pointerEvents: 'box-none', position: 'absolute', right: 0, top: 0, zIndex: zIndex.header },
  overlayHeader: { position: 'relative' },
  // DQ-1049: the capsule floats centred above the tab bar (09 §5 OwnerCapsule); the scroll content ends with room for it.
  floating: { left: 0, pointerEvents: 'box-none', position: 'absolute', right: 0, zIndex: zIndex.sticky },
  floatingRoom: { height: size.button.s + 2 * space[4] + 2 * space[12] },
}));

/** The width of the content area before its first layout: the window minus the rail or the sidebar. */
export function estimatedContentWidth(layout: ProfileLayout, windowWidth: number): number {
  if (layout === 'desktop') return windowWidth - layoutTokens.sidebar;
  if (layout === 'tablet') return windowWidth - layoutTokens.rail;
  return windowWidth;
}

export type ProfileFrameProps = {
  routeId: string;
  layout: ProfileLayout;
  /** FS-3 on a phone with photos: the header floats over the hero and turns solid at `photoCollapseAt`. */
  overHero: boolean;
  /** The compact title once the page title has scrolled away. */
  title?: string;
  onBack: () => void;
  actions?: readonly HeaderAction[];
  header: CollapsingHeader;
  /** Scroll distance after which the photo header is solid: the hero's height minus the bar. */
  photoCollapseAt?: number;
  scrollRef: RefObject<ComponentRef<typeof Animated.ScrollView> | null>;
  /** The content width, measured. */
  onWidth?: (width: number) => void;
  /** Height of what floats over the content (bar and offline banner), where sticky blocks stop. */
  onOverlayHeight?: (height: number) => void;
  children: ReactNode;
  /** Overlays of the screen: viewer, sheets. */
  overlays?: ReactNode;
  /** DQ-1068: a read-only page's offline line ("Offline – zuletzt aktualisiert vor 5 Min."), not the outbox copy. */
  offlineLabel?: string;
  /** DQ-1049: the owner's floating capsule, above the tab bar and the safe area; the content gets room for it at its end. */
  floating?: ReactNode;
};

/**
 * The frame of VEH-01 and its skeleton: the header (on the photo, or a bar above the content), the offline banner under
 * it, one scroller that clears the floating tab bar, and re-tap to top.
 */
export function ProfileFrame({
  routeId,
  layout,
  overHero,
  title,
  onBack,
  actions,
  header,
  photoCollapseAt,
  scrollRef,
  onWidth,
  onOverlayHeight,
  children,
  overlays,
  offlineLabel,
  floating,
}: ProfileFrameProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const padding = useTabBarPadding();
  const tabBarInset = useTabBarInset();

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    scrollRef.current?.scrollTo({ y: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  // The title of a tablet bar appears once the page title has passed under it; the desktop card keeps the title in view.
  const barTitle = layout === 'desktop' ? undefined : title;

  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      {overHero ? null : (
        <>
          <Header
            variant={layout === 'desktop' ? 'compact' : 'large'}
            title={barTitle}
            scroll={header}
            onBack={onBack}
            actions={actions}
            testID={`${routeId}.header`}
          />
          <ShellOfflineBanner label={offlineLabel} />
        </>
      )}
      <View style={styles.body} onLayout={(event: LayoutChangeEvent) => onWidth?.(event.nativeEvent.layout.width)}>
        <Animated.ScrollView
          ref={scrollRef}
          {...header.scrollProps}
          style={styles.scroll}
          contentContainerStyle={[styles.content, padding]}
          testID={`${routeId}.scroll`}
        >
          {children}
          {floating ? <View style={styles.floatingRoom} /> : null}
        </Animated.ScrollView>
        {overHero ? (
          <View style={styles.overlay} onLayout={(event: LayoutChangeEvent) => onOverlayHeight?.(event.nativeEvent.layout.height)}>
            <Header
              variant="photo"
              title={title}
              scroll={header}
              collapseAt={photoCollapseAt}
              onBack={onBack}
              actions={actions}
              style={styles.overlayHeader}
              testID={`${routeId}.header`}
            />
            <ShellOfflineBanner label={offlineLabel} />
          </View>
        ) : null}
        {floating ? <View style={[styles.floating, { bottom: tabBarInset + space[12] }]}>{floating}</View> : null}
      </View>
      {overlays}
    </Screen>
  );
}

/** Height of the floating bar before it is measured. Web adds the CSS inset itself, which is zero in a browser tab. */
export function useEstimatedOverlayHeight(): number {
  const insets = useSafeAreaInsets();
  return size.header + (isWeb ? 0 : insets.top);
}

/** Width of the content before the first layout, then the measured one. */
export function useContentWidth(layout: ProfileLayout): [number, (width: number) => void] {
  const { width: windowWidth } = useWindowDimensions();
  const [measured, setMeasured] = useState<number | null>(null);
  return [measured ?? estimatedContentWidth(layout, windowWidth), setMeasured];
}
