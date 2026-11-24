import { useEffect, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Line, Path } from 'react-native-svg';

import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, maxFontScale, resolveColor, size, space, typography, typographyDesktop, useTheme, type ColorToken } from '@/theme';

import {
  angleForFraction,
  arcLength,
  arcPath,
  dashOffset,
  gaugeGeometry,
  gaugeHeight,
  gaugeTicks,
  scoreDelta,
  scoreFraction,
} from './buildScoreGaugeMath';
import { useMotionPreference } from './motion';
import { OdometerNumber, zeroed } from './motion/OdometerNumber';
import { Text, useDesktopType } from './Text';

export type BuildScoreGaugeProps = {
  total: number;
  /** The total before the last computation: a rise shows "+25" and plays one light haptic on the first view. */
  previousTotal?: number | null;
  /** The total as the locale writes it ("642", "1.000"); the digits roll on the first view. */
  valueText: string;
  /** "von 1000" under the numeral. */
  scaleText: string;
  /**
   * "Stufe 4" under "von 1000", for a gauge that stands alone (the Journey and Wrapped pictures). R6-3: on the page the stage is
   * the label the gauge sits beside, and the section draws it (with the rise) next to the gauge; it then leaves this out.
   */
  stageText?: string;
  /** "+25" for the rise, from `scoreDelta`, as a chip above the numeral; the caller formats it. Without it no chip is drawn here. */
  deltaText?: (delta: number) => string;
  /** What screen readers hear instead of the drawing: "Build Score 642 von 1000, Stufe 4". */
  accessibilityLabel: string;
  /** The square box the gauge is drawn in. */
  box: number;
  /**
   * The first view of this vehicle's gauge in the session (`useOdometerOnce`): the needle sweeps up from 0 on spring.default, the
   * arc fills behind it, the digits roll, and a rise plays its haptic. Afterwards the gauge stands at its value.
   */
  first?: boolean;
  /** False keeps the mobile type sizes on the web desktop: a gauge of fixed size inside a card (the Journey card). */
  desktopSize?: boolean;
  /** `onPhoto` on a dark stage in every theme (the Journey card, ADR-421 b): the drawing and the text in the on-photo tones. */
  tone?: 'default' | 'onPhoto';
  style?: StyleProp<ViewStyle>;
  /** Sub-testIDs: `.arc`, `.needle`, `.value`, `.stage`, `.delta`. */
  testID?: string;
};

/** The arc is a slider track (4); ticks are hairlines (1); the needle is a focus ring's stroke (2). */
const ARC_STROKE = size.slider.track;
const TICK_STROKE = size.border.control;
const NEEDLE_STROKE = size.border.focusRing;

const useStyles = createStyles((t) => ({
  // DQ-M53R2-01: the needle's square layer turns, and a turned square reaches past the box (at 200 % past a phone's edge, which made
  // the page pan). Everything drawn lies inside the circle, so the box clips the turned layer's corners only.
  root: { alignSelf: 'center', overflow: 'hidden' },
  layer: { left: 0, position: 'absolute', top: 0 },
  // R6-3: the numeral sits on the pivot, the chip above it, "von 1000" (and a picture's stage) under it; each a row the box wide.
  textRow: { alignItems: 'center', left: 0, pointerEvents: 'none', position: 'absolute' },
  chipRow: { justifyContent: 'flex-end', paddingBottom: t.space[4], top: 0 },
  below: { gap: t.space[2] },
  delta: {
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.full,
    paddingHorizontal: t.space[8],
    paddingVertical: t.space[2],
  },
}));

/**
 * Client round 6 (R6-3, "clearly smaller and quieter"): the gauge's box on the page and on the Journey card, 120 (a large avatar and a
 * small one; 208 in round 4, 232 in round 3, 264 at first). The section grows it with the font and on the web desktop.
 */
export const GAUGE_BOX = size.avatar.xl + size.avatar.sm;

/** R6-3: the gauge's labels are part of its drawing, so they stop growing where its numeral does (1.3, the numerals' cap). */
export const GAUGE_TEXT_CAP = maxFontScale.heroNumeralS;

type GaugeTextRole = 'heroNumeralS' | 'heroNumeralXs' | 'labelUnit' | 'calloutStrong';

