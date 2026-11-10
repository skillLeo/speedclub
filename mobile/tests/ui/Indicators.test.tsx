import { screen } from '@testing-library/react-native';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';

import { hydrateThemePreference, motion, size, themes, typography } from '@/theme';
import { Avatar, initialsOf, initialsVariant } from '@/ui/Avatar';
import { Hairline } from '@/ui/Hairline';
import { Progress } from '@/ui/Progress';
import { UnreadBadge } from '@/ui/UnreadBadge';

import { flat, renderUi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { ...actual, __esModule: true, default: actual.default, useReducedMotion: jest.fn(() => false) };
});

const dimensions = useWindowDimensions as jest.Mock;
const { useReducedMotion: reducedMotion } = jest.requireMock<{ useReducedMotion: jest.Mock }>('react-native-reanimated');

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

const carbon = themes.carbon.color;

describe('UnreadBadge', () => {
  it('is an 8 dot without a count', async () => {
    await renderUi(<UnreadBadge label="Neue Benachrichtigungen" testID="b" />);
    const dot = flat(screen.getByTestId('b').props.style);
    expect(dot.width).toBe(size.unreadDot);
    expect(dot.backgroundColor).toBe(carbon.accent.fill);
    expect(screen.getByTestId('b').props['aria-label']).toBe('Neue Benachrichtigungen');
  });

  it('is an 18 pill with the count and a label from common', async () => {
    await renderUi(<UnreadBadge count={7} testID="b" />);
    expect(flat(screen.getByTestId('b').props.style).minHeight).toBe(size.unreadPill);
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByTestId('b').props['aria-label']).toBe('7 ungelesen');
  });

  it('caps at 99+, renders nothing at zero', async () => {
    await renderUi(<UnreadBadge count={120} />);
    expect(screen.getByText('99+')).toBeTruthy();
    await renderUi(<UnreadBadge count={0} testID="zero" />);
    expect(screen.queryByTestId('zero')).toBeNull();
  });
});

describe('Progress', () => {
  it('bar is 2 high with aria values', async () => {
    await renderUi(<Progress value={0.4} label="Upload" testID="p" />);
    const bar = screen.getByRole('progressbar', { name: 'Upload' });
    expect(flat(bar.props.style).height).toBe(size.progress.height);
    expect(bar.props['aria-valuenow']).toBe(40);
  });

  it('clamps the value', async () => {
    await renderUi(<Progress value={1.7} label="Upload" />);
    expect(screen.getByRole('progressbar', { name: 'Upload' }).props['aria-valuenow']).toBe(100);
  });

  it('wizard has 4 segments with a gap of 4 and marks the done ones', async () => {
    await renderUi(<Progress variant="wizard" step={2} label="Schritt 2 von 4" testID="p" />);
    const root = screen.getByTestId('p');
    expect(flat(root.props.style).gap).toBe(size.progress.segmentGap);
    expect(root.props['aria-valuenow']).toBe(2);
    expect(root.props['aria-valuemax']).toBe(4);
    const segments = root.children.filter((child) => typeof child !== 'string');
    expect(segments).toHaveLength(4);
    const colour = (i: number) => {
      const segment = segments[i];
      return flat(segment && typeof segment !== 'string' ? segment.props.style : undefined).backgroundColor;
    };
    expect(colour(1)).toBe(carbon.text.primary);
    expect(colour(2)).toBe(carbon.border.default);
  });

  it('ring is exposed as a progressbar', async () => {
    await renderUi(<Progress variant="ring" value={0.25} label="Foto 1" testID="p" />);
    expect(screen.getByTestId('p').props['aria-valuenow']).toBe(25);
  });
});

