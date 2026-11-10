import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelRatio, ScrollView, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useAppConfig } from '@/api/queries/appConfig';
import { isWeb } from '@/lib/platform';
import { setStored } from '@/lib/storage';
import { clearAuthIntent } from '@/state/session';
import {
  createStyles,
  motion as motionTokens,
  space,
  ThemeScope,
  useBreakpoint,
  useMotion,
  useTheme,
  type ThemeName,
} from '@/theme';
import { Button, Screen, Text, wordmarkBox } from '@/ui';
import { useImagePlaceholder } from '@/ui/imagePlaceholder';
import { focalToPosition } from '@/ui/Photo';
import { useSafeEdge } from '@/ui/safeArea';

import { AppWordmark, useCustomWordmarks } from '../AppWordmark';
import { welcomeHero } from '../brand';

const HERO = require('../../../../assets/brand/welcome-hero.jpg') as number;
/** Where the car of the bundled photo sits; a crop keeps it. Wide windows show a slice of it, tall ones all of it. */
const HERO_FOCAL = { x: 0.5, y: 0.4 };
const EDGES: readonly Edge[] = ['left', 'right'];
/** §2 brand layer: the Welcome is dark in every theme, so its tokens, the focus ring included, come from a dark theme. */
const BRAND_THEME: ThemeName = 'carbon';

/** FS-1, top of the logo as a share of the height, and its width. */
const LOGO_TOP = 0.28;
const LOGO_WIDTH_SHARE = 0.72;
const LOGO_MAX_WIDTH = 320;
const BRAND_POSITION = { qaExempt: 'brand-position' } as const;
/**
 * DQ-149: the body never ends on one word ("Build." alone at 430 × 1.3). Web lets the browser weigh the last lines (CSS
 * `text-wrap: pretty`), iOS uses its standard strategy, which avoids orphans, and Android's Text already breaks balanced.
 */
const BODY_WRAP = isWeb ? ({ textWrap: 'pretty' } as unknown as TextStyle) : undefined;
/** FS-1: the photo settles from this scale. */
const PHOTO_START_SCALE = 1.04;
/** FS-1: the block rises this far. */
const BLOCK_RISE = space[12];

/** ADR-129: the scrim stands at its end colour by the top of the block, with at least this fade above it. */
export const SCRIM_FADE = space[48];

