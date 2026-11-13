import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { ThemeScope } from '@/theme';
import { themes, type ThemeName } from '@/theme/tokens.generated';

import { coveringRadius } from './math';
import { useMotionPreference } from './preference';
import { motionDuration } from './springs';

const styles = StyleSheet.create({
  root: { overflow: 'hidden' },
  layer: { pointerEvents: 'none', position: 'absolute' },
  veil: { ...StyleSheet.absoluteFill, pointerEvents: 'none' },
});

type Phase = { from: ThemeName; to: ThemeName; key: number } | null;

export type CircularRevealProps = {
  /** The theme the content should show. A change runs the reveal. */
  theme: ThemeName;
  /** Where the new theme starts, in this box's coordinates (the centre of the tapped swatch). Default: the centre. */
  origin?: { x: number; y: number };
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * SM14 theme circular reveal (SET-10), the fallback without Skia and react-native-view-shot (not installed): a disc in the new
 * theme's canvas colour grows from the tapped swatch until it covers the box (effect.slow), the content switches theme beneath
 * it and the disc fades away (effect.fast), so the new theme spreads from the finger and the content crossfades in. Transform
 * and opacity only, the same on iOS, Android and web. Reduced motion (and the documented fallback): the old canvas colour
 * covers the switch and fades out (effect.default), a plain crossfade. `qaMotion=off`: the theme switches at once.
 *
 * The app-wide version wraps the ThemeProvider's own crossfade overlay (theme/ThemeProvider.tsx) and needs the swatch origin
 * from SET-10 (M4.10).
 */
export function CircularReveal({ theme, origin, children, style, testID }: CircularRevealProps) {
  const motion = useMotionPreference();
  const [applied, setApplied] = useState(theme);
  const [phase, setPhase] = useState<Phase>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [runs, setRuns] = useState(0);

  // The theme the last render saw: a change of the prop starts a reveal (state from props, no effect).
  const [seen, setSeen] = useState(theme);
  if (seen !== theme) {
    setSeen(theme);
    if (!motion.enabled || box.width === 0) {
      setApplied(theme);
    } else {
      setRuns((n) => n + 1);
      setPhase({ from: applied, to: theme, key: runs + 1 });
      // Reduced motion: the veil in the old colour covers the switch and fades from the next frame on.
      if (motion.reduced) setApplied(theme);
    }
  }

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox((b) => (b.width === width && b.height === height ? b : { width, height }));
  };
  const centre = origin ?? { x: box.width / 2, y: box.height / 2 };

  return (
    <View style={[styles.root, style]} onLayout={onLayout} testID={testID}>
      <ThemeScope name={applied}>{children}</ThemeScope>
      {phase ? (
        motion.reduced ? (
          <Veil key={phase.key} colour={themes[phase.from].color.bg.canvas} onDone={() => setPhase(null)} />
        ) : (
          <Disc
            key={phase.key}
            colour={themes[phase.to].color.bg.canvas}
            origin={centre}
            radius={coveringRadius(centre, box.width, box.height)}
            onCovered={() => setApplied(phase.to)}
            onDone={() => setPhase(null)}
            testID={testID ? `${testID}.disc` : undefined}
          />
        )
      ) : null}
    </View>
  );
}

function Disc({
  colour,
  origin,
  radius,
  onCovered,
  onDone,
  testID,
}: {
  colour: string;
  origin: { x: number; y: number };
  radius: number;
  onCovered: () => void;
  onDone: () => void;
  testID?: string;
}) {
  const motion = useMotionPreference();
  const grow = useSharedValue(0);
  const fade = useSharedValue(1);
  useEffect(() => {
    grow.set(motion.effectTo(1, 'slow'));
    const covered = setTimeout(() => {
      onCovered();
      fade.set(motion.effectTo(0, 'fast'));
    }, motionDuration('effect.slow'));
    const done = setTimeout(onDone, motionDuration('effect.slow') + motionDuration('effect.fast'));
    return () => {
      clearTimeout(covered);
      clearTimeout(done);
    };
    // One run per disc: the callbacks of the first render are the ones that count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ scale: grow.get() }] }));
  return (
    <Animated.View
      aria-hidden
      style={[
        styles.layer,
        { backgroundColor: colour, borderRadius: radius, height: radius * 2, left: origin.x - radius, top: origin.y - radius, width: radius * 2 },
        style,
      ]}
      testID={testID}
    />
  );
}

function Veil({ colour, onDone }: { colour: string; onDone: () => void }) {
  const motion = useMotionPreference();
  const cover = useSharedValue(1);
  useEffect(() => {
    cover.set(motion.effectTo(0, 'default'));
    const timer = setTimeout(onDone, motionDuration('effect.default'));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: cover.get() }));
  return <Animated.View aria-hidden style={[styles.veil, { backgroundColor: colour }, style]} />;
}
