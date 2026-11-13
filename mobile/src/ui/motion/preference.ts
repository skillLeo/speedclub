import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
// Reanimated 4.7's `useReducedMotion` is no hook: it returns a module constant, read synchronously when Reanimated loads
// (native: `global._REANIMATED_IS_REDUCED_MOTION`, set by the native module; src/hook/useReducedMotion.ts). Imported under a
// plain name because it is read once at module scope below, never inside a component.
import { useReducedMotion as reducedMotionAtLaunch } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { qa } from '@/lib/qa';
import { getStored, removeStored, setStored } from '@/lib/storage';
import type { EffectToken, SpringToken } from '@/theme/tokens.generated';

import { effectTo, springTo, type MotionPreference } from './springs';

/**
 * The device's reduce-motion and reduce-transparency settings, live. One subscription for the whole app: react-native-web keys
 * its `reduceMotionChanged` handlers by the handler's string form, so a second listener there would replace the first.
 *
 * Native: AccessibilityInfo (`reduceMotionChanged`; `reduceTransparencyChanged` exists on iOS only, Android answers false).
 * Web: react-native-web maps reduce motion to `prefers-reduced-motion`; reduce transparency reads
 * `prefers-reduced-transparency` where the browser has it.
 */
type AccessibilitySnapshot = { readonly reduceMotion: boolean; readonly reduceTransparency: boolean };

function mediaMatches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/**
 * MF-2: the settings as they are at launch, read synchronously, so an animation that starts on mount already uses the
 * reduced-motion crossfade. The async reads in `start()` and the listeners then keep it live.
 * Native: Reanimated's launch value for reduce motion. Reduce transparency has no synchronous source there, so it starts false
 * until AccessibilityInfo answers; that only changes the chrome material, nothing moves. Web: the media queries themselves.
 */
export function launchAccessibility(): AccessibilitySnapshot {
  if (isWeb) {
    return {
      reduceMotion: mediaMatches('(prefers-reduced-motion: reduce)'),
      reduceTransparency: mediaMatches('(prefers-reduced-transparency: reduce)'),
    };
  }
  return { reduceMotion: reducedMotionAtLaunch(), reduceTransparency: false };
}

let snapshot: AccessibilitySnapshot = launchAccessibility();
let started = false;
const listeners = new Set<() => void>();
/** DEV-01's reduced-motion preview (M4.3): wins over the device setting while it is set. Never set in product code. */
let preview: boolean | null = null;
/** SET-10 "Bewegung reduzieren: Immer" (M4.10): reduces motion on top of the system setting, never turns it off. */
let always = false;
/** What the hooks read: the device settings with the preview applied, one object per change. */
let effective: AccessibilitySnapshot = snapshot;

function publish(): void {
  const next = preview === null ? { ...snapshot, reduceMotion: snapshot.reduceMotion || always } : { ...snapshot, reduceMotion: preview };
  if (next.reduceMotion === effective.reduceMotion && next.reduceTransparency === effective.reduceTransparency) return;
  effective = next;
  for (const listener of listeners) listener();
}

function update(next: Partial<AccessibilitySnapshot>): void {
  const merged = { ...snapshot, ...next };
  if (merged.reduceMotion === snapshot.reduceMotion && merged.reduceTransparency === snapshot.reduceTransparency) return;
  snapshot = merged;
  publish();
}

/**
 * Previews reduced motion app-wide (true / false) or returns to the device setting (null): the switch on DEV-01 "Bewegung",
 * so every signature motion can be checked in both variants without the system settings. Development gallery only.
 */
export function setReducedMotionPreview(value: boolean | null): void {
  preview = value;
  publish();
}

export type ReduceMotionChoice = 'system' | 'always';

const choiceListeners = new Set<() => void>();

/**
 * SET-10 "Bewegung reduzieren" (09 §7.9): System follows the device; Immer reduces motion in this app whatever the device says.
 * Stored on this device (`sc.reduceMotion`), applied at once to every spring.
 */
export function setReduceMotionChoice(choice: ReduceMotionChoice, persist = true): void {
  const next = choice === 'always';
  if (next !== always) {
    always = next;
    publish();
    for (const listener of choiceListeners) listener();
  }
  if (!persist) return;
  if (next) void setStored('sc.reduceMotion', 'always');
  else void removeStored('sc.reduceMotion');
}

