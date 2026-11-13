import { screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { hydrateThemePreference, maxFontScale, radius, size, themes, typography } from '@/theme';
import { SpecChip } from '@/ui/SpecChip';
import { StatusPill } from '@/ui/StatusPill';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('SpecChip', () => {
  it('is 24 high, radius 4, bg.raised, caption at 600, tabular', async () => {
    await renderUi(<SpecChip label="500 PS" testID="c" />);
    const chip = flat(screen.getByTestId('c').props.style);
    expect(chip.minHeight).toBe(size.specChip);
    expect(chip.borderRadius).toBe(radius.xs);
    expect(chip.backgroundColor).toBe(themes.carbon.color.bg.raised);
    const text = flat(screen.getByText('500 PS').props.style) as ReturnType<typeof flat> & {
      fontFamily?: string;
      fontVariant?: string[];
    };
    expect(text.fontSize).toBe(typography.caption.fontSize);
    expect(text.fontFamily).toBe(typography.callout.fontFamily);
    expect(text.fontVariant).toEqual(['tabular-nums']);
  });

  it.each(['6-Gang manuell', 'AWD', '2,6 l R6 Biturbo'])('keeps "%s" proportional, tnum is for numbers', async (label) => {
    await renderUi(<SpecChip label={label} />);
    const text = flat(screen.getByText(label).props.style) as ReturnType<typeof flat> & { fontVariant?: string[] };
    expect(text.fontVariant).toBeUndefined();
  });

  it('splits at the middle dot and keeps the semi-bold family on the numeric segment', async () => {
    await renderUi(<SpecChip label="6-Gang · 500 PS" />);
    const segment = flat(screen.getByText('500 PS').props.style) as ReturnType<typeof flat> & {
      fontFamily?: string;
      fontVariant?: string[];
    };
    expect(segment.fontVariant).toEqual(['tabular-nums']);
    expect(segment.fontFamily).toBe(typography.callout.fontFamily);
  });
});

describe('StatusPill', () => {
  it('is 20 high, radius 4, 1 border.default, label.badge text.secondary', async () => {
    await renderUi(<StatusPill label="Verbaut" testID="p" />);
    const pill = flat(screen.getByTestId('p').props.style);
    expect(pill.minHeight).toBe(size.statusPill);
    expect(pill.borderRadius).toBe(radius.xs);
    expect(pill.borderColor).toBe(themes.carbon.color.border.default);
    const label = screen.getByText('Verbaut');
    const text = flat(label.props.style) as ReturnType<typeof flat> & { fontFamily?: string };
    // N4: set at min(font scale, 1.3) by Text itself, line box included (the jest window is at 2).
    const scale = Math.min(Dimensions.get('window').fontScale, maxFontScale.labelBadge);
    expect(text.fontSize).toBeCloseTo(typography.labelBadge.fontSize * scale);
    expect(text.lineHeight).toBeCloseTo(typography.labelBadge.lineHeight * scale);
    expect(label.props.allowFontScaling).toBe(false);
    expect(text.fontFamily).toBe(typography.labelBadge.fontFamily);
    expect(text.color).toBe(themes.carbon.color.text.secondary);
    // DQ-806: the role carries the cap, so the label never doubles inside its 20-high shape at 200 %.
    expect(label.props.maxFontSizeMultiplier).toBe(maxFontScale.labelBadge);
  });
});
