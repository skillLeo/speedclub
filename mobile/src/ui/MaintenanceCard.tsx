import { useEffect, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { isWeb } from '@/lib/platform';
import { createStyles, resolveColor, size, space, useTheme, type ColorToken } from '@/theme';

import { Icon, type IconName } from './icons/Icon';
import { useMotionPreference } from './motion';
import { joinLabel, RowBody, RowDivider } from './rowParts';
import { Text } from './Text';

export type MaintenanceTone = 'ok' | 'soon' | 'overdue' | 'unknown';

export type MaintenanceCardProps = {
  /** `hero`: the next due item on MNT-01, with the countdown as a hero numeral and the large ring. `row`: one row of a group. */
  variant?: 'hero' | 'row';
  /** "HU/AU", "Ölwechsel", a custom title. */
  title: string;
  /** GAR-01: the vehicle the item belongs to. */
  subtitle?: string;
  glyph: IconName;
  /** "Fällig im März 2027" */
  due?: string | null;
  /** "in 132 Tagen", "seit 12 Tagen überfällig" (tabular). */
  countdown?: string | null;
  /** The hero's numeral and its unit: 132 · Tage. */
  figure?: { value: string; unit: string } | null;
  /** "Zuletzt am 14. Juni 2025 · 41.200 km" */
  meta?: string | null;
  tone: MaintenanceTone;
  /** 0–1 of the interval passed; null draws the track only. */
  progress: number | null;
  /** "Wird gesendet…", "Fehlgeschlagen", "Pausiert": a quiet line under the rest. */
  status?: string | null;
  /** A badge beside the title (Beispiel on a sample). */
  badge?: ReactNode;
  onPress?: () => void;
  /** Hairline under the row, inset to the text (not after the last row of a group). */
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** 09 §5 MaintenanceCard: overdue in accent text, < 30 days in state.warning, else the primary text; no due date in tertiary. */
export const TONE_COLOR: Readonly<Record<MaintenanceTone, ColorToken>> = {
  ok: 'text.secondary',
  soon: 'state.warning',
  overdue: 'accent.fg',
  unknown: 'text.tertiary',
};

const ARC_COLOR: Readonly<Record<MaintenanceTone, ColorToken>> = {
  ok: 'text.primary',
  soon: 'state.warning',
  overdue: 'accent.fg',
  unknown: 'text.tertiary',
};

/** The row's ring takes the row thumbnail's box (56), the hero's the large avatar's (88); the stroke is a slider track (4). */
const ROW_RING = size.thumb.row;
const HERO_RING = size.avatar.xl;
const STROKE = size.slider.track;

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.withThumb, paddingHorizontal: t.space[16], paddingVertical: t.space[12] },
  hero: { alignItems: 'center', flexDirection: 'row', gap: t.space[20] },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  titleLine: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  figure: { alignItems: 'baseline', columnGap: t.space[4], flexDirection: 'row', flexWrap: 'wrap' },
  ringBox: { alignItems: 'center', justifyContent: 'center' },
  ringGlyph: { position: 'absolute' },
  chevron: { marginLeft: t.space[4] },
}));

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The progress ring: the share of the interval that has passed. Native sweeps the arc in on spring.default when the card appears
 * (09 §5); reduced motion and the web show the final arc, the web crossfading it in on effect.default.
 */
