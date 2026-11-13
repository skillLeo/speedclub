import { act, fireEvent, screen } from '@testing-library/react-native';

import { MotionSection } from '@/features/gallery/sections/MotionSection';
import { SECTIONS } from '@/features/gallery/data';
import { hydrateThemePreference } from '@/theme';
import { setReducedMotionPreview, useMotionPreference } from '@/ui/motion';

import { renderUi } from './helpers';

jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));

beforeAll(hydrateThemePreference);
afterEach(async () => {
  await act(async () => setReducedMotionPreview(null));
});

/** Every signature motion of 09 §4.7 has its demo on the page (SM3 links to the header page). */
const DEMOS = [
  'sm1', 'sm2', 'sm3', 'sm4.source', 'sm5', 'sm6', 'sm7.primary', 'sm8.follow', 'sm8.save', 'sm9', 'sm10', 'sm11.row1',
  'sm12', 'sm13.reveal', 'sm13.print', 'sm14', 'sm15.toggle', 'sm16', 'sm17', 'sm18.count', 'sm19', 'sm20',
];

describe('DEV-01 Bewegung', () => {
  it('is listed in the gallery', () => {
    expect(SECTIONS.map((s) => s.id)).toContain('motion');
  });

  it('demos SM1–SM20', async () => {
    await renderUi(<MotionSection />);
    expect(screen.getByTestId('DEV-01.motion.root')).toBeTruthy();
    for (const demo of DEMOS) expect(screen.getByTestId(`DEV-01.motion.${demo}`, { includeHiddenElements: true })).toBeTruthy();
  });

  it('previews reduced motion app-wide while the page is open', async () => {
    const seen: { reduced?: boolean } = {};
    function Probe() {
      seen.reduced = useMotionPreference().reduced;
      return null;
    }
    const view = await renderUi(
      <>
        <MotionSection />
        <Probe />
      </>,
    );
    expect(seen.reduced).toBe(false);
    await fireEvent(screen.getByTestId('DEV-01.motion.reduced'), 'press');
    expect(seen.reduced).toBe(true);
    await view.unmount();
    // Leaving the page hands motion back to the device.
    const after: { reduced?: boolean } = {};
    function After() {
      after.reduced = useMotionPreference().reduced;
      return null;
    }
    await renderUi(<After />);
    expect(after.reduced).toBe(false);
  });
});
