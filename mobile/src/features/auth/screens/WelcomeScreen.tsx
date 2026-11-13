import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, PixelRatio, ScrollView, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent, type TextStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useAppConfig } from '@/api/queries/appConfig';
import { isWeb } from '@/lib/platform';
import { setStored } from '@/lib/storage';
import { useOnline } from '@/state/online';
import { clearAuthIntent } from '@/state/session';
import { createStyles, motion as motionTokens, space, ThemeScope, useBreakpoint, useTheme, type ThemeName } from '@/theme';
import { kenBurnsLoop, motionDuration, useMotionPreference } from '@/ui/motion';
import { Button, DisplayTitle, PressableScale, ProviderButtons, providerOrder, Screen, Text, wordmarkBox, type ProviderKey } from '@/ui';
import { useImagePlaceholder } from '@/ui/imagePlaceholder';
import { PhotoStageScrim } from '@/ui/PhotoStageScrim';
import { focalToPosition } from '@/ui/Photo';
import { useSafeEdge } from '@/ui/safeArea';

import { AppWordmark, useCustomWordmarks } from '../AppWordmark';
import { FORM_MAX_WIDTH } from '../components/AuthScreen';
import { welcomeHero } from '../brand';
import { useProviderAvailability, useProviderSignIn } from '../providers/useProviderSignIn';

const HERO = require('../../../../assets/brand/welcome-hero.jpg') as number;
/** Where the car of the bundled photo sits; a crop keeps it. Wide windows show a slice of it, tall ones all of it. */
const HERO_FOCAL = { x: 0.5, y: 0.4 };
const EDGES: readonly Edge[] = ['left', 'right'];
/** §2 brand layer: the Welcome is dark in every theme, so its tokens, the focus ring included, come from a dark theme. */
const BRAND_THEME: ThemeName = 'carbon';

/** DQ-985 (09 §7.2): the brush logo wide and white, top-left, 28 high; its width follows the bundled file's ratio. */
export const LOGO_HEIGHT = space[24] + space[4];
const BUNDLED_LOGO_RATIO = 1200 / 359;
const LOGO_WIDTH = LOGO_HEIGHT * BUNDLED_LOGO_RATIO;
/**
 * DQ-985: below 1024 the photo takes the top of the window, edge to edge, cropped from its focal point, and fades into the dark stage
 * (scrim.photo) that holds the block, as the HOME-01 FeaturedHero stacks (ADR-426 d). So the car stands alone in the upper middle and
 * the headline starts below its bumper line.
 */
export const PHOTO_SHARE = 0.68;
/** DQ-986: from here on the photo and the form share the window side by side (7 + 5 columns), so no control lies on the car. */
export const SPLIT_FROM = 1024;
const PHOTO_COLUMNS = 7;
const FORM_COLUMNS = 5;
const KEN_BURNS = motionTokens.signature.kenBurns;
/**
 * DQ-149: the body never ends on one word ("Build." alone at 430 × 1.3). Web lets the browser weigh the last lines (CSS
 * `text-wrap: pretty`), iOS uses its standard strategy, which avoids orphans, and Android's Text already breaks balanced.
 */
const BODY_WRAP = isWeb ? ({ textWrapStyle: 'pretty' } as unknown as TextStyle) : undefined;
/** FS-1: the photo settles from this scale. */
const PHOTO_START_SCALE = 1.04;
/** FS-1: the block rises this far. */
const BLOCK_RISE = space[12];

/** ADR-129: the scrim stands at its end colour by the top of the block, with at least this fade above it. */
export const SCRIM_FADE = space[48];

