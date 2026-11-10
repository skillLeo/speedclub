import { useRouter, type Href } from 'expo-router';
import { use, useRef, type ComponentRef, type ReactElement, type ReactNode } from 'react';
import { View, type FocusEvent, type LayoutChangeEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useTabScrollToTop } from '@/features/shell/retap';
import { TabBarOverlayContext, useTabBarPadding } from '@/features/shell/tabBarLayout';
import { isWeb } from '@/lib/platform';
import { useOnline } from '@/state/online';
import { createStyles, size, space, useBreakpoint, useMotion } from '@/theme';
import { Header, OfflineBanner, Screen, SkeletonText, Text, useCollapsingHeader } from '@/ui';
import { NO_BROWSER_OUTLINE, useFocusRing } from '@/ui/useFocusRing';

const EDGES: readonly Edge[] = ['left', 'right'];
const CONTENT_TOP = space[8];
const QR_COLUMN = size.qrMaxOnScreen + space[24] * 2;

const useStyles = createStyles((t) => ({
  box: { flex: 1 },
  scroll: { flex: 1, ...NO_BROWSER_OUTLINE },
  content: { flexGrow: 1, paddingTop: CONTENT_TOP },
  // From 768 the column is the QR card at its §8 maximum (QR 320 + 2 × 24), so card, buttons and rows share both edges. It
  // starts on the gutter under back, and the header's controls keep to it (DQ-156, M1.5's DQ-135 and DQ-136). On a phone
  // it is the screen minus the gutters, and the card stretches to it, in line with the title (DQ-035).
  column: { alignSelf: 'flex-start', maxWidth: QR_COLUMN, width: '100%' },
  columnPhone: { alignSelf: 'stretch' },
  end: { paddingBottom: t.space[32] },
  // As HeaderLargeTitle: at least 52, the title on its lower edge, the sub-line 4 below it.
  titleBlock: { gap: t.space[4], justifyContent: 'flex-end', minHeight: t.size.headerLargeTitleBlock, paddingBottom: t.space[24] },
}));

/** What a page with a FlashList needs from the frame (QR-01). */
export type QrListFrame = {
  scrollProps: Pick<ScrollViewProps, 'onScroll' | 'scrollEventThrottle'>;
  /** Gutters, top space and the tab bar's clearance. */
  contentContainerStyle: StyleProp<ViewStyle>;
  /** The column every item sits in, so rows line up with the title on wide screens. */
  columnStyle: StyleProp<ViewStyle>;
  /** The title block, for `ListHeaderComponent`. */
  titleBlock: ReactElement;
};

export type QrPageProps = {
  /** Sets `<ROUTE-ID>.root`, `.header`, `.title`, `.subtitle`, `.scroll`, `.offline`. */
  routeId: string;
  /** "QR-Code": `title.l` at the top of the page, then the compact title once it has scrolled under the bar. */
  title: string;
  /** The vehicle name under the title (FS-9), `supporting` text.secondary. */
  subtitle?: string | null;
  /** Keeps the sub-line's place with a skeleton line while the vehicle name loads. */
  subtitlePending?: boolean;
  /** Where back goes after a direct link, when there is nothing to go back to. */
  fallback: Href;
  offlineLabel?: string;
  /** Replaces the scroll view, for a list that must be a FlashList. */
  renderList?: (frame: QrListFrame) => ReactNode;
  /** With `renderList`: scrolls the list to the top on a re-tap of the tab, as the scroll view does by itself. */
  onListScrollToTop?: (animated: boolean) => void;
  /**
   * Web, for a page of text with nothing focusable in it (QR-03): the scroller takes focus itself, so the keyboard can scroll
   * it (WCAG 2.1.1), with the inset ring of ADR-118. It then ends above the floating tab bar instead of under it, because a
   * focusable box under the bar's buttons would overlap them. The same as SettingsPage.
   */
  focusableScroll?: boolean;
  children?: ReactNode;
};

/**
 * A pushed QR page (FS-9): back, the title block, the offline banner and one scrolling column that clears the tab bar. The
 * compact title takes over when the large one has passed under the bar, so the page never shows its title twice.
 */
export function QrPage({
  routeId,
  title,
  subtitle,
  subtitlePending = false,
  fallback,
  offlineLabel,
  renderList,
  onListScrollToTop,
  focusableScroll = false,
  children,
}: QrPageProps) {
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const motion = useMotion();
  const { gutter, kind } = useBreakpoint();
  const padding = useTabBarPadding();
  const header = useCollapsingHeader();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const ring = useFocusRing('inset');
  const focusable = isWeb && focusableScroll;
  const above = focusable && use(TabBarOverlayContext);

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    const animated = motion.enabled && !motion.reduced;
    if (renderList) onListScrollToTop?.(animated);
    else scrollRef.current?.scrollTo({ y: 0, animated });
    return true;
  });

  // The compact title fades in once the large one is under the bar: at its own bottom edge, not the block's.
  const onTitleLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    header.collapseAt.set(CONTENT_TOP + y + height);
  };

  const columnStyle = kind === 'phone' ? styles.columnPhone : styles.column;
  const contentContainerStyle = [styles.content, { paddingHorizontal: gutter }, above ? null : padding];
  const titleBlock = (
    <View style={[columnStyle, styles.titleBlock]}>
      <Text variant="titleL" role="heading" aria-level={1} onLayout={onTitleLayout} testID={`${routeId}.title`}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="supporting" color="text.secondary" testID={`${routeId}.subtitle`}>
          {subtitle}
        </Text>
      ) : subtitlePending ? (
        <SkeletonText variant="supporting" width="50%" testID={`${routeId}.subtitleSkeleton`} />
      ) : null}
    </View>
  );

  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      <Header
        variant="large"
        title={title}
        scroll={header}
        onBack={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
        contentMaxWidth={kind === 'phone' ? undefined : QR_COLUMN + 2 * gutter}
        testID={`${routeId}.header`}
      />
      {online ? null : <OfflineBanner label={offlineLabel} testID={`${routeId}.offline`} />}
      {renderList ? (
        renderList({ scrollProps: header.scrollProps, contentContainerStyle, columnStyle, titleBlock })
      ) : (
        <View style={[styles.box, above ? padding : null]}>
          <Animated.ScrollView
            ref={scrollRef}
            {...header.scrollProps}
            style={[styles.scroll, focusable ? ring.ringStyle : null]}
            {...(focusable ? { tabIndex: 0 as const } : {})}
            // Focus bubbles: a control inside draws its own ring, this one is for the scroller alone.
            onFocus={(event: FocusEvent) => {
              if (focusable && event.target === event.currentTarget) ring.onFocus(event);
            }}
            onBlur={focusable ? ring.onBlur : undefined}
            contentContainerStyle={contentContainerStyle}
            testID={`${routeId}.scroll`}
          >
            {titleBlock}
            <View style={[columnStyle, styles.end]}>{children}</View>
          </Animated.ScrollView>
        </View>
      )}
    </Screen>
  );
}
