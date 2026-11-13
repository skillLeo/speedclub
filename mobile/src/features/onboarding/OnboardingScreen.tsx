import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, ScrollView, StyleSheet, View, type LayoutChangeEvent, type ViewProps, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Edge } from 'react-native-safe-area-context';

import { markOnboardingSeen } from '@/features/auth/sessionLifecycle';
import { HOME_PATH, WELCOME_PATH } from '@/features/auth/routing';
import { FORM_MAX_WIDTH } from '@/features/auth/components/AuthScreen';
import { isNative } from '@/lib/platform';
import { setStored } from '@/lib/storage';
import { createStyles, motion as motionTokens, size as sizeTokens, space, ThemeScope, useBreakpoint, useTheme } from '@/theme';
import { Button, DisplayTitle, PhotoScrim, Screen, Text } from '@/ui';
import { useImagePlaceholder } from '@/ui/imagePlaceholder';
import { kenBurnsLoop, motionDuration, useMotionPreference } from '@/ui/motion';
import { PageIndicator, StaggerIn, TopScrim, usePagerParallax } from '@/ui/motion/kit';
import { focalToPosition } from '@/ui/Photo';
import { useSafeEdge, useSafeInset } from '@/ui/safeArea';

import { initialPage, LiveComponent, ONBOARDING_PAGES, type OnboardingPage } from './pages';

/**
 * DQ-1045: the brand stage is a Carbon ThemeScope in every theme (ADR-421 b): on web `data-theme-scope="carbon"` tells the DOM audit to
 * check its colours against Carbon's tokens. The cast stands until `QaDataSet` (src/lib/rn-web-dataset.d.ts) lists `themeScope`.
 */
const BRAND_STAGE = { qaExempt: 'photo', themeScope: 'carbon' } as ViewProps['dataSet'];

const EDGES: readonly Edge[] = ['left', 'right'];
const KEN_BURNS = motionTokens.signature.kenBurns;
/** The photo takes the top of the page and fades into the dark stage, so the copy always sits below it (09 §4.6 text-safe line). */
export const PHOTO_SHARE = 0.64;
/** The live component's width on a phone, at most (it reads as a product shot, not a full page). */
const LIVE_MAX = FORM_MAX_WIDTH - space[64];
/**
 * The skip button's row under the status bar (DQ-1043): a header bar (`size.header`, the height of the M button in it) and the
 * 12 of air under it before the page content, as every screen header leaves (56, as before).
 */
const TOP_BAR = sizeTokens.header + space[12];
/** DQ-1023: the live component scales down to fit the window, never below this (its text must stay readable). */
export const LIVE_SCALE_FLOOR = 0.75;
/** DQ-1023: from this font scale the page may scroll, and the controls follow the copy in the scroll content. */
export const IN_FLOW_FONT_SCALE = 1.3;
/** DQ-1023: from this width the photo with its live component and the copy with the controls share the window (AUTH-02, 7 + 5). */
export const SPLIT_FROM = 1024;
const PHOTO_COLUMNS = 7;
const COPY_COLUMNS = 5;

/**
 * DQ-1023: how far the live component scales so the page fits its window without a scroll: the room between the top bar and the
 * copy (and the gap above it), over the component's own height. 1 when it fits; `LIVE_SCALE_FLOOR` at least; null while unmeasured.
 */
export function liveScale(input: { room: number; natural: number }): number | null {
  if (input.natural <= 0) return null;
  return Math.max(LIVE_SCALE_FLOOR, Math.min(1, input.room / input.natural));
}

/**
 * DQ-1080: the width of the pager once it is mounted, 0 before: phones mount it on the screen's first layout (`size`), the split
 * layout on its photo pane's (`pagerWidth`).
 */
export function pagerMountedWidth(split: boolean, size: { width: number } | null, pagerWidth: number): number {
  if (split) return pagerWidth;
  return size?.width ?? 0;
}

