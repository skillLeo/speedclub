/** MF-2 on the member web: the motion store starts from the media queries, read synchronously at load. */
import { render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type * as MotionModule from '@/ui/motion';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));

const matching = new Set(['(prefers-reduced-motion: reduce)', '(prefers-reduced-transparency: reduce)']);
Object.defineProperty(globalThis, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ matches: matching.has(query), media: query, addEventListener: jest.fn(), removeEventListener: jest.fn() }),
});
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise<boolean>(() => undefined));

// Loaded after matchMedia exists, as in a browser, where it always does.
const { useMotionPreference, useReduceTransparency } = jest.requireActual<typeof MotionModule>('@/ui/motion');

describe('reduced motion and transparency at launch (web)', () => {
  it('reports both on the first render', async () => {
    const renders: { preference: string; transparency: boolean }[] = [];
    function Probe() {
      renders.push({ preference: useMotionPreference().preference, transparency: useReduceTransparency() });
      return null;
    }
    await render(<Probe />);
    expect(renders[0]).toEqual({ preference: 'reduced', transparency: true });
  });
});
