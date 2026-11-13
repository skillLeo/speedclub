import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { motion as motionTokens, type SpringToken } from '@/theme/tokens.generated';

import {
  beginFlight,
  flightRectNow,
  handlesOf,
  hasPending,
  measureRect,
  registerSource,
  registerTarget,
  startFlight,
  takePending,
  unregisterSource,
  unregisterTarget,
  type FlightHandle,
} from './flight';
import { motionDuration } from './springs';
import { useMotionPreference, type Motion } from './preference';

/**
 * SM4 card → detail continuity (HeroExpand) and the shared engine of SM12 (message send). Android and web, and iOS while the
 * flag `ios.apple_zoom` is off (09 §0.5): the source is measured, a clone flies to the destination rect on spring.default
 * (translate + scale, radius 12 → 0) through the `FlightLayer`, the destination shows itself when the clone lands. Back runs
 * the same flight in reverse (`collapseFlight`). Reduced motion: no flight, the destination crossfades in (effect.default).
 *
 *   <FlightSource id={`hero.${id}`} ref={...}>  — wraps the card photo; call `expandFrom(id, render)` before navigating
 *   <FlightTarget id={`hero.${id}`}>            — wraps the destination hero; it takes the pending flight on layout
 *
 * The target measures where it lands. A destination route that slides in measures mid-slide, so flight destinations either
 * use the stack animation 'none' or 'fade', or pass `settled={false}` until the navigation transition has ended
 * (`navigation.addListener('transitionEnd', …)`) and true afterwards. Not into or out of an RN Modal (see `flight.ts`).
 */
export type FlightOptions = {
  token?: SpringToken;
  radiusFrom?: number;
  radiusTo?: number;
  /** The node to measure as the start, instead of the registered source of the id (the card the member actually pressed). */
  source?: Pick<ComponentRef<typeof View>, 'measureInWindow'> | null;
};

const HERO = motionTokens.signature.heroExpand;

/** Hides a view without removing it from layout or from assistive technology (the clone is aria-hidden). */
function useVisibility(initial: boolean) {
  const opacity = useSharedValue(initial ? 1 : 0);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return { opacity, style };
}

type HostProps = { id: string; style?: StyleProp<ViewStyle>; children: ReactNode; testID?: string };

/** The view a flight leaves from (a card photo, the composer's text). */
export function FlightSource({ id, style, children, testID }: HostProps) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const { opacity, style: visibility } = useVisibility(true);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const handle: FlightHandle = { node, setVisible: (visible) => opacity.set(visible ? 1 : 0) };
    registerSource(id, handle);
    return () => unregisterSource(id, handle);
  }, [id, opacity]);
  return (
    <Animated.View ref={ref} collapsable={false} style={[style, visibility]} testID={testID}>
      {children}
    </Animated.View>
  );
}

/**
 * Measures the registered source of `id` and hands the flight to the target that mounts next. Resolves false when the source
 * is not laid out (the target then simply appears).
 */
export async function expandFrom(id: string, render: () => ReactNode, options: FlightOptions = {}): Promise<boolean> {
  const { source } = handlesOf(id);
  const from = await measureRect(options.source ?? source?.node);
  if (!from) return false;
  beginFlight(id, from, render, options.token ?? 'default', options.radiusFrom ?? HERO.radiusFrom, options.radiusTo ?? HERO.radiusTo, source);
  return true;
}

/** The view a flight lands on (the destination hero, the new bubble). Hidden while a clone flies to it. */
export function FlightTarget({ id, settled = true, style, children, testID }: HostProps & { settled?: boolean }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const motion = useMotionPreference();
  // A target that mounts with a flight pending starts hidden; anything else is simply there.
  const [waiting] = useState(() => hasPending(id));
  const { opacity, style: visibility } = useVisibility(!waiting || !motion.enabled);
  const laidOut = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const handle: FlightHandle = {
      node,
      setVisible: (visible) => opacity.set(visible ? 1 : 0),
      fadeOut: () => opacity.set(motion.effectTo(0, 'fast')),
    };
    registerTarget(id, handle);
    return () => unregisterTarget(id, handle);
  }, [id, motion, opacity]);

  const land = () => {
    const flight = takePending(id);
    if (!flight) return;
    if (!motion.enabled) {
      opacity.set(1);
      return;
    }
    if (motion.reduced) {
      opacity.set(motion.effectTo(1, 'default'));
      return;
    }
    const source = handlesOf(id).source;
    void measureRect(ref.current).then((to) => {
      if (!to) {
        opacity.set(1);
        return;
      }
      source?.setVisible(false);
      startFlight({
        id,
        from: flight.from,
        to,
        render: flight.render,
        token: flight.token,
        radiusFrom: flight.radiusFrom,
        radiusTo: flight.radiusTo,
        onLand: () => {
          // The clone sits exactly over the target: the swap is invisible.
          opacity.set(1);
          source?.setVisible(true);
        },
      });
    });
  };

  // A destination that slides in lands once its transition has ended (`settled`), measured where it rests.
  useEffect(() => {
    if (settled && laidOut.current) land();
    // `land` reads the latest values; it only needs to run when the route settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  const onLayout = () => {
    laidOut.current = true;
    if (settled) land();
  };

  return (
    <Animated.View ref={ref} collapsable={false} onLayout={onLayout} style={[style, visibility]} testID={testID}>
      {children}
    </Animated.View>
  );
}

/**
 * Back: the clone flies from the target to the source, then `onDone` (pop the screen, close the panel). Reduced motion or a
 * source that is gone: the target fades out on effect.fast, then `onDone`.
 */
export async function collapseFlight(id: string, render: () => ReactNode, motion: Motion, onDone: () => void, options: FlightOptions = {}): Promise<void> {
  const { source, target } = handlesOf(id);
  // Back while the expand still flies: the reverse starts where the clone is now, not at the target.
  const midAir = flightRectNow(id);
  const [measured, to] = await Promise.all([midAir ? Promise.resolve(midAir) : measureRect(target?.node), measureRect(source?.node)]);
  const from = measured;
  if (!motion.enabled) {
    onDone();
    return;
  }
  if (motion.reduced || !from || !to) {
    // ADR-405: the reduced way back is a fade (effect.fast), then the pop.
    if (target?.fadeOut) target.fadeOut();
    else target?.setVisible(false);
    setTimeout(onDone, motionDuration('effect.fast'));
    return;
  }
  target?.setVisible(false);
  source?.setVisible(false);
  startFlight({
    id,
    from,
    to,
    render,
    token: options.token ?? 'default',
    // The way back ends in the card's corners.
    radiusFrom: options.radiusTo ?? HERO.radiusTo,
    radiusTo: options.radiusFrom ?? HERO.radiusFrom,
    onLand: () => {
      source?.setVisible(true);
      onDone();
    },
  });
}