const useStyles = createStyles((t) => ({
  // The dark stage the photo fades into, in every theme (ADR-421 b).
  root: { backgroundColor: t.color.scrim.photoEnd, overflow: 'hidden' },
  photo: { height: '100%', width: '100%' },
  photoFrame: { left: 0, overflow: 'hidden', position: 'absolute', right: 0, top: 0 },
  scrim: { left: 0, pointerEvents: 'none', position: 'absolute', right: 0 },
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
  logoSlot: { alignItems: 'flex-start' },
  logoBox: { height: LOGO_HEIGHT, width: LOGO_WIDTH },
  // ≥ 1024: the photo pane and the form pane.
  split: { flex: 1, flexDirection: 'row' },
  photoPane: { flexBasis: 0, flexGrow: PHOTO_COLUMNS, overflow: 'hidden' },
  formPane: { backgroundColor: t.color.bg.canvas, flexBasis: 0, flexGrow: FORM_COLUMNS },
  formContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: t.space[48] },
  formColumn: { alignSelf: 'center', gap: t.space[32], maxWidth: FORM_MAX_WIDTH, width: '100%' },
  // Tablets keep the photo behind the block, in the form's column.
  stackColumn: { maxWidth: FORM_MAX_WIDTH, width: '100%' },
  // DQ-109, DQ-139: a photo chosen in the admin can be bright where the logo stands. Its own shadow keeps it readable.
  logoShadowClip: { left: 0, overflow: 'hidden', pointerEvents: 'none', position: 'absolute', right: 0 },
  logoShadow: { bottom: 0, position: 'absolute', top: 0 },
  spacer: { flexGrow: 1, minHeight: t.space[32] },
  block: { gap: t.space[24] },
  copy: { gap: t.space[8] },
  actions: { gap: t.space[12] },
  // FS-1: 8 above the tertiary button, against the 12 of the big ones.
  browse: { marginTop: -t.space[4] },
  // DQ-989: "Datenschutz · AGB" as small print (caption), each link a 44 target.
  legal: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: t.space[4] },
  legalLink: { justifyContent: 'center', minHeight: t.size.touchMin, minWidth: t.size.touchMin, paddingHorizontal: t.space[4] },
}));

/** FS-1: the scrim's share of the height. */
const FS1_SCRIM_COVERAGE = 0.55;

export type ScrimGeometry = { top: number; height: number; solidFrom: number };

/**
 * FS-1 asks for a scrim over the bottom 55 %, which leaves about 120 of it dark enough for text on any photo (ADR-129), and
 * the block is three times that. So the end colour starts at the top of the block, whatever the font scale makes of it,
 * and the fade lies above it, from 45 % of the height or from higher up when the block needs that. The scrim lies in the
 * scrolling content and reaches its end: when a large font makes the content taller than the screen, it scrolls with the
 * block, so the headline never moves onto the fade (DQ-101).
 */
export function scrimGeometry(screenHeight: number, blockTop: number, contentHeight: number = screenHeight): ScrimGeometry {
  const fadeStart = Math.max(0, Math.min(screenHeight * (1 - FS1_SCRIM_COVERAGE), blockTop - SCRIM_FADE));
  const height = Math.max(contentHeight, screenHeight) - fadeStart;
  return { top: fadeStart, height, solidFrom: height > 0 ? Math.min(1, Math.max(0, (blockTop - fadeStart) / height)) : 1 };
}

/**
 * DQ-109, DQ-139: on a photo chosen in the admin the logo stands on its own soft shadow, the wordmark's alpha spread and
 * blurred in black (design/scripts/build-logo-shadow.mjs). Following the letters it reads as their shadow; a band behind
 * the logo read as a grey stripe across a bright sky, and an ellipse as a dark oval. The file keeps at least 42 % black
 * under every ink pixel (3:1 for white ink on a white photo) and fades to nothing at its edge.
 */
const LOGO_SHADOW = require('../../../../assets/brand/logo-wide-shadow.png') as number;
/** The shadow file's margin round the logo on every side, as a share of the logo's width (PAD_SHARE in the script). */
export const LOGO_SHADOW_PAD = 0.3;

export type ShadowFrame = { left: number; top: number; width: number; height: number };

/** Where the shadow lies in the logo's box: centred on the logo, LOGO_SHADOW_PAD of its width further out on every side. */
export function logoShadowFrame(slotWidth: number, logoWidth: number, logoHeight: number): ShadowFrame {
  const pad = logoWidth * LOGO_SHADOW_PAD;
  const width = logoWidth + 2 * pad;
  return { left: (slotWidth - width) / 2, top: -pad, width, height: logoHeight + 2 * pad };
}

