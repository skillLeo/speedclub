import { fireEvent, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { hydrateThemePreference, size, themes, typography } from '@/theme';
import { EmptyState } from '@/ui/EmptyState';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('EmptyState', () => {
  it('has title.s, a secondary body.dense line and one button', async () => {
    const onPress = jest.fn();
    await renderUi(<EmptyState icon="garage" title="Noch nichts hier" body="Füge etwas hinzu." action={{ label: 'Hinzufügen', onPress }} testID="e" />);
    expect(flat(screen.getByTestId('e.title').props.style).fontSize).toBe(typography.titleS.fontSize);
    const body = flat(screen.getByTestId('e.body').props.style);
    expect(body.fontSize).toBe(typography.bodyDense.fontSize);
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
    expect(screen.getByText('スピードクラブ', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('スピードクラブ')).toBeNull();
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