const useStyles = createStyles((t) => ({
  // A night photo fades in from black in every theme.
  root: { backgroundColor: t.color.media.ground, overflow: 'hidden' },
  photo: { height: '100%', width: '100%' },
  scrim: { left: 0, pointerEvents: 'none', position: 'absolute', right: 0 },
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
  logoSlot: { alignItems: 'center' },
  // DQ-109, DQ-139: a photo chosen in the admin can be bright where the logo stands. Its own shadow keeps it readable.
  logoShadowClip: { left: 0, overflow: 'hidden', pointerEvents: 'none', position: 'absolute', right: 0 },
  logoShadow: { bottom: 0, position: 'absolute', top: 0 },
  spacer: { flexGrow: 1, minHeight: t.space[32] },
  block: { gap: t.space[24] },
  blockRow: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[24] },
  copy: { gap: t.space[8] },
  copyRow: { flexBasis: '45%', flexGrow: 1, flexShrink: 1 },
  actions: { gap: t.space[12] },
  // DQ-107: on a line of its own it takes the block's width at most, so the buttons wrap inside it, never into the gutter.
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    gap: t.space[12],
    maxWidth: '100%',
    minWidth: 0,
  },
  // DQ-108: a hugging button aligns itself to the top; in the row the M button centres on the two L buttons.
  rowButton: { alignSelf: 'center' },
  // FS-1: 8 above the tertiary button, against the 12 of the two big ones.
  browse: { marginTop: -t.space[4] },
  browseRow: { alignSelf: 'center', marginTop: 0 },
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

/** Where the shadow lies in the logo's slot: centred on the logo, LOGO_SHADOW_PAD of its width further out on every side. */
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

/** AUTH-02: the brand moment of §13 FS-1, in the brand layer's theme. */
export function WelcomeScreen() {
  return (
    <ThemeScope name={BRAND_THEME}>
      <Welcome />
    </ThemeScope>
  );
}

function Welcome() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const motion = useMotion();
  const { gutter, kind, width } = useBreakpoint();
  const window = useWindowDimensions();
  const { config } = useAppConfig();
  const bottomPadding = useSafeEdge('bottom', space[16]);
  const [screenHeight, setScreenHeight] = useState(window.height);
  const [blockFrame, setBlockFrame] = useState({ y: window.height * (1 - FS1_SCRIM_COVERAGE), height: 0 });
  const [heroFailed, setHeroFailed] = useState(false);
  const [logoSlot, setLogoSlot] = useState({ width: 0, height: 0 });
  const wide = kind !== 'phone';

  const photo = useSharedValue(motion.enabled ? 0 : 1);
  const logo = useSharedValue(motion.enabled ? 0 : 1);
  const block = useSharedValue(motion.enabled ? 0 : 1);
  const { enabled, reduced, timingTo } = motion;

  useEffect(() => {
    void setStored('sc.welcomeSeen', '1');
    clearAuthIntent();
    if (!enabled) return;
    // Reduced motion: all of it as one crossfade, no scale and no rise (§10).
    photo.set(timingTo(1, 'large', 'decelerate'));
    logo.set(reduced ? timingTo(1, 'small') : withDelay(motionTokens.duration.reducedCrossfade, timingTo(1, 'small')));
    block.set(reduced ? timingTo(1, 'medium') : withDelay(motionTokens.duration.small, timingTo(1, 'medium', 'decelerate')));
  }, [block, enabled, logo, photo, reduced, timingTo]);

  const photoStyle = useAnimatedStyle(() => ({
    opacity: photo.get(),
    transform: reduced ? [] : [{ scale: PHOTO_START_SCALE + (1 - PHOTO_START_SCALE) * photo.get() }],
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
  const logoWidth = Math.min(width * LOGO_WIDTH_SHARE, LOGO_MAX_WIDTH);
  // ADM-28: a published wordmark of another ratio is drawn narrower or lower; its shadow follows the width really drawn.
  const ownLogo = useCustomWordmarks().white;
  const drawnLogoWidth = ownLogo ? wordmarkBox(logoWidth, ownLogo.ratio).width : logoWidth;

  const onRootLayout = (event: LayoutChangeEvent) => setScreenHeight(event.nativeEvent.layout.height);
  const onBlockLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    setBlockFrame({ y, height });
  };

  // A data: URL on web, not expo-image's blob: placeholder, which WebKit fails to load when the screen unmounts (E2E A3, ADM-34 frames).
  const placeholder = useImagePlaceholder(custom ? pick?.blurhash : null, 'cover');

  return (
    <Screen edges={EDGES} style={styles.root} testID="AUTH-02.root">
      <View style={StyleSheet.absoluteFill} onLayout={onRootLayout} />
      <StatusBar style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, photoStyle]} dataSet={{ qaExempt: 'photo' }}>
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
        <Animated.View
          onLayout={(event) => {
            const { width: slotWidth, height } = event.nativeEvent.layout;
            setLogoSlot((current) => (current.width === slotWidth && current.height === height ? current : { width: slotWidth, height }));
          }}
          // ADR-149: FS-1's share of the height is no step of the spacing scale; the audit accepts it on this slot only.
          dataSet={BRAND_POSITION}
          style={[styles.logoSlot, { marginTop: screenHeight * LOGO_TOP }, logoStyle]}
          testID="AUTH-02.logoSlot"
        >
          {/* The bundled photo is dark behind the logo (16.9:1); a photo chosen in the admin may not be. */}
          {custom ? <LogoShadow slot={logoSlot} logoWidth={drawnLogoWidth} /> : null}
          <AppWordmark width={logoWidth} tone="white" testID="AUTH-02.logo" />
        </Animated.View>
        <View style={styles.spacer} />
        <Animated.View
          onLayout={onBlockLayout}
          style={[wide ? styles.blockRow : styles.block, { paddingHorizontal: gutter }, bottomPadding, blockStyle]}
          testID="AUTH-02.block"
        >
          <View style={[styles.copy, wide ? styles.copyRow : null]}>
            <Text variant="displayL" color="onPhoto.primary" role="heading" testID="AUTH-02.headline">
              {t('welcome.headline')}
            </Text>
            <Text
              variant="body"
              color="onPhoto.secondary"
              style={BODY_WRAP}
              lineBreakStrategyIOS="standard"
              testID="AUTH-02.body"
            >
              {t('welcome.body')}
            </Text>
          </View>
          <View style={wide ? styles.actionsRow : styles.actions}>
            <Button
              label={t('welcome.signUp')}
              variant="brand"
              size="l"
              fullWidth={!wide}
              role="link"
              style={wide ? styles.rowButton : undefined}
              onPress={() => router.push('/sign-up')}
              testID="AUTH-02.signUp"
            />
            <Button
              label={t('welcome.signIn')}
              variant="onPhoto"
              size="l"
              fullWidth={!wide}
              role="link"
              style={wide ? styles.rowButton : undefined}
              onPress={() => router.push('/sign-in')}
              testID="AUTH-02.signIn"
            />
            <Button
              label={t('welcome.browse')}
              variant="onPhotoText"
              size="m"
              fullWidth={!wide}
              role="link"
              onPress={() => router.replace('/')}
              style={wide ? styles.browseRow : styles.browse}
              testID="AUTH-02.browse"
            />
          </View>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}
