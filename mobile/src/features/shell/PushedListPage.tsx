import { useMemo, type ReactNode } from 'react';
import { View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useOnline } from '@/state/online';
import { createStyles, layout, space, useBreakpoint } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { Hairline, Header, OfflineBanner, Screen, useCollapsingHeader } from '@/ui';

import { useTabScrollToTop } from './retap';
import { useTabBarPadding } from './tabBarLayout';

const EDGES: readonly Edge[] = ['left', 'right'];
/** The band's hairline fades in over this much scroll, as the header's does. */
const HAIRLINE_FADE = space[8];

const useStyles = createStyles((t) => ({
  // One readable column on wide screens, on the gutter under back, as PushedPage and the settings pages (DQ-156).
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  top: { paddingTop: t.space[8] },
  band: { position: 'relative' },
  bandHairline: { bottom: 0, left: 0, pointerEvents: 'none', position: 'absolute', right: 0 },
  content: { paddingTop: t.space[8] },
  end: { paddingBottom: t.space[32] },
}));

/** What the page hands its FlashList. */
export type PushedListFrame = {
  scrollProps: Pick<ScrollViewProps, 'onScroll' | 'scrollEventThrottle'>;
  /** Top space and the tab bar's clearance. */
  contentContainerStyle: StyleProp<ViewStyle>;
  /** The column every item sits in, with its gutters, so rows line up with the header on wide screens. */
  columnStyle: StyleProp<ViewStyle>;
  /** For `ListFooterComponent`'s end space. */
  endStyle: StyleProp<ViewStyle>;
};

export type PushedListPageProps = {
  /** Sets `<ROUTE-ID>.root`, `.header`, `.offline`. */
  routeId: string;
  /** `headline` in the compact bar. */
  title?: string;
  /** Absent where the page's parent stands beside it (the settings split): then there is no back (DQ-420). */
  onBack?: () => void;
  offlineLabel?: string;
  /** The header's trailing control (HOME-02: the "···" menu). */
  trailing?: ReactNode;
  /** Fixed under the header, in the column: tabs and a search field. It does not scroll with the list. */
  top?: ReactNode;
  renderList: (frame: PushedListFrame) => ReactNode;
  /** Re-tap of the tab while the list is scrolled: back to its top. At the top already, the tab pops instead. */
  onScrollToTop: (animated: boolean) => void;
  /** Dialogs and sheets of the page. */
  overlays?: ReactNode;
};

/**
 * A pushed page inside a tab whose body is one virtualised list (§9, §16): back, the offline banner, optional fixed controls,
 * then the FlashList that clears the tab bar. PROF-04, PROF-05 and SET-08 use it.
 */
export function PushedListPage({ routeId, title, onBack, offlineLabel, trailing, top, renderList, onScrollToTop, overlays }: PushedListPageProps) {
  const styles = useStyles();
  const online = useOnline();
  const motion = useMotionPreference();
  const { gutter, kind } = useBreakpoint();
  const padding = useTabBarPadding();
  const header = useCollapsingHeader();

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    onScrollToTop(motion.enabled && !motion.reduced);
    return true;
  });

  // DQ-263, as DQ-196 on DISC-01: header and band are both fixed chrome, so the line belongs under the band, where the list scrolls
  // under it. It spans the pane like the header's.
  const bandHairline = useAnimatedStyle(() => ({
    opacity: interpolate(header.scrollY.get(), [0, HAIRLINE_FADE], [0, 1], Extrapolation.CLAMP),
  }));
  const columnStyle = useMemo(() => [styles.column, { paddingHorizontal: gutter }], [gutter, styles.column]);
  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      <Header
        title={title}
        scroll={header}
        onBack={onBack}
        trailing={trailing}
        hairline={!top}
        contentMaxWidth={kind === 'phone' ? undefined : layout.feedColumn}
        testID={`${routeId}.header`}
      />
      {online ? null : <OfflineBanner label={offlineLabel} testID={`${routeId}.offline`} />}
      {top ? (
        <View style={styles.band}>
          <View style={[columnStyle, styles.top]}>{top}</View>
          <Animated.View style={[styles.bandHairline, bandHairline]} testID={`${routeId}.top.hairline`}>
            <Hairline />
          </Animated.View>
        </View>
      ) : null}
      {renderList({
        scrollProps: header.scrollProps,
        contentContainerStyle: [styles.content, padding],
        columnStyle,
        endStyle: styles.end,
      })}
      {overlays}
    </Screen>
  );
}