const useStyles = createStyles((t) => ({
  // The brand layer: a dark stage in every theme (ADR-421 b), like AUTH-02.
  root: { backgroundColor: t.color.scrim.photoEnd, flex: 1, overflow: 'hidden' },
  pager: { flex: 1 },
  page: { overflow: 'hidden' },
  photoFrame: { left: 0, overflow: 'hidden', position: 'absolute', right: 0, top: 0 },
  photo: { height: '100%', width: '100%' },
  pageScroll: { flex: 1 },
  pageContent: { alignItems: 'center', flexGrow: 1 },
  spacer: { flexGrow: 1, minHeight: t.space[32] },
  // The live component keeps its layout size; the visual scales from its top edge (DQ-1023).
  liveFrame: { alignItems: 'center', overflow: 'visible' },
  liveScaled: { transformOrigin: 'top' } as ViewStyle,
  // Centred in the page on the controls' column: on a phone that is the gutter on both sides, wider the form column (M4.8 r1).
  copy: { alignSelf: 'center', gap: t.space[8] },
  topBar: { alignItems: 'flex-end', left: 0, pointerEvents: 'box-none', position: 'absolute', right: 0, top: 0 },
  controls: { bottom: 0, gap: t.space[16], left: 0, position: 'absolute', right: 0 },
  controlsColumn: { alignSelf: 'center', gap: t.space[16], width: '100%' },
  inFlowControls: { alignSelf: 'center', gap: t.space[16], marginTop: t.space[24] },
  // ≥ 1024: the photo pane (7 columns) with the live component on it, and the copy pane (5) with the copy and the controls.
  split: { flex: 1, flexDirection: 'row' },
  photoPane: { flexBasis: 0, flexGrow: PHOTO_COLUMNS, overflow: 'hidden' },
  splitPage: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  copyPane: { backgroundColor: t.color.scrim.photoEnd, flexBasis: 0, flexGrow: COPY_COLUMNS },
  copyPaneContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: t.space[48] },
  copyPaneColumn: { alignSelf: 'center', gap: t.space[32], maxWidth: FORM_MAX_WIDTH, width: '100%' },
}));

/** The photo drifts with full motion while the app is in front; reduced motion never starts it (09 §4.6). */
function useKenBurns(run: boolean): SharedValue<number> {
  const drift = useSharedValue(0);
  useEffect(() => {
    if (!run) return undefined;
    const start = () => drift.set(withDelay(motionDuration('spring.slow'), kenBurnsLoop()));
    start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else cancelAnimation(drift);
    });
    return () => {
      subscription.remove();
      cancelAnimation(drift);
    };
  }, [drift, run]);
  return drift;
}

/**
 * ONB-01…03 (09 §7.1, SM2): three pages, each a full-bleed night photo with a live component on it, one line of copy, the page pill
 * and "Weiter" ("Los geht's" on the last page); "Überspringen" stays in the top-right corner. First launch for guests only, once:
 * native goes on to AUTH-02 Welcome, the web to Start. Never asks for a permission.
 * DQ-1023: below 1.3 font scale a page fits its window (the live component scales, floor 0.75; on a short window the card's photo
 * turns square); from 1.3 the page scrolls with the controls after the copy; from 1024 wide photo and copy share the window.
 */
export function OnboardingScreen() {
  return (
    <ThemeScope name="carbon">
      {/* The pages are photos on the dark stage in every theme (ADR-421 b), the live components composited on them: a photo region. */}
      <View style={StyleSheet.absoluteFill} dataSet={BRAND_STAGE}>
        <Onboarding />
      </View>
    </ThemeScope>
  );
}

