import { useState, type ComponentRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import { useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset, useTabBarPadding } from '@/features/shell/tabBarLayout';
import { isWeb } from '@/lib/platform';
import { createStyles, layout as layoutTokens, size, space, zIndex } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { Header, type HeaderAction } from '@/ui/Header';
import { Screen } from '@/ui/Screen';
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
  // Native: the pinned blocks over the list, in a layer the list's size that clips them (a touch reaches only what lies inside its
  // parent's bounds, so they cannot live in a zero-height header there).
  pinnedLayer: {
    bottom: 0,
    left: 0,
    overflow: (isWeb ? 'clip' : 'hidden') as 'hidden',
    pointerEvents: 'box-none',
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: zIndex.sticky,
  },
}));

/**
 * DQ-1123: the room the scroll content keeps at its end for the floating bar: its measured height (one row for the capsule, up to
 * three for EVT-02's going state, more at 200 %), the 12 it floats above the tab bar, and 16 of air; recomputed whenever the bar's
 * layout changes (an answer, the font scale). Before the first layout the one-row estimate stands.
 */
export function floatingRoomHeight(measured: number | null): number | null {
  if (measured === null) return null;
  // A bar that renders nothing (a past or cancelled event) needs no room.
  return measured <= 0 ? 0 : measured + space[12] + space[16];
}

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
  /** The ScrollView over `children` (the skeleton). A page with its own list passes `list` and `scrollToTop` instead. */
  scrollRef?: RefObject<ComponentRef<typeof Animated.ScrollView> | null>;
  /**
   * VEH-01 one scroll (ADR-505): the page's own virtualised list instead of the ScrollView. It ends with `footer` (the room for the
   * floating capsule and the tab bar), as the ScrollView's content does. On web it also gets the pinned blocks (`pinnedInList`) as its
   * header, so they live inside the scroller (see `pinned`).
   */
  list?: (footer: ReactElement, pinnedInList: ReactNode) => ReactNode;
  /** Re-tap to top for `list`. */
  scrollToTop?: (animated: boolean) => void;
  /**
   * Blocks pinned over the list (the section index, the desktop card): absolutely placed by themselves, and before the list content in
   * the reading order, so the keyboard reaches the page's navigation before the long content. Web (VEH-01 p5 audit, clipped text): they
   * are the list's header inside its scroller, so the scroller is what cuts a card below the fold, as any content below the fold, and a
   * wheel, a touch or a focus over them scrolls the page natively. Native: a clipping layer over the list.
   */
  pinned?: ReactNode;
  /** DQ-M53-04 (QA only): every row is measured; the visual harness waits for `<routeId>.body.settled` before it sizes a picture. */
  qaSettled?: boolean;
  /** The content width, measured. */
  onWidth?: (width: number) => void;
  /** Height of what floats over the content (bar and offline banner), where sticky blocks stop. */
  onOverlayHeight?: (height: number) => void;
  children?: ReactNode;
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
  list,
  scrollToTop,
  pinned,
  qaSettled = false,
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
  const [floatingHeight, setFloatingHeight] = useState<number | null>(null);
  const room = floatingRoomHeight(floatingHeight);

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    const animated = motion.enabled && !motion.reduced;
    if (scrollToTop) scrollToTop(animated);
    else scrollRef?.current?.scrollTo({ y: 0, animated });
    return true;
  });

  // The title of the bar appears once the page title has passed under it, on a tablet and (DQ-M53-02) on the desktop too.
  const barTitle = title;

  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      {overHero ? null : (
        <>
          <Header
            variant="large"
            title={barTitle}
            scroll={header}
            onBack={onBack}
            actions={actions}
            testID={`${routeId}.header`}
          />
          <ShellOfflineBanner label={offlineLabel} />
        </>
      )}
      <View
        style={styles.body}
        // The harness's ready marker (DQ-M53-04): `<routeId>.body.settled` once every row is measured, `.body` before.
        testID={qaSettled ? `${routeId}.body.settled` : `${routeId}.body`}
        onLayout={(event: LayoutChangeEvent) => onWidth?.(event.nativeEvent.layout.width)}
      >
        {pinned && !(isWeb && list) ? <View style={styles.pinnedLayer}>{pinned}</View> : null}
        {list ? (
          list(
            <>
              {floating ? <View style={room === null ? styles.floatingRoom : { height: room }} testID={`${routeId}.floatingRoom`} /> : null}
              <View style={padding} />
            </>,
            isWeb ? pinned : null,
          )
        ) : (
          <Animated.ScrollView
            ref={scrollRef}
            {...header.scrollProps}
            style={styles.scroll}
            contentContainerStyle={[styles.content, padding]}
            testID={`${routeId}.scroll`}
          >
            {children}
            {floating ? <View style={room === null ? styles.floatingRoom : { height: room }} testID={`${routeId}.floatingRoom`} /> : null}
          </Animated.ScrollView>
        )}
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
        {floating ? (
          <View
            style={[styles.floating, { bottom: tabBarInset + space[12] }]}
            onLayout={(event: LayoutChangeEvent) => setFloatingHeight(Math.ceil(event.nativeEvent.layout.height))}
          >
            {floating}
          </View>
        ) : null}
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
