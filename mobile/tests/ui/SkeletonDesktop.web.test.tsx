/**
 * DQ-064 on the web desktop: a skeleton line box equals the line box of the Text it stands for. Text takes the role's desktop
 * size from layout.breakpoints.desktop (M4.1), so SkeletonText does too unless the Text it stands for keeps its mobile size.
 */
import { screen } from '@testing-library/react-native';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { hydrateThemePreference, layout, typography, typographyDesktop } from '@/theme';
import { SkeletonText } from '@/ui/Skeleton';

import { renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

const minWidthOf = (query: string) => Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity);
Object.defineProperty(globalThis, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    media: query,
    matches: layout.breakpoints.desktop >= minWidthOf(query),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }),
});

const originalOS = Platform.OS;
beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'web';
});
afterEach(() => {
  Platform.OS = originalOS;
});

/** The heights of the line boxes of a SkeletonText. */
function lineHeights(testID: string): number[] {
  const root = screen.getByTestId(testID, { includeHiddenElements: true });
  return root.children
    .filter((child): child is typeof root => typeof child !== 'string')
    .map((line) => (StyleSheet.flatten(line.props.style as ViewStyle) ?? {}).height as number);
}

describe('SkeletonText on the web desktop', () => {
  it('takes the desktop line box of its role, as Text does (body.strong 24, not 22)', async () => {
    await renderUi(
      <View>
        <SkeletonText variant="bodyStrong" lines={2} testID="strong" />
        <SkeletonText variant="body" testID="body" />
        <SkeletonText variant="caption" testID="caption" />
      </View>,
    );
    expect(lineHeights('strong')).toEqual([typographyDesktop.bodyStrong.lineHeight, typographyDesktop.bodyStrong.lineHeight]);
    expect(lineHeights('body')).toEqual([typographyDesktop.body.lineHeight]);
    // A role without a desktop step keeps its size.
    expect(lineHeights('caption')).toEqual([typography.caption.lineHeight]);
  });

  it('keeps the mobile line box where the Text it stands for does (a card display.title, a shrunk title)', async () => {
    await renderUi(
      <View>
        <SkeletonText variant="displayTitle" desktopSize={false} testID="card" />
        <SkeletonText variant="title2" desktopSize={false} testID="shrunk" />
      </View>,
    );
    expect(lineHeights('card')).toEqual([typography.displayTitle.lineHeight]);
    expect(lineHeights('shrunk')).toEqual([typography.title2.lineHeight]);
  });
});
