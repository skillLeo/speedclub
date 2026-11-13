// AUTH-01 (09 §7.1, SM1; BUG-3): the overlay takes over from the native splash once, plays the brush reveal and leaves.
import { act, render, screen } from '@testing-library/react-native';

import { resetSplashOverlay, SplashOverlay, splashOverlayWanted } from '@/features/auth/SplashOverlay';
import { hydrateThemePreference, ThemeProvider } from '@/theme';
import { brushRevealDuration } from '@/ui/motion/kit';
import { __setAccessibilityForTests } from '@/ui/motion/preference';
import { motionDuration } from '@/ui/motion';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.useFakeTimers();
  resetSplashOverlay();
});
afterEach(() => {
  jest.useRealTimers();
  __setAccessibilityForTests({ reduceMotion: false });
});

const overlay = () => screen.queryByTestId('AUTH-01.root', { includeHiddenElements: true });

async function mount(ready: boolean, onCovered: jest.Mock) {
  return render(
    <ThemeProvider>
      <SplashOverlay ready={ready} onCovered={onCovered} />
    </ThemeProvider>,
  );
}

async function playThrough(reduced: boolean) {
  await act(async () => {
    jest.advanceTimersByTime(brushRevealDuration(reduced) + motionDuration('effect.default') + 1);
  });
  // The crossfade's timer starts after the reveal's: one more turn.
  await act(async () => {
    jest.advanceTimersByTime(motionDuration('effect.default') + 1);
  });
}

describe('SplashOverlay', () => {
  it('covers the window before the app is ready and hides the native splash only once it plays', async () => {
    const onCovered = jest.fn();
    const view = await mount(false, onCovered);
    expect(overlay()).toBeTruthy();
    expect(onCovered).not.toHaveBeenCalled();
    await view.rerender(
      <ThemeProvider>
        <SplashOverlay ready onCovered={onCovered} />
      </ThemeProvider>,
    );
    expect(onCovered).toHaveBeenCalled();
    expect(overlay()).toBeTruthy();
    await playThrough(false);
    expect(overlay()).toBeNull();
  });

  it('plays once per cold start: a second mount in the same run shows nothing and hides the splash at once', async () => {
    const view = await mount(true, jest.fn());
    await playThrough(false);
    await view.unmount();
    const again = jest.fn();
    await mount(true, again);
    expect(overlay()).toBeNull();
    expect(again).toHaveBeenCalled();
  });

  it('reduced motion: the crossfade path, then the same exit', async () => {
    __setAccessibilityForTests({ reduceMotion: true });
    await mount(true, jest.fn());
    expect(overlay()).toBeTruthy();
    await playThrough(true);
    expect(overlay()).toBeNull();
  });

  it('is never a spinner', async () => {
    await mount(true, jest.fn());
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('splashOverlayWanted', () => {
  const app = { hold: false, automated: false, qaSession: false, motionEnabled: true };
  it('plays on a cold start with motion, skips with motion off, and the hold always plays', () => {
    expect(splashOverlayWanted(app)).toBe(true);
    expect(splashOverlayWanted({ ...app, motionEnabled: false })).toBe(false);
    expect(splashOverlayWanted({ ...app, motionEnabled: false, hold: true })).toBe(true);
  });
});
