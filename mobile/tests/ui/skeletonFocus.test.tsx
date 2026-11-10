/** Code review M2.8 nit 4: the shimmer, the product's one loop, pauses on a screen that is not on show. */
import { act, renderHook } from '@testing-library/react-native';
import { IsFocusedContext } from 'expo-router/build/react-navigation/core/useIsFocused';
import { useState, type ReactNode } from 'react';
import { withRepeat } from 'react-native-reanimated';

import { hydrateThemePreference } from '@/theme';
import { Skeleton, SKELETON_DELAY_MS, SkeletonBlock } from '@/ui/Skeleton';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { renderUi } from './helpers';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { __esModule: true, ...actual, default: actual.default, withRepeat: jest.fn((...args: Parameters<typeof actual.withRepeat>) => actual.withRepeat(...args)) };
});

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(withRepeat).mockClear();
});
afterEach(() => jest.useRealTimers());

const focusedAs = (value: boolean | undefined) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <IsFocusedContext value={value}>{children}</IsFocusedContext>;
  };

it('reads the route focus, and counts as shown outside any route', async () => {
  expect((await renderHook(() => useScreenFocused())).result.current).toBe(true);
  expect((await renderHook(() => useScreenFocused(), { wrapper: focusedAs(false) })).result.current).toBe(false);
  expect((await renderHook(() => useScreenFocused(), { wrapper: focusedAs(true) })).result.current).toBe(true);
});

it('a skeleton in a screen left behind does not start its loop; shown again, it does', async () => {
  let show: (focused: boolean) => void = () => undefined;
  function Host() {
    const [focused, setFocused] = useState(false);
    show = setFocused;
    return (
      <IsFocusedContext value={focused}>
        <Skeleton testID="sk">
          <SkeletonBlock height={20} />
        </Skeleton>
      </IsFocusedContext>
    );
  }
  await renderUi(<Host />);
  await act(async () => jest.advanceTimersByTime(SKELETON_DELAY_MS));
  expect(withRepeat).not.toHaveBeenCalled();
  await act(async () => show(true));
  expect(withRepeat).toHaveBeenCalled();
});
