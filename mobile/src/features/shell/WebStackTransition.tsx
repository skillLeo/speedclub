import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { isAppReady } from '@/lib/ready';
import { space, useMotion } from '@/theme';

const styles = StyleSheet.create({ fill: { flex: 1 } });

type StackState = { routes: readonly { key: string }[] };

type Navigation = {
  getState: () => StackState;
  addListener: (event: 'focus' | 'blur', listener: () => void) => () => void;
};

type Props = { routeKey: string; navigation: Navigation; children: ReactNode };

/**
 * §10: on web a stack only flips display, so push and pop get their 260 ms here: fade + translate 12, or a 120 ms
 * crossfade under reduced motion. It plays on a screen that was pushed and on one revealed by a pop. It stays still
 * for a tab root on first visit and for a tab coming back, because §10 wants tab switches instant.
 */
function WebStackTransition({ routeKey, navigation, children }: Props) {
  const motion = useMotion();
  const pushed = isAppReady() && (navigation.getState().routes.at(0)?.key ?? routeKey) !== routeKey;
  const shift = motion.reduced ? 0 : space[12];
  const opacity = useSharedValue(pushed && motion.enabled ? 0 : 1);
  const translate = useSharedValue(pushed && motion.enabled ? shift : 0);
  const coveredByPush = useRef(false);

  useEffect(() => {
    if (!motion.enabled) return undefined;
    const play = (from: number) => {
      opacity.set(0);
      translate.set(from);
      opacity.set(motion.timingTo(1, 'medium', 'decelerate'));
      translate.set(motion.timingTo(0, 'medium', 'decelerate'));
    };
    if (pushed) play(shift);
    const unsubscribeBlur = navigation.addListener('blur', () => {
      coveredByPush.current = navigation.getState().routes.at(-1)?.key !== routeKey;
    });
    const unsubscribeFocus = navigation.addListener('focus', () => {
      if (coveredByPush.current) play(-shift);
      coveredByPush.current = false;
    });
    return () => {
      unsubscribeBlur();
      unsubscribeFocus();
    };
    // Reads `pushed` only for the first frame of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion, navigation, routeKey]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateX: translate.get() }],
  }));

  return <Animated.View style={[styles.fill, animated]}>{children}</Animated.View>;
}

/** Pass as `screenLayout` of a Stack, on web only. */
export function webStackScreenLayout({
  route,
  navigation,
  children,
}: {
  route: { key: string };
  navigation: unknown;
  children: ReactElement;
}): ReactElement {
  return (
    <WebStackTransition routeKey={route.key} navigation={navigation as Navigation}>
      {children}
    </WebStackTransition>
  );
}