function Onboarding() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const motion = useMotionPreference();
  const { fontScale } = useTheme();
  const params = useLocalSearchParams<{ page?: string }>();
  const { gutter, width: windowWidth } = useBreakpoint();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [first] = useState(() => initialPage(params.page));
  const [page, setPage] = useState(first);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(0);
  const shownPage = useSharedValue(first);
  const split = (size?.width ?? windowWidth) >= SPLIT_FROM;
  const [pagerWidth, setPagerWidth] = useState(0);
  const width = split ? pagerWidth : (size?.width ?? windowWidth);
  const progress = useDerivedValue(() => (width > 0 ? scrollX.get() / width : first));
  const drift = useKenBurns(motion.enabled && !motion.reduced);
  const topPadding = useSafeEdge('top');
  const bottomPadding = useSafeEdge('bottom', space[16]);
  const [controlsHeight, setControlsHeight] = useState(0);
  const last = page === ONBOARDING_PAGES.length - 1;
  const current = ONBOARDING_PAGES[page] ?? ONBOARDING_PAGES[0];
  const id = current?.id ?? 'ONB-01';
  const inFlow = !split && fontScale >= IN_FLOW_FONT_SCALE;

  // Shown once: a start that ends here (the app killed on page 2) does not bring the pages back.
  useEffect(() => {
    markOnboardingSeen();
    void setStored('sc.onboardingSeen', '1');
  }, []);

  // `?page=` and a width change keep the page in view. DQ-1080: the placement waits for the pager itself (its measured width), never
  // the window's: before the first layout the pager is not mounted, so a scrollTo then went nowhere, and as the measured width equals
  // the window's the effect never ran again. Phones then showed page 1 under page 2's indicator and controls.
  const placed = useRef(false);
  const mountedWidth = pagerMountedWidth(split, size, pagerWidth);
  useEffect(() => {
    if (mountedWidth <= 0) return;
    const offset = (placed.current ? page : first) * mountedWidth;
    scrollX.set(offset);
    scrollRef.current?.scrollTo({ x: offset, animated: false });
    placed.current = true;
    // Only on a new size: a page change scrolls by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountedWidth]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.set(event.contentOffset.x);
    const nearest = width > 0 ? Math.round(event.contentOffset.x / width) : 0;
    if (nearest !== shownPage.get()) {
      shownPage.set(nearest);
      scheduleOnRN(setPage, nearest);
    }
  });

  const finish = () => router.replace(isNative ? WELCOME_PATH : HOME_PATH);
  const next = () => {
    if (last) {
      finish();
      return;
    }
    const target = page + 1;
    // The pill and the photo follow the scroll; reduced motion jumps (no scroll animation to follow).
    scrollRef.current?.scrollTo({ x: target * width, animated: motion.enabled && !motion.reduced });
    if (!motion.enabled || motion.reduced) {
      scrollX.set(target * width);
      shownPage.set(target);
      setPage(target);
    }
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    if (w > 0 && h > 0 && (w !== size?.width || h !== size.height)) setSize({ width: w, height: h });
  };
  const onControlsLayout = (event: LayoutChangeEvent) => setControlsHeight(event.nativeEvent.layout.height);

  const column = Math.min((size?.width ?? windowWidth) - 2 * gutter, FORM_MAX_WIDTH);
  const live = Math.min(column, LIVE_MAX);

  const controls = (pageId: string) => (
    <>
      <PageIndicator progress={progress} count={ONBOARDING_PAGES.length} label={t('onboarding.page', { current: page + 1, total: ONBOARDING_PAGES.length })} testID={`${pageId}.indicator`} />
      <Button label={last ? t('onboarding.done') : t('onboarding.next')} variant="primary" size="l" fullWidth onPress={next} testID={`${pageId}.next`} />
    </>
  );

  const pager = (pageWidth: number, pageHeight: number) => (
    <Animated.ScrollView
      ref={scrollRef}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentOffset={{ x: first * pageWidth, y: 0 }}
      style={styles.pager}
    >
      {ONBOARDING_PAGES.map((entry, index) =>
        split ? (
          <SplitPage key={entry.key} page={entry} index={index} active={index === page} width={pageWidth} height={pageHeight} scrollX={scrollX} drift={drift} />
        ) : (
          <Page
            key={entry.key}
            page={entry}
            index={index}
            active={index === page}
            width={pageWidth}
            height={pageHeight}
            column={column}
            live={live}
            scrollX={scrollX}
            drift={drift}
            top={TOP_BAR}
            bottom={inFlow ? space[24] : controlsHeight + space[24]}
            controls={inFlow && index === page ? controls(entry.id) : null}
          />
        ),
      )}
    </Animated.ScrollView>
  );

  const skip = (
    <View style={[styles.topBar, topPadding]}>
      {split ? null : <TopScrim height={TOP_BAR + space[24]} style={StyleSheet.absoluteFill} />}
      <View style={{ paddingHorizontal: gutter - space[12] }}>
        <Button label={t('onboarding.skip')} variant="tertiary" size="m" onPress={finish} testID={`${id}.skip`} />
      </View>
    </View>
  );

  if (split && size) {
    return (
      <Screen edges={EDGES} style={styles.root} testID={`${id}.root`}>
        <View style={styles.split} onLayout={onLayout}>
          <View
            style={styles.photoPane}
            aria-label={t('onboarding.label')}
            onLayout={(event) => setPagerWidth(event.nativeEvent.layout.width)}
            testID="ONB.pager"
          >
            {pagerWidth > 0 ? pager(pagerWidth, size.height) : null}
          </View>
          <ScrollView style={styles.copyPane} contentContainerStyle={[styles.copyPaneContent, { paddingHorizontal: gutter * 2 }]} showsVerticalScrollIndicator={false}>
            <View style={styles.copyPaneColumn}>
              {current ? <Copy key={current.key} page={current} active width={Math.min(FORM_MAX_WIDTH, column)} /> : null}
              <View style={styles.controlsColumn}>{controls(id)}</View>
            </View>
          </ScrollView>
        </View>
        {skip}
      </Screen>
    );
  }

  return (
    <Screen edges={EDGES} style={styles.root} testID={`${id}.root`}>
      <View style={styles.pager} onLayout={onLayout} aria-label={t('onboarding.label')} testID="ONB.pager">
        {size && !split ? pager(size.width, size.height) : null}
      </View>
      {skip}
      {inFlow ? null : (
        <View style={[styles.controls, bottomPadding, { paddingHorizontal: gutter }]} onLayout={onControlsLayout}>
          <View style={[styles.controlsColumn, { maxWidth: column }]}>{controls(id)}</View>
        </View>
      )}
    </Screen>
  );
}

