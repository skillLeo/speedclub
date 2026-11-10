/**
 * DQ-613: an ADM-34 preview frame shows `previewTheme` (carbon, black or light) for that tab only, and only with a preview token. It is
 * never stored, never synced, and a brand default or the account's theme does not replace it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { readPreviewTheme } from '@/api/preview';

type PreviewModule = typeof import('@/api/preview');
type PreferenceModule = typeof import('@/theme/preference');

const TOKEN = 'eyJzIjoxLCJlIjoxfQ.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

/** A fresh start of the theme preference, with this tab's preview token and theme. */
function start(token: string | null, theme: 'carbon' | 'black' | 'light' | null): PreferenceModule {
  let preference: PreferenceModule | undefined;
  jest.isolateModules(() => {
    jest.requireActual<PreviewModule>('@/api/preview').setPreviewTokenForTests(token, theme);
    preference = jest.requireActual<PreferenceModule>('@/theme/preference');
  });
  return preference as PreferenceModule;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('reading previewTheme', () => {
  it('takes one of the three themes, only next to a well-formed token', () => {
    expect(readPreviewTheme(`?preview=${TOKEN}&previewTheme=light`)).toBe('light');
    expect(readPreviewTheme(`?previewTheme=black&preview=${TOKEN}`)).toBe('black');
    expect(readPreviewTheme('?previewTheme=light')).toBeNull();
    expect(readPreviewTheme('?preview=short&previewTheme=light')).toBeNull();
    expect(readPreviewTheme(`?preview=${TOKEN}&previewTheme=system`)).toBeNull();
    expect(readPreviewTheme(`?preview=${TOKEN}&previewTheme=pink`)).toBeNull();
    expect(readPreviewTheme(`?preview=${TOKEN}&previewTheme=light&previewTheme=black`)).toBeNull();
  });
});

describe('the preference in a preview frame', () => {
  it('starts in the frame theme, over a stored one, and keeps it against the brand default', async () => {
    await AsyncStorage.setItem('sc.theme', 'black');
    const preference = start(TOKEN, 'light');
    await preference.hydrateThemePreference();
    expect(preference.getThemePreference()).toBe('light');
    expect(preference.fixedThemePreference()).toBe('light');
    preference.setDefaultThemePreference('carbon');
    expect(preference.getThemePreference()).toBe('light');
  });

  it('never stores a theme chosen in a preview tab', async () => {
    const preference = start(TOKEN, 'light');
    preference.setThemePreference('black');
    await Promise.resolve();
    expect(preference.getThemePreference()).toBe('black');
    expect(await AsyncStorage.getItem('sc.theme')).toBeNull();
    // A preview tab without a frame theme stores nothing either: its storage is the staff member's own.
    const plain = start(TOKEN, null);
    plain.setThemePreference('light');
    await Promise.resolve();
    expect(await AsyncStorage.getItem('sc.theme')).toBeNull();
  });

  it('has no fixed theme outside a preview tab, and stores a choice as before', async () => {
    const preference = start(null, 'light');
    expect(preference.fixedThemePreference()).toBeUndefined();
    preference.setThemePreference('black');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await AsyncStorage.getItem('sc.theme')).toBe('black');
  });
});