/** A role's line box as Text sets it inside the gauge: its desktop size where it has one, at the gauge's capped font scale. */
function lineOf(role: GaugeTextRole, scale: number, desktop: boolean): number {
  const desktopRole = desktop ? (typographyDesktop as Partial<Record<GaugeTextRole, { lineHeight: number }>>)[role] : undefined;
  return (desktopRole ?? typography[role]).lineHeight * scale;
}

/** The font scale the gauge's text is set at: the reader's, capped at the numerals' cap and at a picture's own cap. */
export function gaugeTextScale(fontScale: number, themeCap?: number): number {
  return Math.min(fontScale, GAUGE_TEXT_CAP, themeCap ?? GAUGE_TEXT_CAP);
}

export type GaugeLayout = {
  /** The layout height of the gauge (the square's empty bottom left out). */
  height: number;
  /** Top of the numeral's line box, from the box's top. */
  numeralTop: number;
  numeralLine: number;
  /** Top of "von 1000" (and the stage), from the box's top. */
  belowTop: number;
};

/**
 * Where the gauge's text sits and how tall the gauge is laid out, from the type tokens (no measuring, so the skeleton and the first
 * frame have the final geometry): the numeral's line centred on the pivot, "von 1000" `space[2]` under it, a picture's stage under
 * that, and the box down to the arc's ends or the last line.
 */