function LogoShadow({ slot, logoWidth }: { slot: { width: number; height: number }; logoWidth: number }) {
  const styles = useStyles();
  if (slot.width <= 0 || slot.height <= 0) return null;
  const frame = logoShadowFrame(slot.width, logoWidth, slot.height);
  // On a phone the shadow is wider than the window: the clip keeps it from widening the scroller.
  return (
    <View aria-hidden style={[styles.logoShadowClip, { height: frame.height, top: frame.top }]} testID="AUTH-02.logoScrim">
      <View style={[styles.logoShadow, { left: frame.left, width: frame.width }]}>
        <Image source={LOGO_SHADOW} contentFit="fill" accessible={false} alt="" accessibilityLabel="" style={styles.photo} />
      </View>
    </View>
  );
}

/** AUTH-02: the brand moment of 09 §7.2, in the brand layer's theme. */
export function WelcomeScreen() {
  return (
    <ThemeScope name={BRAND_THEME}>
      <Welcome />
    </ThemeScope>
  );
}

/** Logo and block follow the photo once its first crossfade has passed (effect.default). */
const ENTRANCE_DELAY = motionDuration('effect.default');

/**
 * DQ-990: the photo drifts from `kenBurns.from` to `.to` and back while the screen is in front with full motion; it stops in the
 * background and for good on the first press. Reduced motion never starts it.
 */
