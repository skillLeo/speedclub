/**
 * A native start. This file has its own module registry, so the preference is still unhydrated here,
 * which is why the file holds this one case. theme.test.tsx covers everything after hydration.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen } from '@testing-library/react-native';
import * as SystemUI from 'expo-system-ui';
import { StyleSheet } from 'react-native';

import { hydrateThemePreference, ThemeProvider, themes, useTheme, type ThemeName } from '@/theme';

const seen: ThemeName[] = [];

function Probe() {
  seen.push(useTheme().name);
  return null;
}

it('renders the stored theme first, with no crossfade from the default', async () => {
  await AsyncStorage.setItem('sc.theme', 'light');
  await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(seen).toEqual([]);
  expect(SystemUI.setBackgroundColorAsync).not.toHaveBeenCalled();

  await act(async () => {
    await hydrateThemePreference();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  expect(new Set(seen)).toEqual(new Set(['light']));
  // The overlay is ready in the stored theme's canvas too: from a default colour, the first change of theme would fade out of a theme
  // this member never saw.
  const overlay = screen.getByTestId('theme.overlay', { includeHiddenElements: true });
  expect(overlay).toHaveAnimatedStyle({ opacity: 0, backgroundColor: themes.light.color.bg.canvas });
  // The first frame behind the content is the stored canvas as well, not only the window behind it.
  expect(StyleSheet.flatten(overlay.parent?.props.style)).toMatchObject({ backgroundColor: themes.light.color.bg.canvas });
  expect(SystemUI.setBackgroundColorAsync).toHaveBeenCalledTimes(1);
  expect(SystemUI.setBackgroundColorAsync).toHaveBeenCalledWith(themes.light.color.bg.canvas);
});
