/**
 * MF-2: a reduced-motion user gets the crossfade from the first frame. The motion store starts from the launch value
 * (Reanimated's synchronous read on native), not from `false` until AccessibilityInfo answers.
 */
import { render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useMotionPreference, type Motion } from '@/ui/motion';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  // The system reported reduce motion when the app started.
  return { ...actual, __esModule: true, default: actual.default, useReducedMotion: () => true };
});

describe('reduced motion at launch (native)', () => {
  it('is already reduced on the first render, before AccessibilityInfo answers', async () => {
    const pending = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise<boolean>(() => undefined));
    const renders: Motion['preference'][] = [];
    function Probe() {
      renders.push(useMotionPreference().preference);
      return null;
    }
    await render(<Probe />);
    expect(renders[0]).toBe('reduced');
    expect(renders.every((preference) => preference === 'reduced')).toBe(true);
    pending.mockRestore();
  });
});
