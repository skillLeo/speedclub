import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { createStyles, resolveColor, size, useMotion, useTheme } from '@/theme';

type Common = {
  /** Accessible name, for example "Foto wird hochgeladen" or "Schritt 2 von 4". */
  label: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export type ProgressProps =
  | (Common & { variant?: 'bar'; /** 0 to 1. */ value: number })
  | (Common & { variant: 'wizard'; /** 1-based current step. */ step: number; /** Defaults to 4. */ total?: number })
  | (Common & { variant: 'ring'; /** 0 to 1. */ value: number; /** On a photo tile. */ onPhoto?: boolean });

const DEFAULT_STEPS = 4;
const PERCENT = 100;

const useStyles = createStyles((t) => ({
  track: {
    alignSelf: 'stretch',
    backgroundColor: t.color.border.default,
    height: t.size.progress.height,
    overflow: 'hidden',
  },
  fill: { backgroundColor: t.color.text.primary, transformOrigin: 'left' },
  segments: { alignSelf: 'stretch', flexDirection: 'row', gap: t.size.progress.segmentGap },
  segment: { backgroundColor: t.color.border.default, flex: 1, height: t.size.progress.height },
  segmentDone: { backgroundColor: t.color.text.primary },
}));

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** §8 progress: 2 high; wizard = 4 segments with 4 gap; upload = ring 20 on the tile. */
export function Progress(props: ProgressProps) {
  if (props.variant === 'wizard') return <Wizard {...props} />;
  if (props.variant === 'ring') return <Ring {...props} />;
  return <Bar {...props} />;
}

function Bar({ value, label, style, testID }: Common & { value: number }) {
  const styles = useStyles();
  const motion = useMotion();
  const clamped = clamp01(value);
  const progress = useSharedValue(clamped);

  useEffect(() => {
    progress.set(motion.timingTo(clamped));
  }, [clamped, motion, progress]);

  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }));

  return (
    <View
      accessible
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={PERCENT}
      aria-valuenow={Math.round(clamped * PERCENT)}
      testID={testID}
      style={[styles.track, style]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.fill, fill]} />
    </View>
  );
}

function Wizard({ step, total = DEFAULT_STEPS, label, style, testID }: Common & { step: number; total?: number }) {
  const styles = useStyles();
  return (
    <View
      accessible
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(total, Math.max(0, step))}
      testID={testID}
      style={[styles.segments, style]}
    >
      {Array.from({ length: total }, (_, index) => (
        <View key={index} style={[styles.segment, index < step ? styles.segmentDone : null]} />
      ))}
    </View>
  );
}

function Ring({ value, onPhoto = false, label, style, testID }: Common & { value: number; onPhoto?: boolean }) {
  const theme = useTheme();
  const clamped = clamp01(value);
  const box = size.progress.ring;
  const stroke = size.progress.height;
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = box / 2;
  return (
    <View
      accessible
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={PERCENT}
      aria-valuenow={Math.round(clamped * PERCENT)}
      testID={testID}
      style={style}
    >
      <Svg width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={resolveColor(theme, onPhoto ? 'onPhoto.border' : 'border.default')}
          strokeWidth={stroke}
        />
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={resolveColor(theme, onPhoto ? 'onPhoto.primary' : 'text.primary')}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={[circumference, circumference]}
          strokeDashoffset={circumference * (1 - clamped)}
          rotation={-90}
          originX={centre}
          originY={centre}
        />
      </Svg>
    </View>
  );
}
