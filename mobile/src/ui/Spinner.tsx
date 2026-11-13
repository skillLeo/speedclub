import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { resolveColor, size as sizeTokens, useTheme, type ColorToken } from '@/theme';

import { spinLoop, useMotionPreference } from './motion';

export type SpinnerProps = {
  size?: 16 | 20 | 24;
  /** Token path; use the colour of the label it replaces. */
  color?: ColorToken;
  /** Accessible name; defaults to the common "loading" string. */
  label?: string;
  /** True inside a control that already announces `aria-busy`. */
  decorative?: boolean;
  testID?: string;
};

const ARC_SHARE = 0.72;
const FULL_TURN = 360;
const stroke = sizeTokens.progress.height;

const styles = StyleSheet.create({ still: { alignSelf: 'center' } });

/**
 * Own arc rather than ActivityIndicator: same drawing on iOS, Android and web. It stands still under reduced
 * motion and `qaMotion=off`, so screenshots are stable.
 */
export function Spinner({ size = 20, color = 'text.primary', label, decorative = false, testID }: SpinnerProps) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const motion = useMotionPreference();
  const turning = motion.enabled && !motion.reduced;
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (!turning) return undefined;
    rotation.set(spinLoop(FULL_TURN));
    return () => cancelAnimation(rotation);
  }, [rotation, turning]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.get()}deg` }] }));

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ accessible: true, role: 'progressbar', 'aria-label': label ?? t('states.loading'), 'aria-busy': true } as const);

  return (
    <Animated.View {...a11y} testID={testID} style={[styles.still, animatedStyle]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={resolveColor(theme, color)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={[circumference * ARC_SHARE, circumference * (1 - ARC_SHARE)]}
        />
      </Svg>
    </Animated.View>
  );
}
