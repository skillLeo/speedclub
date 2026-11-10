import { screen } from '@testing-library/react-native';

import { hydrateThemePreference, radius, size, themes, typography } from '@/theme';
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
    expect(text.fontFamily).toBe(typography.labelS.fontFamily);
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
    expect(segment.fontFamily).toBe(typography.labelS.fontFamily);
  });
});

describe('StatusPill', () => {
  it('is 20 high, radius 4, 1 border.default, badge text.secondary', async () => {
    await renderUi(<StatusPill label="Verbaut" testID="p" />);
    const pill = flat(screen.getByTestId('p').props.style);
    expect(pill.minHeight).toBe(size.statusPill);
    expect(pill.borderRadius).toBe(radius.xs);
    expect(pill.borderColor).toBe(themes.carbon.color.border.default);
    const text = flat(screen.getByText('Verbaut').props.style);
    expect(text.fontSize).toBe(typography.badge.fontSize);
    expect(text.color).toBe(themes.carbon.color.text.secondary);
  });
});
