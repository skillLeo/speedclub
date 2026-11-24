import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import Animated, { useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useFlag } from '@/api/queries/appConfig';
import { PHOTOS } from '@/features/gallery/data';
import { haptics } from '@/lib/haptics';
import { useSessionStore } from '@/state/session';
import { aspect, createStyles, layout, size, space, ThemeScope, useBreakpoint, useTheme } from '@/theme';
import { Button } from '@/ui/Button';
import { Photo, ratioOf } from '@/ui/Photo';
import { PhotoStageScrim } from '@/ui/PhotoStageScrim';
import { Text } from '@/ui/Text';
import { useMotionPreference } from '@/ui/motion';
import { PageIndicator, StaggerIn, TopScrim, usePagerParallax } from '@/ui/motion/kit';
import { useSafeEdge } from '@/ui/safeArea';

import { useMarkIntroSeen } from './api';

/** The four pages (R4-1.4), each with one licensed night photo (design/seed-photos/CREDITS.md). */
export const INTRO_PAGES = [
  { key: 'club', id: 'INTRO-01', photo: PHOTOS.r34 },
  { key: 'garage', id: 'INTRO-02', photo: PHOTOS.wheels },
  { key: 'sticker', id: 'INTRO-03', photo: PHOTOS.e46 },
  { key: 'community', id: 'INTRO-04', photo: PHOTOS.interior },
] as const;

export type IntroPageKey = (typeof INTRO_PAGES)[number]['key'];

type IntroPage = (typeof INTRO_PAGES)[number];

/** The crews flag (R4-2.3): page 4 names Crews only while it is on. */
export const CREWS_FLAG = 'crews';

/** The body key of a page: the community page has a variant that names Crews. */
export function introBodyKey(page: IntroPageKey, crews: boolean): string {
  return page === 'community' && crews ? 'intro.pages.community.bodyCrews' : `intro.pages.${page}.body`;
}

/** R4DQ-08: from the tablet breakpoint the pages sit in a centred dialog of at most 480 (the QR resolve column), radius 20. */
export const INTRO_DIALOG_MAX_WIDTH = (layout.feedColumn * 3) / 4;
/**
 * The dialog's height over its width: room for a 4:3 photo, the longest page's copy and the controls at 100 % font (1280 × 800:
 * 480 × 720). A shorter window takes the dialog down to its margins, and the page then scrolls under the fixed controls.
 */
const DIALOG_HEIGHT_RATIO = 3 / 2;
/** The dialog's margin to the window on every side. */
const DIALOG_MARGIN = space[40];

export type IntroStage = { dialog: boolean; width: number; height: number };

/**
 * R4DQ-08: the box the pages live in. A phone fills its window (or the modal's measured frame); from the tablet breakpoint a
 * centred dialog of at most 480 × (1.5 × its width), never closer than 40 to the window's edges.
 */
export function introStage(window: { width: number; height: number }, gutter: number, phone: boolean): IntroStage {
  if (phone) return { dialog: false, width: window.width, height: window.height };
  const width = Math.min(INTRO_DIALOG_MAX_WIDTH, window.width - 2 * gutter);
  const height = Math.min(window.height - 2 * DIALOG_MARGIN, Math.round(width * DIALOG_HEIGHT_RATIO));
  return { dialog: true, width, height };
}

/** The opacity of page `index`'s photo at pager position `position`: full on its page, gone one page away (the crossfade). */
export function pageOpacity(position: number, index: number): number {
  'worklet';
  return 1 - Math.min(1, Math.abs(position - index));
}

/** How close (in pages) the scroll must come to a tapped page before the scroll drives the pager's position again. */
export const ARRIVED = 0.01;
/** From this font scale the two buttons stack at full width on every page, so no label wraps and the controls never move (R4DQ-42). */
export const STACK_FONT_SCALE = 1.3;

/** R4DQ-59: below this height a large font would leave the copy a slit under a 4:3 photo. */
export const SHORT_STAGE = 700;
/** R4DQ-59: there the photo gives way down to this share of the stage, so the title and the first lines of the body show. */
export const SHORT_PHOTO_SHARE = 0.3;

/**
 * The photo's least height on a page: a 4:3 crop of the page's width; on a short stage at a large font (from 1.3) the photo
 * gives way to 30 % of the stage's height instead (R4DQ-59). It takes more whenever the copy leaves room.
 */
export function introPhotoMin(stage: { width: number; height: number }, fontScale: number): number {
  const crop = Math.round(stage.width / ratioOf(aspect.card));
  if (fontScale < STACK_FONT_SCALE || stage.height >= SHORT_STAGE) return crop;
  return Math.min(crop, Math.round(stage.height * SHORT_PHOTO_SHARE));
}