export function gaugeLayout(
  box: number,
  { valueText, scale, desktop, stage }: { valueText: string; scale: number; desktop: boolean; stage: boolean },
): GaugeLayout {
  const { centre, radius } = gaugeGeometry(box, ARC_STROKE, space[2]);
  const numeralLine = lineOf(gaugeNumeralVariant(valueText), scale, desktop);
  const numeralTop = centre - numeralLine / 2;
  const belowTop = numeralTop + numeralLine + space[2];
  const below = lineOf('labelUnit', scale, desktop) + (stage ? space[2] + lineOf('calloutStrong', scale, desktop) : 0);
  return { height: gaugeHeight(box, radius, ARC_STROKE, belowTop + below), numeralTop, numeralLine, belowTop };
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The gauge's tones on the page and on a dark stage. The accent tip is the same on both. */
const TONES = {
  default: {
    value: 'text.primary',
    track: 'border.default',
    major: 'text.tertiary',
    minor: 'border.strong',
    label: 'text.secondary',
  },
  onPhoto: {
    value: 'onPhoto.primary',
    track: 'onPhoto.border',
    major: 'onPhoto.secondary',
    minor: 'onPhoto.border',
    label: 'onPhoto.secondary',
  },
} as const satisfies Record<string, Record<string, ColorToken>>;

/**
 * The Build Score gauge (M5.9c ★, ADR-508, spike §6): a 0–1000 tachometer arc with ticks every 100 (longer at each stage start), the
 * filled arc in the primary text tone, a short floating needle whose tip is the only accent, and in the middle the score as an
 * odometer numeral (`hero.numeral.s` since client round 6, tabular) on the pivot and "von 1000" under it (a picture's stage under
 * that). react-native-svg with Reanimated: the arc fills through an
 * animated `strokeDashoffset`, the needle turns as a `rotate` transform of its own layer (transform only, 09 §4.7).
 *
 * Native, first view: needle and arc rise from 0 on spring.default. Reduced motion: both stand at the value at once. Web: the
 * MaintenanceRing approach — the drawing stands at its value and crossfades in on effect.default. Screen readers hear one label.
 */
export function BuildScoreGauge({
  total,
  previousTotal = null,
  valueText,
  scaleText,
  stageText,
  deltaText,
  accessibilityLabel,
  box,
  first = false,
  tone = 'default',
  desktopSize = true,
  style,
  testID,
}: BuildScoreGaugeProps) {
  const colors = TONES[tone];
  const theme = useTheme();
  const styles = useStyles();
  const motion = useMotionPreference();
  const desktop = useDesktopType() && desktopSize;
  const fraction = scoreFraction(total);
  // R6-3: the drawing scales with the box (ratios of the radius), so the 120 gauge is the 208 one made smaller; strokes stay tokens.
  const { centre, radius, tickInner, tickOuter, tickMinorInset, needleInner, tipStart, needleOuter } = gaugeGeometry(box, ARC_STROKE, space[2]);
  const length = arcLength(radius);
  const track = arcPath(centre, centre, radius);
  const ticks = gaugeTicks(centre, centre, tickInner, tickOuter, tickMinorInset);
  const layout = gaugeLayout(box, {
    valueText,
    scale: gaugeTextScale(theme.fontScale, theme.fontScaleCap),
    desktop,
    stage: stageText !== undefined,
  });

  const sweeps = first && !isWeb && !motion.reduced;
  const progress = useSharedValue(sweeps ? 0 : fraction);
  const shown = useSharedValue(isWeb && !motion.reduced ? 0 : 1);

  useEffect(() => {
    if (isWeb) {
      progress.set(fraction);
      shown.set(motion.effectTo(1, 'default'));
      return;
    }
    progress.set(motion.reduced ? fraction : motion.springTo(fraction, 'default'));
  }, [fraction, motion, progress, shown]);

  const delta = scoreDelta(previousTotal, total);
  // One light haptic for the rise, on the first view only (09 §4.8: one per intent; the service is silent on web).
  const played = useRef(false);
  useEffect(() => {
    if (!first || delta === null || played.current) return;
    played.current = true;
    haptics.light();
  }, [delta, first]);

  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: dashOffset(length, progress.get()) }));
  const needleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angleForFraction(progress.get())}deg` }],
  }));
  const fade = useAnimatedStyle(() => ({ opacity: shown.get() }));

  const primary = resolveColor(theme, colors.value);
  // The box ends under the arc's ends (cos 60° = ½ r below the pivot) or under the last line, whichever is lower: the drawing is
  // square, its empty bottom corner is not part of the layout.
  const height = layout.height;
  const id = (part: string) => (testID ? `${testID}.${part}` : undefined);

  return (
    <View
      accessible
      role="img"
      aria-label={accessibilityLabel}
      style={[styles.root, { height, width: box }, style]}
      testID={testID}
    >
      <Animated.View style={[styles.layer, fade]} aria-hidden>
        <Svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} testID={id('arc')}>
          {ticks.map((tick) => (
            <Line
              key={tick.value}
              x1={tick.from.x}
              y1={tick.from.y}
              x2={tick.to.x}
              y2={tick.to.y}
              stroke={resolveColor(theme, tick.major ? colors.major : colors.minor)}
              strokeWidth={TICK_STROKE}
              strokeLinecap="round"
            />
          ))}
          <Path
            d={track}
            fill="none"
            stroke={resolveColor(theme, colors.track)}
            strokeWidth={ARC_STROKE}
            strokeLinecap="round"
          />
          {fraction <= 0 && isWeb ? null : isWeb ? (
            <Path
              d={track}
              fill="none"
              stroke={primary}
              strokeWidth={ARC_STROKE}
              strokeLinecap="round"
              strokeDasharray={[length, length]}
              strokeDashoffset={dashOffset(length, fraction)}
            />
          ) : (
            <AnimatedPath
              d={track}
              fill="none"
              stroke={primary}
              strokeWidth={ARC_STROKE}
              strokeLinecap="round"
              strokeDasharray={[length, length]}
              animatedProps={arcProps}
            />
          )}
        </Svg>
      </Animated.View>
      <Animated.View
        style={[styles.layer, { height: box, width: box }, fade, needleStyle]}
        aria-hidden
        testID={id('needle')}
      >
        <Svg width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
          <Line
            x1={centre}
            y1={centre - needleInner}
            x2={centre}
            y2={centre - tipStart}
            stroke={primary}
            strokeWidth={NEEDLE_STROKE}
            strokeLinecap="round"
          />
          <Line
            x1={centre}
            y1={centre - tipStart}
            x2={centre}
            y2={centre - needleOuter}
            stroke={resolveColor(theme, 'accent.fill')}
            strokeWidth={NEEDLE_STROKE}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
      {delta !== null && deltaText ? (
        <View style={[styles.textRow, styles.chipRow, { height: layout.numeralTop, width: box }]} aria-hidden>
          <ScoreDelta text={deltaText(delta)} testID={id('delta')} />
        </View>
      ) : null}
      <View style={[styles.textRow, { top: layout.numeralTop, width: box }]} aria-hidden>
        <OdometerNumber
          value={valueText}
          rollFrom={first && !motion.reduced ? zeroed(valueText) : undefined}
          variant={gaugeNumeralVariant(valueText)}
          color={colors.value}
          desktopSize={desktopSize}
          testID={id('value')}
        />
      </View>
      <View style={[styles.textRow, styles.below, { top: layout.belowTop, width: box }]} aria-hidden>
        <Text variant="labelUnit" color={colors.label} hyphenate={false} numeric fontScaleCap={GAUGE_TEXT_CAP} desktopSize={desktopSize}>
          {scaleText}
        </Text>
        {stageText !== undefined ? (
          <Text
            variant="calloutStrong"
            color={colors.value}
            hyphenate={false}
            fontScaleCap={GAUGE_TEXT_CAP}
            desktopSize={desktopSize}
            testID={id('stage')}
          >
            {stageText}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The centre number's role. Client round 6 (R6-3): `hero.numeral.s`, so the gauge is a quiet companion of the stage, not a hero. The
 * full score with a group separator ("1.000", "1,000") is five glyphs, 2.0 em wide; R4-1.2 keeps it inside the needle's inner
 * circle (0.6 r, 67 at the 120 box), so it takes the next step, `hero.numeral.xs` (64). Up to three digits are 1.35 em (54).
 */
export function gaugeNumeralVariant(valueText: string): 'heroNumeralS' | 'heroNumeralXs' {
  return /\D/.test(valueText) ? 'heroNumeralXs' : 'heroNumeralS';
}

/** The rise since the last computation ("+25") as a small chip: above the numeral in a picture, beside the stage on the page. */
export function ScoreDelta({ text, testID }: { text: string; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.delta} testID={testID}>
      <Text variant="caption" color="state.success" numeric hyphenate={false}>
        {text}
      </Text>
    </View>
  );
}

/**
 * GAR-01's compact score (and anywhere a card shows it): the arc alone at a 40 box (no needle, no ticks), filled to the score, beside
 * the number in `hero.numeral.s` and the stage. Static: a list never animates on mount.
 */
export function BuildScoreMeter({
  total,
  box = size.avatar.md,
  testID,
}: {
  total: number;
  box?: number;
  testID?: string;
}) {
  const theme = useTheme();
  const centre = box / 2;
  const radius = centre - ARC_STROKE / 2;
  const length = arcLength(radius);
  const track = arcPath(centre, centre, radius);
  const fraction = scoreFraction(total);
  return (
    <View aria-hidden style={{ height: box, width: box }} testID={testID}>
      <Svg width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
        <Path
          d={track}
          fill="none"
          stroke={resolveColor(theme, 'border.default')}
          strokeWidth={ARC_STROKE}
          strokeLinecap="round"
        />
        {fraction > 0 ? (
          <Path
            d={track}
            fill="none"
            stroke={resolveColor(theme, 'text.primary')}
            strokeWidth={ARC_STROKE}
            strokeLinecap="round"
            strokeDasharray={[length, length]}
            strokeDashoffset={dashOffset(length, fraction)}
          />
        ) : null}
      </Svg>
    </View>
  );
}

/**
 * A geometry-true stand-in for the gauge while the score loads (or is being computed, or offline): the track arc in the skeleton
 * tone, laid out at `height` (the ready gauge's, from `gaugeLayout`) so nothing moves when the gauge replaces it.
 */
export function BuildScoreGaugeTrack({ box, height = box, testID }: { box: number; height?: number; testID?: string }) {
  const theme = useTheme();
  const styles = useStyles();
  const { centre, radius } = gaugeGeometry(box, ARC_STROKE, space[2]);
  return (
    <View aria-hidden style={[styles.root, { height, width: box }]} testID={testID}>
      <Svg width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
        <Path
          d={arcPath(centre, centre, radius)}
          fill="none"
          stroke={resolveColor(theme, 'skeleton.base')}
          strokeWidth={ARC_STROKE}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