export function getReduceMotionChoice(): ReduceMotionChoice {
  return always ? 'always' : 'system';
}

/** Reads the stored choice once at start. Never rejects. */
export async function hydrateReduceMotionChoice(): Promise<void> {
  if ((await getStored('sc.reduceMotion')) === 'always') setReduceMotionChoice('always', false);
}

function subscribeChoice(listener: () => void): () => void {
  choiceListeners.add(listener);
  return () => choiceListeners.delete(listener);
}

/** The SET-10 choice, live. */
export function useReduceMotionChoice(): ReduceMotionChoice {
  return useSyncExternalStore(subscribeChoice, getReduceMotionChoice, getReduceMotionChoice);
}

function webTransparencyQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-reduced-transparency: reduce)');
}

function start(): void {
  if (started) return;
  started = true;
  void hydrateReduceMotionChoice();
  AccessibilityInfo.isReduceMotionEnabled()
    .then((reduceMotion) => update({ reduceMotion }))
    .catch(() => undefined);
  AccessibilityInfo.addEventListener('reduceMotionChanged', (reduceMotion: boolean) => update({ reduceMotion }));
  if (isWeb) {
    const query = webTransparencyQuery();
    if (query) {
      update({ reduceTransparency: query.matches });
      query.addEventListener?.('change', (event) => update({ reduceTransparency: event.matches }));
    }
    return;
  }
  AccessibilityInfo.isReduceTransparencyEnabled()
    .then((reduceTransparency) => update({ reduceTransparency }))
    .catch(() => undefined);
  AccessibilityInfo.addEventListener('reduceTransparencyChanged', (reduceTransparency: boolean) =>
    update({ reduceTransparency }),
  );
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => effective;

/** Test seam: the settings as if the device had just reported them. */
export function __setAccessibilityForTests(next: Partial<AccessibilitySnapshot>): void {
  update(next);
}

/** Test seam: forget the app-wide subscription, so a test can watch the next first use make it. Listeners stay. */
export function __resetSubscriptionForTests(): void {
  started = false;
}

/** Reduce transparency (iOS setting, web media query): chrome turns opaque (09 §4.4). */
export function useReduceTransparency(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).reduceTransparency;
}

export type Motion = {
  readonly preference: MotionPreference;
  /** False when transitions are skipped altogether (`qaMotion=off`). */
  readonly enabled: boolean;
  /** True under reduced motion and when motion is off: parallax, Ken Burns, odometer rolls and stagger stay still. */
  readonly reduced: boolean;
  /**
   * A spatial spring; under reduced motion the effect.default crossfade. A worklet. `onDone` runs on the UI thread when it
   * settles or is interrupted (`finished` false), for state that must hold until the motion ends.
   */
  readonly springTo: (value: number, token: SpringToken, onDone?: (finished?: boolean) => void) => number;
  /** An opacity or colour effect. A worklet. */
  readonly effectTo: (value: number, token: EffectToken) => number;
};

function build(preference: MotionPreference): Motion {
  return {
    preference,
    enabled: preference !== 'off',
    reduced: preference !== 'full',
    springTo: (value: number, token: SpringToken, onDone?: (finished?: boolean) => void) => {
      'worklet';
      return springTo(value, token, preference, onDone);
    },
    effectTo: (value: number, token: EffectToken) => {
      'worklet';
      return effectTo(value, token, preference);
    },
  };
}

// One object per preference, so effects and callbacks that depend on it keep their identity.
const MOTION: Readonly<Record<MotionPreference, Motion>> = {
  full: build('full'),
  reduced: build('reduced'),
  off: build('off'),
};

/** The preference for given device and QA settings; `qaMotion=off` wins over everything. */
export function motionPreferenceFor(reduceMotion: boolean, qaMotion: 'off' | undefined = qa.motion): MotionPreference {
  if (qaMotion === 'off') return 'off';
  return reduceMotion ? 'reduced' : 'full';
}

/**
 * Motion for the current device, live: turning reduce motion on in the system settings switches every spring to the
 * effect.default crossfade without a restart (09 §4.7).
 */
export function useMotionPreference(): Motion {
  const { reduceMotion } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return MOTION[motionPreferenceFor(reduceMotion)];
}