describe('Avatar', () => {
  it('finds initials', () => {
    expect(initialsOf('Lukas Schneider', 2)).toBe('LS');
    expect(initialsOf('@lukas.sc', 2)).toBe('LS');
    expect(initialsOf('jann', 2)).toBe('J');
    // DQ-270: digits are no initials, unless the name has nothing else.
    expect(initialsOf('@lena.911', 2)).toBe('L');
    expect(initialsOf('kenji.r34', 2)).toBe('KR');
    expect(initialsOf('911', 2)).toBe('9');
    expect(initialsOf('Özge Yıldız', 1)).toBe('Ö');
  });

  it.each([24, 32, 40, 56, 96] as const)('size %s has exact dimensions', async (value) => {
    await renderUi(<Avatar name="Lukas Schneider" size={value} testID="a" />);
    const avatar = flat(screen.getByTestId('a').props.style);
    expect(avatar.width).toBe(value);
    expect(avatar.height).toBe(value);
  });

  it('falls back to initials in label, text.secondary on bg.raised', async () => {
    await renderUi(<Avatar name="Lukas Schneider" testID="a" />);
    expect(screen.getByTestId('a').props['aria-label']).toBe('Lukas Schneider');
    expect(flat(screen.getByTestId('a').props.style).backgroundColor).toBe(carbon.bg.raised);
    const text = flat(screen.getByText('LS', { includeHiddenElements: true }).props.style);
    expect(text.fontSize).toBe(typography.label.fontSize);
    expect(text.color).toBe(carbon.text.secondary);
  });

  // ADR-150: the initials take the type style of their circle (DQ-134), never the font scale (DQ-106).
  const BY_SIZE = [
    [24, 'caption'],
    [32, 'labelS'],
    [40, 'label'],
    [56, 'titleS'],
    [96, 'titleM'],
  ] as const;

  it.each(BY_SIZE)('a %s circle sets its initials in %s', (value, variant) => {
    expect(initialsVariant(value)).toBe(variant);
  });

  it('marks the initials as the fixed glyph the DOM audit accepts on avatars only', async () => {
    await renderUi(<Avatar name="Max Weber" size={96} testID="a" />);
    expect(screen.getByText('MW', { includeHiddenElements: true }).props.dataSet).toEqual({ qaExempt: 'fixed-glyph' });
  });

  for (const fontScale of [1, 2]) {
    describe(`at font scale ${fontScale} on web, where Text scales through its style`, () => {
      const originalOS = Platform.OS;
      beforeEach(() => {
        Platform.OS = 'web';
        dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale });
      });
      afterEach(() => {
        Platform.OS = originalOS;
      });

      it.each(BY_SIZE)('initials in a %s circle keep the size of %s', async (value, variant) => {
        await renderUi(<Avatar name="Max Weber" size={value} testID="a" />);
        const initials = value === size.avatar.xs ? 'M' : 'MW';
        const text = flat(screen.getByText(initials, { includeHiddenElements: true }).props.style);
        expect(text.fontSize).toBe(typography[variant].fontSize);
        expect(text.lineHeight).toBe(typography[variant].lineHeight);
        expect(text.lineHeight).toBeLessThanOrEqual(value);
      });
    });
  }

  it('shows the image when there is one', async () => {
    await renderUi(<Avatar name="Lukas" uri="https://example.test/a.webp" testID="a" />);
    expect(screen.getByTestId('a.image', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('L', { includeHiddenElements: true })).toBeNull();
  });

  it('fades the image in over 200 ms', async () => {
    await renderUi(<Avatar name="Lukas" uri="https://example.test/a.webp" testID="a" />);
    const image = screen.getByTestId('a.image', { includeHiddenElements: true });
    expect(image.props.transition).toEqual(expect.objectContaining({ duration: motion.duration.small }));
  });

  it('shows the image without a fade under reduced motion', async () => {
    reducedMotion.mockReturnValue(true);
    try {
      await renderUi(<Avatar name="Lukas" uri="https://example.test/a.webp" testID="a" />);
      expect(screen.getByTestId('a.image', { includeHiddenElements: true }).props.transition).toBeFalsy();
    } finally {
      reducedMotion.mockReturnValue(false);
    }
  });

  it('can be decorative', async () => {
    await renderUi(<Avatar name="Lukas" decorative testID="a" />);
    expect(screen.getByTestId('a', { includeHiddenElements: true }).props['aria-label']).toBeUndefined();
  });
});

describe('Hairline', () => {
  it('uses the native hairline width, border.subtle and the inset', async () => {
    await renderUi(<Hairline inset={16} testID="h" />);
    const line = flat(screen.getByTestId('h', { includeHiddenElements: true }).props.style);
    expect(line.height).toBe(StyleSheet.hairlineWidth);
    expect(line.backgroundColor).toBe(carbon.border.subtle);
    expect(line.marginLeft).toBe(16);
  });
});
