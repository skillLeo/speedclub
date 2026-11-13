import { useRef, type ComponentRef, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarPadding } from '@/features/shell/tabBarLayout';
import { createStyles, zIndex } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { Header, Screen, type HeaderAction } from '@/ui';
import type { CollapsingHeader } from '@/ui/useCollapsingHeader';

const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  body: { flex: 1 },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[32] },
  overlay: { left: 0, pointerEvents: 'box-none', position: 'absolute', right: 0, top: 0, zIndex: zIndex.header },
  overlayHeader: { position: 'relative' },
}));

export type ProfileFrameProps = {
  routeId: string;
  /**
   * 09 §6.2 (b): the header floats over the cover with its round controls on `scrim.top`, and the solid bar with the name
   * crossfades in once the cover has scrolled under it (`collapseAt`). Without a cover the bar is there from the start and
   * shows the name once the name has scrolled under it.
   */
  overPhoto: boolean;
  /** The member's name, the bar's title once the page title has gone. */
  title?: string;
  onBack?: () => void;
  actions?: readonly HeaderAction[];
  header: CollapsingHeader;
  /** Photo variant: the scroll distance after which the bar is solid (the cover's height minus the bar). */
  collapseAt?: number;
  onWidth?: (width: number) => void;
  /** What the offline banner says. */
  offlineLabel?: string;
  bodyTestID?: string;
  children: ReactNode;
  /** Sheets and dialogs of the page. */
  overlays?: ReactNode;
};

/** The frame of PROF-01/02: the header pattern (b), the offline banner under it, one scroller that clears the tab bar, re-tap to top. */
export function ProfileFrame({
  routeId,
  overPhoto,
  title,
  onBack,
  actions,
  header,
  collapseAt,
  onWidth,
  offlineLabel,
  bodyTestID,
  children,
  overlays,
}: ProfileFrameProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const padding = useTabBarPadding();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    scrollRef.current?.scrollTo({ y: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      {overPhoto ? null : (
        <>
          <Header variant="large" title={title} scroll={header} onBack={onBack} actions={actions} testID={`${routeId}.header`} />
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
          <View testID={bodyTestID}>{children}</View>
        </Animated.ScrollView>
        {overPhoto ? (
          <View style={styles.overlay}>
            <Header
              variant="photo"
              title={title}
              scroll={header}
              collapseAt={collapseAt}
              onBack={onBack}
              actions={actions}
              style={styles.overlayHeader}
              testID={`${routeId}.header`}
            />
            <ShellOfflineBanner label={offlineLabel} />
          </View>
        ) : null}
      </View>
      {overlays}
    </Screen>
  );
}
