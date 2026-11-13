import { fireEvent, screen } from '@testing-library/react-native';
import { ReduceMotion } from 'react-native-reanimated';

import { hydrateThemePreference, motion } from '@/theme';
import { Chip } from '@/ui/Chip';
import { PressableScale } from '@/ui/PressableScale';

import { renderUi, toneLayerOf, toneLayersIn } from './helpers';

// Each animation lands on its target at once and leaves its config behind, so the test reads which token moved what.
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { ...actual, __esModule: true, default: actual.default, withSpring: jest.fn((to: number) => to) };
});

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

const { withSpring } = jest.requireMock<{ withSpring: jest.Mock }>('react-native-reanimated');

type SpringCall = [number, { stiffness: number; damping: number; mass: number; reduceMotion: ReduceMotion }];
const calls = () => withSpring.mock.calls as SpringCall[];
const withToken = (token: { stiffness: number; damping: number }) =>
  calls().filter(([, config]) => config.stiffness === token.stiffness && config.damping === token.damping);

beforeAll(hydrateThemePreference);
beforeEach(() => withSpring.mockClear());

describe('SM7 tone (ADR-421 c)', () => {
  it('fades the tone on effect.fast, apart from the scale on the press spring', async () => {
    await renderUi(<PressableScale testID="p" />);
    const tone = toneLayerOf('p');
    expect(tone).toHaveAnimatedStyle({ opacity: 0 });

    await fireEvent(screen.getByTestId('p'), 'pressIn');
    // The scale rides spring.fast (ζ 0.6); the colour has its own value on effect.fast, critically damped, so it never overshoots.
    expect(withToken(motion.spring.fast).map(([to]) => to)).toEqual([1]);
    expect(withToken(motion.effect.fast).map(([to]) => to)).toEqual([1]);
    const { stiffness, damping, mass } = motion.effect.fast;
    expect(damping / (2 * Math.sqrt(stiffness * mass))).toBeCloseTo(1, 1);
    expect(tone).toHaveAnimatedStyle({ opacity: 1 });

    withSpring.mockClear();
    await fireEvent(screen.getByTestId('p'), 'pressOut');
    expect(withToken(motion.effect.fast).map(([to]) => to)).toEqual([0]);
    expect(tone).toHaveAnimatedStyle({ opacity: 0 });
  });

  it('leaves the tone alone while feedback is off', async () => {
    await renderUi(<PressableScale testID="p" feedback={false} />);
    await fireEvent(screen.getByTestId('p'), 'pressIn');
    expect(withToken(motion.effect.fast)).toEqual([]);
  });

  it('draws the tone of a removable chip on its pill, for the body and for the ×', async () => {
    await renderUi(<Chip label="BMW" onPress={jest.fn()} onRemove={jest.fn()} testID="c" />);
    expect(toneLayersIn('c.body')).toHaveLength(0);
    expect(toneLayersIn('c.remove')).toHaveLength(0);
    const tone = toneLayerOf('c');
    expect(tone).toHaveAnimatedStyle({ opacity: 0 });
    for (const part of ['c.body', 'c.remove']) {
      await fireEvent(screen.getByTestId(part), 'pressIn');
      expect(tone).toHaveAnimatedStyle({ opacity: 1 });
      await fireEvent(screen.getByTestId(part), 'pressOut');
      expect(tone).toHaveAnimatedStyle({ opacity: 0 });
    }
  });
});
