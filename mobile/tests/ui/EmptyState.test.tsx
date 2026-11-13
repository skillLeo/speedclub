import { fireEvent, screen } from '@testing-library/react-native';
import { Dimensions, View } from 'react-native';

import { hydrateThemePreference, maxFontScale, size, themes, typography } from '@/theme';
import { EmptyState } from '@/ui/EmptyState';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

/** N4: a capped role is set at min(font scale, cap) by Text itself on native, with OS scaling off (the jest window is at 2). */
const badgeScale = () => Math.min(Dimensions.get('window').fontScale, maxFontScale.labelBadge);

describe('EmptyState', () => {
  it('has headline, a secondary body line and one button', async () => {
    const onPress = jest.fn();
    await renderUi(<EmptyState icon="garage" title="Noch nichts hier" body="Füge etwas hinzu." action={{ label: 'Hinzufügen', onPress }} testID="e" />);
    expect(flat(screen.getByTestId('e.title').props.style).fontSize).toBe(typography.headline.fontSize);
    const body = flat(screen.getByTestId('e.body').props.style);
    expect(body.fontSize).toBe(typography.body.fontSize);
    expect(body.color).toBe(themes.carbon.color.text.secondary);
    await fireEvent.press(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('centres the button under the text: the hug style of Button must not win', async () => {
    await renderUi(<EmptyState title="Leer" action={{ label: 'Hinzufügen', onPress: jest.fn() }} testID="e" />);
    expect(flat(screen.getByTestId('e.action').props.style).alignSelf).toBe('center');
  });

  it('works without a button or a body', async () => {
    await renderUi(<EmptyState title="Leer" testID="e" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('e.body')).toBeNull();
  });

  it('brand: draws the glyph in the 120 katakana frame, hidden from screen readers', async () => {
    await renderUi(<EmptyState variant="brand" icon="wheel" title="Füge dein erstes Auto hinzu" testID="e" />);
    const frame = flat(screen.getByTestId('e.frame', { includeHiddenElements: true }).props.style);
    expect(frame.width).toBe(size.emptyIllustrationMax);
    expect(frame.height).toBe(size.emptyIllustrationMax);
    const mark = screen.getByText('スピードクラブ', { includeHiddenElements: true });
    expect(screen.queryByText('スピードクラブ')).toBeNull();
    // DQ-807: a token pair at every scale, label.badge, whose role carries the 1.3 cap (no component workaround).
    const markStyle = flat(mark.props.style);
    expect(markStyle.fontSize).toBeCloseTo(typography.labelBadge.fontSize * badgeScale());
    // The line box the frame's rules assume (lineHeight × min(font scale, 1.3)), on Android too (N4).
    expect(markStyle.lineHeight).toBeCloseTo(typography.labelBadge.lineHeight * badgeScale());
    expect(mark.props.allowFontScaling).toBe(false);
    expect(mark.props.maxFontSizeMultiplier).toBe(maxFontScale.labelBadge);
  });

  it('default: no frame', async () => {
    await renderUi(<EmptyState icon="wheel" title="Leer" testID="e" />);
    expect(screen.queryByTestId('e.frame', { includeHiddenElements: true })).toBeNull();
  });

  it('shows an illustration', async () => {
    await renderUi(<EmptyState illustration={<View testID="art" />} title="Leer" />);
    expect(screen.getByTestId('art')).toBeTruthy();
  });
});