/** The brand stage is a Carbon ThemeScope in every theme (ADR-421 b), as ONB-01…03. */
const BRAND_STAGE = { qaExempt: 'photo', themeScope: 'carbon' } as ViewProps['dataSet'];

const useStyles = createStyles((t) => ({
  root: { backgroundColor: t.color.scrim.photoEnd, flex: 1 },
  // ≥ 768 (R4DQ-50): the dark stage behind the dialog in every theme, the Carbon canvas under the overlay scrim.
  backdrop: { alignItems: 'center', backgroundColor: t.color.scrim.photoEnd, flex: 1, justifyContent: 'center' },
  dim: { backgroundColor: t.color.overlay.scrim },
  stage: { backgroundColor: t.color.scrim.photoEnd, overflow: 'hidden' },
  dialog: { borderColor: t.color.border.hairline, borderRadius: t.radius.xl, borderWidth: t.size.border.control },
  page: { overflow: 'hidden' },
  pageScroll: { flex: 1 },
  pageContent: { flexGrow: 1 },
  // The photo takes the height the copy and the controls leave (the lead, R4DQ-08), at least a 4:3 crop of the page's width.
  photoFrame: { flexGrow: 1, overflow: 'hidden' },
  photo: { height: '100%', width: '100%' },
  copy: { gap: t.space[8], paddingBottom: t.space[24], paddingTop: t.space[16] },
  skip: { alignItems: 'flex-end', left: 0, pointerEvents: 'box-none', position: 'absolute', right: 0, top: 0 },
  skipRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'flex-end', minHeight: t.size.header, pointerEvents: 'box-none' },
  // The controls float at the stage's foot on the stage colour: the same y on every page, whatever the copy's length (R4DQ-08).
  controls: { backgroundColor: t.color.scrim.photoEnd, bottom: 0, gap: t.space[16], left: 0, paddingTop: t.space[8], position: 'absolute', right: 0 },
  buttons: { flexDirection: 'row', gap: t.space[12] },
  // From 1.3 font scale: Zurück above Weiter, both full width; page 1 keeps Zurück's room, so Weiter sits at the same y.
  stacked: { flexDirection: 'column', gap: t.space[12] },
  grow: { flex: 1 },
}));

/**
 * INTRO-01…04 (R4-1.4, docs/11_CLIENT_ROUND_4.md): four short pages after the first sign-in of an account — what Speedclub is,
 * Garage & Mods, the sticker, the community. "Überspringen" on every page but the last; "Weiter", then "Los geht's". Either ends it
 * for the account (`POST /me/intro/seen`), on every device. Settings › Hilfe opens it again (`?replay=1`), which changes nothing on
 * the server.
 * R4DQ-08: a horizontal pager (the kit's SM2 pager: swipe, photo parallax, the indicator's pill following the scroll) with the
 * photo as the lead of each page and its copy below it; the page dots and the buttons sit at a fixed y over the bottom safe area.
 * The photos crossfade with the pager's position; reduced motion jumps the pager and crossfades the new page (effect.default).
 * A page always opens at its top. From 768 the pager sits in a centred dialog (radius 20, at most 480 wide) over the dimmed app.
 */
export function IntroScreen({ replay = false }: { replay?: boolean }) {
  return (
    <ThemeScope name="carbon">
      <View style={StyleSheet.absoluteFill} dataSet={BRAND_STAGE}>
        <Intro replay={replay} />
      </View>
    </ThemeScope>
  );
}

