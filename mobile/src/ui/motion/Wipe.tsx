import { useState, type ReactNode } from 'react';
import { StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { wipeOffsets, type WipeFrom } from './math';

export type WipeProps = {
  /** 0 hides the content, 1 shows all of it. Drive it with `springTo` / `effectTo`, or a gesture. */
  progress: SharedValue<number>;
  /** `x` uncovers left → right (from `start`), `y` top → bottom. */
  axis?: 'x' | 'y';
  from?: WipeFrom;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  testID?: string;
};

const styles = StyleSheet.create({ clip: { overflow: 'hidden' } });

/**
 * A mask wipe made of transforms only (09 §4.7): the clip slides one way and its content the other, so the content stands
 * still while the window over it grows. It works the same on iOS, Android and web, without Skia or an SVG mask. Until the box
 * has a size the content stays hidden unless the wipe is complete, so nothing flashes on the first frame.
 */
export function Wipe({ progress, axis = 'x', from = 'start', style, children, testID }: WipeProps) {
  const [size, setSize] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize(axis === 'x' ? width : height);
  };
  const outerStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const { outer } = wipeOffsets(p, size, from);
    return {
      opacity: size > 0 || p >= 1 ? 1 : 0,
      transform: axis === 'x' ? [{ translateX: outer }] : [{ translateY: outer }],
    };
  });
  const innerStyle = useAnimatedStyle(() => {
    const { inner } = wipeOffsets(progress.get(), size, from);
    return { transform: axis === 'x' ? [{ translateX: inner }] : [{ translateY: inner }] };
  });
  return (
    <Animated.View style={[styles.clip, style, outerStyle]} onLayout={onLayout} testID={testID}>
      <Animated.View style={innerStyle}>{children}</Animated.View>
    </Animated.View>
  );
}