/** The page's title and body, staggered in at a brand moment (StaggerIn, sanctioned on ONB). */
function Copy({ page, active, width }: { page: OnboardingPage; active: boolean; width: number }) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  return (
    <View style={[styles.copy, { width }]}>
      <StaggerIn order={0} active={active}>
        <DisplayTitle kind="copy" placement="page" color="text.primary" role="heading" layoutWidth={width} testID={`${page.id}.title`}>
          {t(`onboarding.${page.key}.title`)}
        </DisplayTitle>
      </StaggerIn>
      <StaggerIn order={1} active={active}>
        <Text variant="body" color="text.secondary" testID={`${page.id}.body`}>
          {t(`onboarding.${page.key}.body`)}
        </Text>
      </StaggerIn>
    </View>
  );
}

/** The page's photo with Ken Burns and the pager parallax; `height` is the frame's. */
function PagePhoto({ page, index, width, scrollX, drift, height, scrim = true }: { page: OnboardingPage; index: number; width: number; scrollX: SharedValue<number>; drift: SharedValue<number>; height: number | '100%'; scrim?: boolean }) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const motion = useMotionPreference();
  const parallax = usePagerParallax(scrollX, index, width);
  const placeholder = useImagePlaceholder(page.photo.blurhash, 'cover');
  const reduced = motion.reduced || !motion.enabled;
  const kenBurns = useAnimatedStyle(() => ({
    transform: reduced ? [] : [{ scale: KEN_BURNS.from + (KEN_BURNS.to - KEN_BURNS.from) * drift.get() }],
  }));
  return (
    <Animated.View style={[styles.photoFrame, { height }, parallax]}>
      <Animated.View style={[styles.photo, kenBurns]}>
        <Image
          source={page.photo.source}
          contentFit="cover"
          contentPosition={focalToPosition(page.photo.focal)}
          {...placeholder}
          alt={t(`onboarding.${page.key}.photo`)}
          accessibilityLabel={t(`onboarding.${page.key}.photo`)}
          style={styles.photo}
          testID={`${page.id}.photo`}
        />
      </Animated.View>
      {scrim ? <PhotoScrim /> : null}
    </Animated.View>
  );
}

/**
 * The live component at its layout size, scaled to `scale` from its top edge. The frame takes the scaled height, so the copy below
 * moves up with it; `onNatural` reports the unscaled height (a transform does not change the layout).
 */
