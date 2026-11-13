import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';

import { motion } from '@/theme';
import {
  __resetSubscriptionForTests,
  __setAccessibilityForTests,
  cssTransition,
  effectTo,
  motionDuration,
  motionPreferenceFor,
  springTo,
  useMotionPreference,
  useReduceTransparency,
  type Motion,
} from '@/ui/motion';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { ...actual, __esModule: true, default: actual.default, withSpring: jest.fn((to: number) => to) };
});

const { withSpring } = jest.requireMock<{ withSpring: jest.Mock }>('react-native-reanimated');

const configOf = () => withSpring.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => withSpring.mockClear());
afterEach(() => __setAccessibilityForTests({ reduceMotion: false, reduceTransparency: false }));

describe('springTo / effectTo (09 §4.7)', () => {
  it('springs from the token with mass 1, which the installed Reanimated would otherwise default to 4', () => {
    springTo(1, 'fast');
    expect(withSpring).toHaveBeenLastCalledWith(1, { stiffness: 800, damping: 34, mass: 1, reduceMotion: ReduceMotion.Never }, undefined);
    for (const token of ['fast', 'default', 'slow', 'calm'] as const) {
      springTo(0, token);
      expect(configOf()).toMatchObject({ ...motion.spring[token], mass: 1 });
    }
  });

  it('turns every spatial spring into the effect.default crossfade under reduced motion', () => {
    springTo(1, 'slow', 'reduced');
    expect(configOf()).toMatchObject({ stiffness: 1600, damping: 80, mass: 1, reduceMotion: ReduceMotion.Never });
  });

  it('jumps when motion is off (qaMotion=off)', () => {
    springTo(1, 'default', 'off');
    expect(configOf().reduceMotion).toBe(ReduceMotion.Always);
    effectTo(1, 'fast', 'off');
    expect(configOf().reduceMotion).toBe(ReduceMotion.Always);
  });

  it('keeps effects critically damped and the same under reduced motion', () => {
    for (const token of ['fast', 'default', 'slow'] as const) {
      effectTo(1, token, 'reduced');
      const { stiffness, damping, mass } = motion.effect[token];
      expect(configOf()).toMatchObject({ stiffness, damping, mass });
      // ζ = damping / (2 √(stiffness · mass)) ≈ 1: no overshoot on opacity or colour.
      expect(damping / (2 * Math.sqrt(stiffness * mass))).toBeCloseTo(1, 1);
    }
  });

  it('are worklets, so gestures and animated styles can call them on the UI thread', () => {
    const hash = (fn: unknown) => (fn as { __workletHash?: number }).__workletHash;
    expect(hash(springTo)).toEqual(expect.any(Number));
    expect(hash(effectTo)).toEqual(expect.any(Number));
  });

  it('gives timers and CSS the token durations', () => {
    expect(motionDuration('effect.default')).toBe(200);
    expect(motionDuration('spring.default')).toBe(500);
    expect(cssTransition('opacity', 'effect.fast')).toBe('opacity 150ms cubic-bezier(0.31,0.94,0.34,1)');
  });
});

describe('useMotionPreference', () => {
  async function probe() {
    const seen: { current: Motion | null } = { current: null };
    function Probe() {
      seen.current = useMotionPreference();
      return null;
    }
    await render(<Probe />);
    return seen;
  }

  it('maps the device setting and the QA override to a preference', () => {
    expect(motionPreferenceFor(false, undefined)).toBe('full');
    expect(motionPreferenceFor(true, undefined)).toBe('reduced');
    expect(motionPreferenceFor(false, 'off')).toBe('off');
    expect(motionPreferenceFor(true, 'off')).toBe('off');
  });

  it('listens to reduceMotionChanged, so the setting applies live: one app-wide subscription, made on the first use', async () => {
    // Earlier tests already made the subscription; the seam forgets it, so this first use has to make it again.
    __resetSubscriptionForTests();
    const add = jest.spyOn(AccessibilityInfo, 'addEventListener');
    try {
      await probe();
      await probe();
      const events = add.mock.calls.map(([event]) => event);
      expect(events.filter((event) => event === 'reduceMotionChanged')).toHaveLength(1);
    } finally {
      add.mockRestore();
    }
  });

  it('switches to reduced motion while mounted, and back', async () => {
    const seen = await probe();
    expect(seen.current?.preference).toBe('full');
    expect(seen.current?.reduced).toBe(false);
    await act(async () => __setAccessibilityForTests({ reduceMotion: true }));
    expect(seen.current?.preference).toBe('reduced');
    expect(seen.current?.reduced).toBe(true);
    expect(seen.current?.enabled).toBe(true);
    await act(async () => __setAccessibilityForTests({ reduceMotion: false }));
    expect(seen.current?.preference).toBe('full');
  });

  it('keeps one object per preference, so effects can depend on it', async () => {
    const first = (await probe()).current;
    const second = (await probe()).current;
    expect(first).toBe(second);
  });

  it('binds the preference into springTo: reduced turns a spring into the crossfade', async () => {
    __setAccessibilityForTests({ reduceMotion: true });
    const seen = await probe();
    seen.current?.springTo(1, 'fast');
    expect(configOf()).toMatchObject({ stiffness: 1600, damping: 80 });
  });

  it('reports reduce transparency for the chrome material', async () => {
    const seen: { current: boolean | null } = { current: null };
    function Probe() {
      seen.current = useReduceTransparency();
      return null;
    }
    await render(<Probe />);
    expect(seen.current).toBe(false);
    await act(async () => __setAccessibilityForTests({ reduceTransparency: true }));
    expect(seen.current).toBe(true);
  });
});
