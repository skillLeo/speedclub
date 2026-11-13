import type { ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { motion as motionTokens } from '@/theme/tokens.generated';

import { heroHeaderFade, stretchyHero } from './math';
import { useMotionPreference } from './preference';
import { TopScrim } from './TopScrim';

const STRETCH = motionTokens.signature.stretchyHero;

const styles = StyleSheet.create({
  // The scale grows from the top edge, so a pull never opens a gap above the photo.
  hero: { transformOrigin: 'top', zIndex: 0 },
  scrim: { position: 'absolute', left: 0, right: 0, top: 0 },
});

/**
 * SM5 stretchy hero, the scroll maths as a hook: `heroStyle` scales the hero (1.00 → 1.15, anchored at the top) while the
 * list is pulled down and lets it trail at 0.5× while it scrolls up; `headerFade` (0 → 1) runs as the hero's lower part
 * passes under the header, for `scrim.top` and the header's own background and title crossfade. Reduced motion: no stretch,
 * no parallax; the fade stays (it is a colour change, not motion).
 */
export function useStretchyHero(scrollY: SharedValue<number>, headerHeight: number) {
  const motion = useMotionPreference();
  const height = useSharedValue(0);
  const headerFade = useDerivedValue(() => heroHeaderFade(scrollY.get(), height.get(), headerHeight));
  const heroStyle = useAnimatedStyle(() => {
    const { scale, translateY } = stretchyHero(scrollY.get(), height.get(), STRETCH.maxScale, STRETCH.parallax, motion.reduced);
    return { transform: [{ translateY }, { scale }] };
  });
  const scrimStyle = useAnimatedStyle(() => ({ opacity: headerFade.get() }));
  const onLayout = (event: LayoutChangeEvent) => height.set(event.nativeEvent.layout.height);
  return { heroStyle, scrimStyle, headerFade, onLayout };
}

export type StretchyHeroProps = {
  /** The list's offset (`useCollapsingHeader().scrollY` or an `useAnimatedScrollHandler`). */
  scrollY: SharedValue<number>;
  /** The header that floats over the hero, safe inset included. */
  headerHeight: number;
  /** The hero itself: a full-bleed `Photo` (4:5 on phones) with its `PhotoScrim` and the title. */
  children: ReactNode;
  testID?: string;
};

/** SM5 as a component: the first item of an `Animated.ScrollView` / `CollapsingFlashList`. */
export function StretchyHero({ scrollY, headerHeight, children, testID }: StretchyHeroProps) {
  const { heroStyle, scrimStyle, onLayout } = useStretchyHero(scrollY, headerHeight);
  return (
    <View onLayout={onLayout} testID={testID}>
      <Animated.View style={[styles.hero, heroStyle]}>
        {children}
        <Animated.View style={[styles.scrim, scrimStyle]}>
          <TopScrim height={headerHeight * 2} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}