function ScaledLive({ page, width, scale, compact, onNatural }: { page: OnboardingPage; width: number; scale: number; compact: boolean; onNatural: (height: number) => void }) {
  const styles = useStyles();
  const [natural, setNatural] = useState(0);
  return (
    <View style={[styles.liveFrame, natural > 0 ? { height: natural * scale } : null]} aria-hidden importantForAccessibility="no-hide-descendants">
      <View
        style={[styles.liveScaled, { transform: [{ scale }] }]}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.height;
          if (next > 0 && next !== natural) {
            setNatural(next);
            onNatural(next);
          }
        }}
      >
        <LiveComponent page={page.key} width={width} compact={compact} />
      </View>
    </View>
  );
}

type PageProps = {
  page: OnboardingPage;
  index: number;
  active: boolean;
  width: number;
  height: number;
  column: number;
  live: number;
  scrollX: SharedValue<number>;
  drift: SharedValue<number>;
  top: number;
  bottom: number;
  /** From 1.3 font scale: the pill and Weiter after the copy, in the scroll content. */
  controls: ReactNode;
};

function Page({ page, index, active, width, height, column, live, scrollX, drift, top, bottom, controls }: PageProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const topPadding = useSafeEdge('top', top);
  const topInset = useSafeInset('top');
  const [copy, setCopy] = useState<{ y: number; height: number } | null>(null);
  const [natural, setNatural] = useState(0);
  const [compact, setCompact] = useState(false);
  const fits = fontScale < IN_FLOW_FONT_SCALE;
  // DQ-1023: the room for the live component between the top bar and the copy, with the spacer's 32 above the copy.
  const room = height - topInset - top - (copy?.height ?? 0) - bottom - space[32];
  const scale = fits && copy ? (liveScale({ room, natural }) ?? 1) : 1;
  // Even at the floor the component would not fit (DQ-1023, the SE at 375×667): it takes its compact form, once (the page never flips
  // back and forth): the card's photo turns 4:3, the QR card drops its URL line.
  if (fits && copy && natural > 0 && !compact && room / natural < LIVE_SCALE_FLOOR) setCompact(true);
  // The photo ends where the copy starts (never under it), at most at PHOTO_SHARE of the page; a large font moves the copy up.
  const photoHeight = Math.round(Math.min(height * PHOTO_SHARE, copy?.y ?? height));
  const onCopyLayout = (event: LayoutChangeEvent) => {
    const { y, height: h } = event.nativeEvent.layout;
    if (y > 0 && (y !== copy?.y || h !== copy.height)) setCopy({ y, height: h });
  };
  return (
    // Off-screen pages are out of the reading order: a screen reader reads the page in view.
    <View style={[styles.page, { height, width }]} aria-hidden={!active} testID={`${page.id}.page`}>
      <PagePhoto page={page} index={index} width={width} scrollX={scrollX} drift={drift} height={photoHeight} />
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={[styles.pageContent, topPadding, { minHeight: height, paddingBottom: bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <ScaledLive page={page} width={live} scale={scale} compact={compact} onNatural={setNatural} />
        <View style={styles.spacer} />
        <View onLayout={onCopyLayout}>
          <Copy page={page} active={active} width={column} />
        </View>
        {controls ? <View style={[styles.inFlowControls, { width: column }]}>{controls}</View> : null}
      </ScrollView>
    </View>
  );
}

/** ≥ 1024 (DQ-1023): the photo fills the pane, the live component sits centred on it, scaled to the pane's height. */
function SplitPage({ page, index, active, width, height, scrollX, drift }: Omit<PageProps, 'column' | 'live' | 'top' | 'bottom' | 'controls'>) {
  const styles = useStyles();
  const [natural, setNatural] = useState(0);
  const room = height - 2 * (TOP_BAR + space[24]);
  const scale = liveScale({ room, natural }) ?? 1;
  return (
    <View style={[styles.page, styles.splitPage, { height, width }]} aria-hidden={!active} testID={`${page.id}.page`}>
      <PagePhoto page={page} index={index} width={width} scrollX={scrollX} drift={drift} height="100%" scrim={false} />
      <ScaledLive page={page} width={LIVE_MAX} scale={scale} compact={natural > 0 && room / natural < LIVE_SCALE_FLOOR} onNatural={setNatural} />
    </View>
  );
}
