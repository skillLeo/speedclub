import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { PortalHost } from '../portal';
import { endFlight, reportProgress, useFlights, type Flight } from './flight';
import { coverCounterScale, flightAt, flightRadius, flightTransform } from './math';
import { useMotionPreference } from './preference';
import { motionDuration } from './springs';

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, pointerEvents: 'none' },
  clone: { overflow: 'hidden', position: 'absolute' },
  fill: { flex: 1 },
});

/** The layer that draws; the store is global, so a second layer would draw every clone twice and land it twice. */
let owner: symbol | null = null;
const ownerListeners = new Set<() => void>();
function setOwner(next: symbol | null): void {
  owner = next;
  for (const listener of ownerListeners) listener();
}
function subscribeOwner(listener: () => void): () => void {
  ownerListeners.add(listener);
  return () => {
    ownerListeners.delete(listener);
  };
}

/**
 * Draws the running flights (SM4, SM12) above the screen, and hosts the root portal (`PortalHost`, for pickers that must not
 * be clipped by their card). Mount it exactly once, last, in a full-window box at the app root (`src/app/_layout.tsx`). A later
 * layer renders nothing and warns in development. It measures its own window offset, so it may sit inside a padded parent.
 * Decorative: the clone is hidden from assistive technology, the real destination carries the content. Flights into or out
 * of an RN `Modal` (Sheet, Dialog, `(modals)` routes) are not supported (see `flight.ts`).
 */
export function FlightLayer({ testID = 'motion.flights' }: { testID?: string }) {
  const flights = useFlights();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [self] = useState(() => Symbol('FlightLayer'));
  const active = useSyncExternalStore(subscribeOwner, () => owner === self, () => owner === self);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const measure = () => ref.current?.measureInWindow((x, y) => setOrigin((o) => (o.x === x && o.y === y ? o : { x, y })));
  useEffect(() => {
    if (owner === null) setOwner(self);
    else if (owner !== self && __DEV__) {
      console.warn('FlightLayer: a second layer is mounted; it renders nothing. Mount one layer at the app root.');
    }
    return () => {
      if (owner === self) setOwner(null);
    };
  }, [self]);
  useEffect(() => {
    if (active && flights.length > 0) measure();
  }, [active, flights.length]);
  if (!active) return null;
  return (
    <>
      {/* The root portal (ReactionPicker): above the screens, below the flights. */}
      <PortalHost />
      <View ref={ref} aria-hidden style={styles.layer} onLayout={measure} testID={testID}>
        {flights.map((flight) => (
          <FlightClone key={flight.id} flight={flight} origin={origin} testID={`${testID}.${flight.id}`} />
        ))}
      </View>
    </>
  );
}

/** Test seam: forget the owning layer. */
export function __resetFlightLayerForTests(): void {
  setOwner(null);
}

function FlightClone({ flight, origin, testID }: { flight: Flight; origin: { x: number; y: number }; testID: string }) {
  const motion = useMotionPreference();
  const progress = useSharedValue(0);
  const start = flightTransform(flight.from, flight.to);
  const { to, radiusFrom, radiusTo, token, id, onLand } = flight;

  useEffect(() => {
    reportProgress(id, () => progress.get());
    return () => reportProgress(id, null);
  }, [id, progress]);

  useEffect(() => {
    progress.set(0);
    progress.set(motion.springTo(1, token));
    // The clone stays until the spring has settled (its CSS twin's duration), then the destination takes over.
    const timer = setTimeout(
      () => {
        onLand?.();
        endFlight(id);
      },
      motion.enabled ? motionDuration(`spring.${token}`) : 0,
    );
    return () => clearTimeout(timer);
  }, [id, onLand, progress, token, motion]);

  const clipStyle = useAnimatedStyle(() => {
    const now = flightAt(start, progress.get());
    return {
      borderRadius: flightRadius(radiusFrom, radiusTo, progress.get(), now.scaleX, now.scaleY),
      transform: [{ translateX: now.translateX }, { translateY: now.translateY }, { scaleX: now.scaleX }, { scaleY: now.scaleY }],
    };
  });
  const contentStyle = useAnimatedStyle(() => {
    const now = flightAt(start, progress.get());
    const counter = coverCounterScale(now.scaleX, now.scaleY);
    return { transform: [{ scaleX: counter.scaleX }, { scaleY: counter.scaleY }] };
  });

  return (
    <Animated.View
      style={[styles.clone, { left: to.x - origin.x, top: to.y - origin.y, width: to.width, height: to.height }, clipStyle]}
      testID={testID}
    >
      <Animated.View style={[styles.fill, contentStyle]}>{flight.render()}</Animated.View>
    </Animated.View>
  );
}