function useKenBurns(run: boolean) {
  const drift = useSharedValue(0);
  const stopped = useRef(false);
  useEffect(() => {
    if (!run) return;
    const start = () => {
      if (!stopped.current) drift.set(withDelay(motionDuration('spring.slow'), kenBurnsLoop()));
    };
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
  const stop = () => {
    stopped.current = true;
    cancelAnimation(drift);
  };
  return { drift, stop };
}

function Welcome() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const motion = useMotionPreference();
  const { gutter, kind, width } = useBreakpoint();
  const window = useWindowDimensions();
  const { config } = useAppConfig();
  const online = useOnline();
  const available = useProviderAvailability();
  const providers = providerOrder(available);
  const signIn = useProviderSignIn('AUTH-02');
  const split = width >= SPLIT_FROM;
  const { enabled, reduced, springTo, effectTo } = motion;
  const kenBurns = useKenBurns(enabled && !reduced);
  const choose = (provider: ProviderKey) => {
    kenBurns.stop();
    if (provider === 'email') router.push('/auth/email');
    else void signIn.run(provider);
  };
  const go = (path: '/' | '/settings/legal/privacy' | '/settings/legal/terms') => {
    kenBurns.stop();
    if (path === '/') router.replace(path);
    else router.push(path);
  };
  const topPadding = useSafeEdge('top', space[16]);
  const bottomPadding = useSafeEdge('bottom', space[16]);
  const [screenHeight, setScreenHeight] = useState(window.height);
  const [blockFrame, setBlockFrame] = useState({ y: window.height * (1 - FS1_SCRIM_COVERAGE), height: 0 });
  const [heroFailed, setHeroFailed] = useState(false);
  /** The copy column's width as laid out, with the window width it was laid out at (a stale one never decides). */
  const [copyFrame, setCopyFrame] = useState<{ window: number; width: number } | null>(null);
  // SF-R3-3 / MF-R2-1: the headline's width at every layout. On a phone the block spans the page between its gutters; in a column
  // its own layout gives the width. Until then the headline is laid out invisibly, never painted at a size it may not keep.
  const headlineWidth = kind === 'phone' ? width - 2 * gutter : copyFrame?.window === width ? copyFrame.width : undefined;
  const onCopyLayout = (event: LayoutChangeEvent) => {
    const copyWidth = event.nativeEvent.layout.width;
    setCopyFrame((current) => (current?.window === width && current.width === copyWidth ? current : { window: width, width: copyWidth }));
  };

  const photo = useSharedValue(enabled ? 0 : 1);
  const logo = useSharedValue(enabled ? 0 : 1);
  const block = useSharedValue(enabled ? 0 : 1);

  useEffect(() => {
    void setStored('sc.welcomeSeen', '1');
    clearAuthIntent();
    if (!enabled) return;
    // Reduced motion: all of it as one crossfade, no scale and no rise (§10).
    // The photo reveal is a full-screen brand moment (spring.slow); springTo is the effect.default crossfade under reduced motion.
    photo.set(springTo(1, 'slow'));
    logo.set(reduced ? effectTo(1, 'default') : withDelay(ENTRANCE_DELAY, effectTo(1, 'default')));
    block.set(reduced ? effectTo(1, 'default') : withDelay(ENTRANCE_DELAY, effectTo(1, 'slow')));
  }, [block, effectTo, enabled, logo, photo, reduced, springTo]);

  const photoStyle = useAnimatedStyle(() => ({
    opacity: photo.get(),
    transform: reduced
      ? []
      : [{ scale: (PHOTO_START_SCALE + (1 - PHOTO_START_SCALE) * photo.get()) * (KEN_BURNS.from + (KEN_BURNS.to - KEN_BURNS.from) * kenBurns.drift.get()) }],
  }));
  const logoStyle = useAnimatedStyle(() => ({ opacity: logo.get() }));
  const blockStyle = useAnimatedStyle(() => ({
    opacity: block.get(),
    transform: reduced ? [] : [{ translateY: BLOCK_RISE * (1 - block.get()) }],
  }));

  // M3.5 ADM-28: the published hero with its focal point (BL-4), the variant for this screen's pixels; the bundled photo otherwise.
  const pick = welcomeHero(config.branding, Math.max(window.width, window.height) * PixelRatio.get(), HERO_FOCAL);
  const custom = pick !== null && !heroFailed;
  const source = custom && pick ? { uri: pick.uri } : HERO;
  const focal = custom && pick ? pick.focal : HERO_FOCAL;
  // The block is the last child of the content, so where it ends the content ends.
  const contentHeight = Math.max(screenHeight, blockFrame.y + blockFrame.height);
  const scrim = scrimGeometry(screenHeight, blockFrame.y, contentHeight);
  const end = theme.color.overlay.photoScrimEnd;
  // ADM-28: a published wordmark of another ratio is drawn narrower or lower; its shadow follows the width really drawn.
  const ownLogo = useCustomWordmarks().white;
  const drawnLogoWidth = ownLogo ? wordmarkBox(LOGO_WIDTH, ownLogo.ratio).width : LOGO_WIDTH;

  const onRootLayout = (event: LayoutChangeEvent) => setScreenHeight(event.nativeEvent.layout.height);
  const onBlockLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    setBlockFrame({ y, height });
  };

  // A data: URL on web, not expo-image's blob: placeholder, which WebKit fails to load when the screen unmounts (E2E A3, ADM-34 frames).
  const placeholder = useImagePlaceholder(custom ? pick?.blurhash : null, 'cover');
  const onPhoto = !split;

  const image = (
    <Image
      source={source}
      contentFit="cover"
      contentPosition={focalToPosition(focal)}
      {...placeholder}
      onError={() => setHeroFailed(true)}
      accessible={false}
      alt=""
      accessibilityLabel=""
      style={styles.photo}
      testID="AUTH-02.photo"
    />
  );

  const logoMark = (
    <Animated.View style={[styles.logoSlot, logoStyle]} testID="AUTH-02.logoSlot">
      <View style={styles.logoBox}>
        {/* The bundled photo is dark behind the logo; a photo chosen in the admin may not be. The pane of the split is canvas. */}
        {custom && onPhoto ? <LogoShadow slot={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }} logoWidth={drawnLogoWidth} /> : null}
        <AppWordmark width={LOGO_WIDTH} height={LOGO_HEIGHT} tone="white" testID="AUTH-02.logo" />
      </View>
    </Animated.View>
  );

  const copy = (
    <View style={styles.copy} onLayout={onCopyLayout} testID="AUTH-02.copy">
      <DisplayTitle
        kind="copy"
        // ADR-426 a: the page's headline at its brand moment: full size up to two lines.
        placement="page"
        color={onPhoto ? 'onPhoto.primary' : 'text.primary'}
        role="heading"
        layoutWidth={headlineWidth}
        testID="AUTH-02.headline"
      >
        {t('welcome.headline')}
      </DisplayTitle>
      <Text
        variant="body"
        color={onPhoto ? 'onPhoto.secondary' : 'text.secondary'}
        style={BODY_WRAP}
        lineBreakStrategyIOS="standard"
        testID="AUTH-02.body"
      >
        {t('welcome.body')}
      </Text>
    </View>
  );

  const linkColor = onPhoto ? 'onPhoto.primary' : 'text.secondary';
  const actions = (
    <View style={styles.actions}>
      <ProviderButtons
        providers={providers}
        onPress={choose}
        busy={signIn.busy}
        disabled={!online}
        disabledReason={t('welcome.offline')}
        labels={{
          apple: t('providers.continue.apple'),
          google: t('providers.continue.google'),
          email: t('providers.continue.email'),
          passkey: t('providers.continue.passkey'),
        }}
        onPhoto={onPhoto}
        testID="AUTH-02.provider"
      />
      <Button
        label={t('welcome.browse')}
        variant={onPhoto ? 'onPhotoText' : 'tertiary'}
        size="m"
        fullWidth
        role="link"
        onPress={() => go('/')}
        style={styles.browse}
        testID="AUTH-02.browse"
      />
      <View style={styles.legal} testID="AUTH-02.legal">
        <PressableScale
          role="link"
          aria-label={t('welcome.privacy')}
          onPress={() => go('/settings/legal/privacy')}
          ring={onPhoto ? 'onPhoto' : 'default'}
          contentStyle={styles.legalLink}
          testID="AUTH-02.privacy"
        >
          <Text variant="caption" color={linkColor} selectable={false}>
            {t('welcome.privacy')}
          </Text>
        </PressableScale>
        <Text variant="caption" color={linkColor} aria-hidden>
          ·
        </Text>
        <PressableScale
          role="link"
          aria-label={t('welcome.terms')}
          onPress={() => go('/settings/legal/terms')}
          ring={onPhoto ? 'onPhoto' : 'default'}
          contentStyle={styles.legalLink}
          testID="AUTH-02.terms"
        >
          <Text variant="caption" color={linkColor} selectable={false}>
            {t('welcome.terms')}
          </Text>
        </PressableScale>
      </View>
    </View>
  );

  if (split) {
    return (
      <Screen edges={EDGES} style={styles.root} testID="AUTH-02.root">
        <StatusBar style="light" />
        <View style={styles.split}>
          <Animated.View style={[styles.photoPane, photoStyle]} dataSet={{ qaExempt: 'photo' }} testID="AUTH-02.photoPane">
            {image}
          </Animated.View>
          <ScrollView
            style={styles.formPane}
            contentContainerStyle={[styles.formContent, { paddingHorizontal: gutter * 2 }]}
            showsVerticalScrollIndicator={false}
            testID="AUTH-02.scroller"
          >
            <Animated.View style={[styles.formColumn, blockStyle]} testID="AUTH-02.block">
              {logoMark}
              {copy}
              {actions}
            </Animated.View>
          </ScrollView>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={EDGES} style={styles.root} testID="AUTH-02.root">
      <View style={StyleSheet.absoluteFill} onLayout={onRootLayout} />
      <StatusBar style="light" />
      <Animated.View style={[styles.photoFrame, { height: screenHeight * PHOTO_SHARE }, photoStyle]} dataSet={{ qaExempt: 'photo' }}>
        {image}
        <PhotoStageScrim testID="AUTH-02.stage" />
      </Animated.View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { minHeight: screenHeight }]}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        testID="AUTH-02.scroller"
      >
        <LinearGradient
          aria-hidden
          colors={['transparent', end, end]}
          locations={[0, scrim.solidFrom, 1]}
          style={[styles.scrim, { height: scrim.height, top: scrim.top }]}
          testID="AUTH-02.scrim"
        />
        <View style={[topPadding, { paddingHorizontal: gutter }]}>{logoMark}</View>
        <View style={styles.spacer} />
        <Animated.View
          onLayout={onBlockLayout}
          style={[styles.block, { paddingHorizontal: gutter }, bottomPadding, blockStyle]}
          testID="AUTH-02.block"
        >
          <View style={[styles.block, kind === 'phone' ? null : styles.stackColumn]}>
            {copy}
            {actions}
          </View>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}