export function MaintenanceRing({ progress, tone, glyph, box, testID }: { progress: number | null; tone: MaintenanceTone; glyph: IconName; box: number; testID?: string }) {
  const theme = useTheme();
  const styles = useStyles();
  const motion = useMotionPreference();
  const value = progress === null ? 0 : Math.min(1, Math.max(0, progress));
  const radius = (box - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = box / 2;
  const sweep = useSharedValue(isWeb || motion.reduced ? value : 0);
  const shown = useSharedValue(isWeb && !motion.reduced ? 0 : 1);

  useEffect(() => {
    if (isWeb) {
      sweep.set(value);
      shown.set(motion.effectTo(1, 'default'));
      return;
    }
    sweep.set(motion.reduced ? value : motion.springTo(value, 'default'));
  }, [motion, shown, sweep, value]);

  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - sweep.get()) }));
  const fade = useAnimatedStyle(() => ({ opacity: shown.get() }));
  const glyphSize = box >= HERO_RING ? 24 : 20;

  return (
    <View style={[styles.ringBox, { height: box, width: box }]} aria-hidden testID={testID}>
      <Animated.View style={fade}>
        <Svg width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
          <Circle cx={centre} cy={centre} r={radius} fill="none" stroke={resolveColor(theme, 'border.default')} strokeWidth={STROKE} />
          {progress === null ? null : isWeb ? (
            <Circle
              cx={centre}
              cy={centre}
              r={radius}
              fill="none"
              stroke={resolveColor(theme, ARC_COLOR[tone])}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={[circumference, circumference]}
              strokeDashoffset={circumference * (1 - value)}
              rotation={-90}
              originX={centre}
              originY={centre}
            />
          ) : (
            <AnimatedCircle
              cx={centre}
              cy={centre}
              r={radius}
              fill="none"
              stroke={resolveColor(theme, ARC_COLOR[tone])}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={[circumference, circumference]}
              animatedProps={arcProps}
              rotation={-90}
              originX={centre}
              originY={centre}
            />
          )}
        </Svg>
      </Animated.View>
      <View style={styles.ringGlyph}>
        <Icon name={glyph} size={glyphSize} color={tone === 'unknown' ? 'text.tertiary' : 'text.primary'} />
      </View>
    </View>
  );
}

/**
 * 09 §5 MaintenanceCard (MNT-01, GAR-01): title, due, countdown (tnum) and the progress ring around the type's glyph. Warning tone
 * under 30 days, accent text when overdue. A row in a grouped list, or the hero of MNT-01 with the countdown as a numeral.
 */
export function MaintenanceCard({
  variant = 'row',
  title,
  subtitle,
  glyph,
  due,
  countdown,
  figure,
  meta,
  tone,
  progress,
  status,
  badge,
  onPress,
  divider = false,
  style,
  testID,
}: MaintenanceCardProps) {
  const styles = useStyles();
  const label = joinLabel([title, subtitle, due, countdown, meta, status]);
  const hero = variant === 'hero';
  const body = (
    <View style={hero ? styles.hero : styles.row}>
      <MaintenanceRing progress={progress} tone={tone} glyph={glyph} box={hero ? HERO_RING : ROW_RING} testID={testID ? `${testID}.ring` : undefined} />
      <View style={styles.text}>
        {hero && figure ? (
          <View style={styles.figure}>
            <Text variant="heroNumeralS" numeric color={tone === 'overdue' ? 'accent.fg' : 'text.primary'} testID={testID ? `${testID}.figure` : undefined}>
              {figure.value}
            </Text>
            <Text variant="labelUnit" color="text.secondary">
              {figure.unit}
            </Text>
          </View>
        ) : null}
        <View style={styles.titleLine}>
          <Text variant="headline" testID={testID ? `${testID}.title` : undefined}>
            {title}
          </Text>
          {badge}
        </View>
        {subtitle ? (
          <Text variant="callout" color="text.secondary" hyphenate={false}>
            {subtitle}
          </Text>
        ) : null}
        {due ? (
          // A date line: a month is never hyphenated ("No- / vember" at 200 %, m4.10-shots-final GAR-01-due); it wraps at its spaces.
          <Text variant="callout" color="text.secondary" hyphenate={false} testID={testID ? `${testID}.due` : undefined}>
            {due}
          </Text>
        ) : null}
        {countdown && !(hero && figure) ? (
          <Text variant="caption" numeric color={TONE_COLOR[tone]} testID={testID ? `${testID}.countdown` : undefined}>
            {countdown}
          </Text>
        ) : null}
        {hero && figure && countdown ? (
          <Text variant="caption" numeric color={TONE_COLOR[tone]} testID={testID ? `${testID}.countdown` : undefined}>
            {countdown}
          </Text>
        ) : null}
        {meta ? (
          <Text variant="caption" color="text.tertiary">
            {meta}
          </Text>
        ) : null}
        {status ? (
          <Text variant="caption" color="text.tertiary" testID={testID ? `${testID}.status` : undefined}>
            {status}
          </Text>
        ) : null}
      </View>
      {onPress && !hero ? (
        <View style={styles.chevron}>
          <Icon name="caret-right" size={16} color="text.tertiary" />
        </View>
      ) : null}
    </View>
  );
  return (
    <View style={style}>
      <RowBody onPress={onPress} label={label} role="button" testID={testID}>
        {body}
      </RowBody>
      {divider ? <RowDivider inset={space[16]} lead={ROW_RING + space[12]} /> : null}
    </View>
  );
}