function Intro({ replay }: { replay: boolean }) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const motion = useMotionPreference();
  const windowSize = useWindowDimensions();
  const { gutter, kind } = useBreakpoint();
  const member = useSessionStore((state) => state.status === 'member');
  const crews = useFlag(CREWS_FLAG);
  const markSeen = useMarkIntroSeen();
  // A phone takes the modal's own frame once measured (an iOS page sheet is shorter than the window).
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const stage = introStage(kind === 'phone' && frame ? frame : windowSize, gutter, kind === 'phone');
  const pageGutter = stage.dialog ? layout.gutter.desktop : gutter;
  const [page, setPage] = useState(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const shownPage = useSharedValue(0);
  // The page a button scrolls to, -1 when none (see onScroll).
  const pendingPage = useSharedValue(-1);
  /**
   * R4DQ-41: the pager's position in pages, which the photos' crossfade and parallax and the indicator's pill follow. A swipe
   * drives it from the scroll; a tap on Weiter/Zurück springs it to the new page (spring.calm, the smooth scroll's pace) while the
   * pager scrolls there, so the photos crossfade on the button path too, whether or not the platform reports the scroll on the
   * way (the web throttles it by the clock). Reduced motion: the pager jumps and the position crossfades on effect.default.
   */
  const position = useSharedValue(0);
  const width = stage.width;
  const positionX = useDerivedValue(() => position.get() * width);
  const { fontScale } = useTheme();
  const stacked = fontScale >= STACK_FONT_SCALE;
  const [primaryHeight, setPrimaryHeight] = useState(0);
  const topPadding = useSafeEdge('top');
  const bottomPadding = useSafeEdge('bottom', space[16]);
  const [controlsHeight, setControlsHeight] = useState<number>(size.touchMin + space[16] + size.button.l + space[24]);
  const current = INTRO_PAGES[page] ?? INTRO_PAGES[0];
  const last = page === INTRO_PAGES.length - 1;
  const still = motion.reduced || !motion.enabled;

  // A new size (a rotation, a resized window) keeps the page in view.
  const placed = useRef(0);
  useEffect(() => {
    if (width <= 0 || placed.current === width) return;
    placed.current = width;
    position.set(page);
    scrollRef.current?.scrollTo({ x: page * width, animated: false });
    // Only on a new width: a page change scrolls by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const onScroll = useAnimatedScrollHandler((event) => {
    if (width <= 0) return;
    const at = event.contentOffset.x / width;
    // A tap on Weiter/Zurück already chose the page and springs the position: the scroll on its way there sets neither back.
    const target = pendingPage.get();
    if (target >= 0) {
      if (Math.abs(at - target) >= ARRIVED) return;
      pendingPage.set(-1);
      return;
    }
    position.set(at);
    const nearest = Math.round(at);
    if (nearest !== shownPage.get()) {
      shownPage.set(nearest);
      scheduleOnRN(setPage, nearest);
    }
  });

  const close = () => {
    // A replay from Hilfe and a guest change nothing on the server; the member's first run ends the introduction for the account.
    if (member && !replay) markSeen.mutate();
    if (router.canGoBack()) router.back();
    else router.replace('/' as Href);
  };
  const go = (next: number) => {
    haptics.selection();
    // The page (its copy, the buttons) changes at once; the position springs there with the scroll (R4DQ-41). Reduced motion jumps
    // the pager and crossfades the position (effect.default).
    shownPage.set(next);
    pendingPage.set(next);
    position.set(still ? motion.effectTo(next, 'default') : motion.springTo(next, 'calm'));
    scrollRef.current?.scrollTo({ x: next * width, animated: !still });
    setPage(next);
  };

  const onFrameLayout = (event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    if (w > 0 && h > 0 && (w !== frame?.width || h !== frame.height)) setFrame({ width: w, height: h });
  };
  const onControlsLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next > 0 && next !== controlsHeight) setControlsHeight(next);
  };

  const pageCount = INTRO_PAGES.length;
  const pageLabel = t('intro.step', { page: page + 1, count: pageCount });
  const content = (
    <View style={[styles.stage, stage.dialog ? styles.dialog : styles.grow, stage.dialog ? { height: stage.height, width: stage.width } : null]}>
      {/* R4DQ-47: the pager is a scroll region a keyboard can reach (arrow keys page it, as the buttons do), named for a reader. */}
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        onScrollBeginDrag={() => pendingPage.set(-1)}
        scrollEventThrottle={16}
        style={styles.grow}
        tabIndex={0}
        aria-label={t('intro.label')}
        testID="INTRO.pager"
      >
        {INTRO_PAGES.map((entry, index) => (
          <IntroPageView
            key={entry.key}
            entry={entry}
            index={index}
            active={index === page}
            width={stage.width}
            height={stage.height}
            gutter={pageGutter}
            bottomSpace={controlsHeight}
            photoMin={introPhotoMin(stage, fontScale)}
            body={t(introBodyKey(entry.key, crews))}
            positionX={positionX}
            position={position}
          />
        ))}
      </Animated.ScrollView>
      {/* The way out on every page but the last ("Los geht's" ends it there), over the photo's top scrim (and the status bar). */}
      <View style={[styles.skip, stage.dialog ? null : topPadding]}>
        <TopScrim height={size.header + space[24]} style={StyleSheet.absoluteFill} />
        {last ? null : (
          <View style={[styles.skipRow, { paddingHorizontal: pageGutter - space[12] }]}>
            <Button label={t('intro.skip')} variant="onPhotoText" size="m" onPress={close} testID={`${current.id}.skip`} />
          </View>
        )}
      </View>
      <View
        style={[styles.controls, stage.dialog ? { paddingBottom: space[24] } : bottomPadding, { paddingHorizontal: pageGutter }]}
        onLayout={onControlsLayout}
        testID="INTRO.controls"
      >
        {/* The dots carry the position ("Seite 1 von 4") for a screen reader; there is no second caption (R4DQ-24). */}
        <PageIndicator progress={position} count={pageCount} label={pageLabel} testID={`${current.id}.indicator`} />
        <View style={stacked ? styles.stacked : styles.buttons}>
          {page > 0 ? (
            <View style={stacked ? null : styles.grow}>
              <Button label={t('intro.back')} variant="secondary" fullWidth onPress={() => go(page - 1)} testID={`${current.id}.back`} />
            </View>
          ) : stacked ? (
            // Zurück's room on page 1 (a Button L of the same label size), so the controls stand where they do on every other page.
            <View style={{ height: primaryHeight }} aria-hidden testID="INTRO.backRoom" />
          ) : null}
          <View
            style={stacked ? null : styles.grow}
            onLayout={(event) => {
              const next = Math.round(event.nativeEvent.layout.height);
              if (next > 0 && next !== primaryHeight) setPrimaryHeight(next);
            }}
          >
            <Button
              label={last ? t('intro.done') : t('intro.next')}
              variant="primary"
              fullWidth
              onPress={last ? close : () => go(page + 1)}
              testID={last ? `${current.id}.done` : `${current.id}.next`}
            />
          </View>
        </View>
      </View>
    </View>
  );

  if (stage.dialog) {
    return (
      <View style={styles.backdrop} testID="INTRO.screen">
        <View style={[StyleSheet.absoluteFill, styles.dim]} />
        <View role="dialog" aria-modal aria-label={t('intro.label')} testID="INTRO.dialog">
          {content}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.root} onLayout={onFrameLayout} testID="INTRO.screen">
      {content}
    </View>
  );
}

