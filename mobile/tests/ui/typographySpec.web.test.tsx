/**
 * A12 (M4.1 fix round 8): "Desk- / top" in the DEV-01 typography specimen at 393, 200 % (WebKit). The spec line above each
 * sample is a data label: it never hyphenates (and so takes no pretty wrapping either), and none of its unbreakable runs
 * ("SemiExpanded 600", "Desktop 44/48") is wider than the narrowest gallery column at 200 %, so it only ever wraps at a space.
 */
import { screen } from '@testing-library/react-native';
import { Platform, StyleSheet, type TextStyle } from 'react-native';

import { noteParts } from '@/features/gallery/parts';
import { SAMPLES, specOf, TypographySection } from '@/features/gallery/sections/TypographySection';
import { hydrateThemePreference, layout, typography } from '@/theme';
import { typeStyle } from '@/ui/Text';

import { renderUi } from './helpers';
import { interFace } from './interMetrics';

jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

const originalOS = Platform.OS;
beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'web';
});
afterEach(() => {
  Platform.OS = originalOS;
});

/** The narrowest gallery column: 360 between the phone gutters. */
const NARROWEST_COLUMN = 360 - 2 * layout.gutter.phone;

describe('DEV-01 typography spec lines (A12)', () => {
  it('sets every spec line without hyphenation and without pretty wrapping', async () => {
    await renderUi(<TypographySection />);
    for (const { variant } of SAMPLES) {
      const style = StyleSheet.flatten(screen.getByTestId(`DEV-01.typography.${variant}.spec`).props.style) as TextStyle & Record<string, unknown>;
      expect(style.hyphens).toBe('none');
      expect(style.textWrapStyle).toBeUndefined();
    }
  });

  it('keeps every unbreakable run of a spec line narrower than the narrowest column at 200 %', () => {
    const fontSize = typeStyle('caption', 2, 'web').fontSize ?? 0;
    const face = interFace(typography.caption.fontFamily);
    for (const { variant, name } of SAMPLES) {
      const shown = noteParts(`${name} · ${specOf(variant)}`)
        .map((part) => part.text)
        .join('');
      for (const run of shown.split(/[ ​]+/)) {
        expect([run, face.width(run, fontSize) <= NARROWEST_COLUMN]).toEqual([run, true]);
      }
    }
  });
});
