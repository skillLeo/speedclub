import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

/**
 * How far content that ends at the bottom of the screen must move up for an open keyboard: the keyboard's height minus the bottom
 * safe-area inset the content already keeps (the composer pads itself by it), never negative.
 */
export function keyboardInsetPadding(keyboardHeight: number, bottomInset: number): number {
  'worklet';
  return Math.max(0, keyboardHeight - bottomInset);
}

export type KeyboardInsetViewProps = {
  /** The bottom safe-area inset the content keeps itself (useSafeInset('bottom')). */
  bottomInset: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  testID?: string;
};

/**
 * A column that ends at the bottom of the screen and keeps its last child (a composer) right above the keyboard. BUG-4: the library's
 * KeyboardAvoidingView works from the view's own frame, and on Android it measured MSG-02 relative to its parent, so the composer
 * stopped short by the height of the bar above the thread. This view needs no frame: it pads by the keyboard height itself, which
 * is right whenever the view reaches the screen's bottom edge. The padding follows the keyboard frame by frame; it is position, not
 * motion, so it stays in reduced motion. On the web the keyboard height stays 0 and the browser resizes the page instead.
 */
export function KeyboardInsetView({ bottomInset, style, children, testID }: KeyboardInsetViewProps) {
  const keyboard = useReanimatedKeyboardAnimation();
  // The keyboard height counts down from 0 while it opens.
  const padded = useAnimatedStyle(() => ({ paddingBottom: keyboardInsetPadding(-keyboard.height.get(), bottomInset) }));
  return (
    <Animated.View style={[style, padded]} testID={testID}>
      {children}
    </Animated.View>
  );
}