type IntroPageViewProps = {
  entry: IntroPage;
  index: number;
  active: boolean;
  width: number;
  height: number;
  gutter: number;
  /** The floating controls' height: the page's foot keeps it free. */
  bottomSpace: number;
  /** The photo's least height (introPhotoMin). */
  photoMin: number;
  body: string;
  /** The position in points, for the kit's parallax. */
  positionX: SharedValue<number>;
  /** The pager's position in pages (R4DQ-41): the scroll on a swipe, a spring (or a crossfade) on a tap. */
  position: SharedValue<number>;
};

/** One page: the photo takes what the copy leaves (at least 4:3), the copy sits on the stage above the controls. */
function IntroPageView({ entry, index, active, width, height, gutter, bottomSpace, photoMin, body, positionX, position }: IntroPageViewProps) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const parallax = usePagerParallax(positionX, index, width);
  const fade = useAnimatedStyle(() => ({ opacity: pageOpacity(position.get(), index) }));

  // R4DQ-08: a page opens at its top, also at 200 % font where the copy scrolls (the page left behind is reset too).
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [active]);

  return (
    // Off-screen pages are out of the reading order: a screen reader reads the page in view.
    <View style={[styles.page, { height, width }]} aria-hidden={!active} testID={`${entry.id}.page`}>
      <ScrollView
        ref={scrollRef}
        style={styles.pageScroll}
        contentContainerStyle={[styles.pageContent, { paddingBottom: bottomSpace }]}
        showsVerticalScrollIndicator={false}
        testID={`${entry.id}.scroll`}
      >
        <View style={[styles.photoFrame, { minHeight: photoMin }]}>
          <Animated.View style={[StyleSheet.absoluteFill, parallax, fade]}>
            <Photo
              {...entry.photo}
              aspect={aspect.hero}
              style={styles.photo}
              priority={index === 0 ? 'high' : undefined}
              label={t(`intro.pages.${entry.key}.photo`)}
              testID={`${entry.id}.photo`}
            >
              <PhotoStageScrim />
            </Photo>
          </Animated.View>
        </View>
        <View style={[styles.copy, { paddingHorizontal: gutter }]}>
          <StaggerIn order={0} active={active}>
            <Text variant="title2" role="heading" aria-level={1} testID={`${entry.id}.title`}>
              {t(`intro.pages.${entry.key}.title`)}
            </Text>
          </StaggerIn>
          <StaggerIn order={1} active={active}>
            <Text variant="body" color="text.secondary" testID={`${entry.id}.body`}>
              {body}
            </Text>
          </StaggerIn>
        </View>
      </ScrollView>
    </View>
  );
}
