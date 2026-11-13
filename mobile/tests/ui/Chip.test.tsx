import { fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { Dimensions } from 'react-native';

import { hydrateThemePreference, maxFontScale, radius, size, themes, typography } from '@/theme';
import { Chip } from '@/ui/Chip';

import { flat, renderUi, toneLayerOf, toneLayersIn, visualOf } from './helpers';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

beforeAll(hydrateThemePreference);

/** N4: a capped role is set at min(font scale, cap) by Text itself on native, with OS scaling off (the jest window is at 2). */
const badgeScale = () => Math.min(Dimensions.get('window').fontScale, maxFontScale.labelBadge);

const carbon = themes.carbon.color;

describe('Chip', () => {
  it('removable: the border is inside the 36, and the hit area still reaches 44', async () => {
    await renderUi(<Chip label="BMW" onPress={jest.fn()} onRemove={jest.fn()} testID="c" />);
    const shell = flat(screen.getByTestId('c').props.style);
    const inner = visualOf('c.body');
    expect((inner.minHeight as number) + (shell.borderWidth as number) * 2).toBe(size.chip);
    expect(shell.minHeight).toBe(size.chip);
    const slop = screen.getByTestId('c.body').props.hitSlop.top as number;
    expect((inner.minHeight as number) + slop * 2).toBe(size.touchMin);
  });

  it('has the chip metrics and a 44 native hit area', async () => {
    await renderUi(<Chip label="BMW" testID="c" />);
    expect(visualOf('c').minHeight).toBe(size.chip);
    expect(visualOf('c').borderRadius).toBe(radius.full);
    expect(visualOf('c').borderColor).toBe(carbon.border.default);
    // 09 §5: the pill is 32, so 6 above and below reach the 44 target.
    expect(screen.getByTestId('c').props.hitSlop.top).toBe(6);
  });

  it('a plain chip is a button', async () => {
    const onPress = jest.fn();
    await renderUi(<Chip label="Alle" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Alle' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('a selected chip is inverse, checked, and gives a selection haptic', async () => {
    const onPress = jest.fn();
    await renderUi(<Chip label="M4" selected onPress={onPress} testID="c" />);
    const chip = screen.getByRole('checkbox', { name: 'M4' });
    expect(chip.props.accessibilityState.checked).toBe(true);
    expect(visualOf('c').backgroundColor).toBe(carbon.bg.inverse);
    expect(flat(screen.getByText('M4').props.style).color).toBe(carbon.text.inverse);
    await fireEvent.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('removable: separate remove target with its own name', async () => {
    const onRemove = jest.fn();
    await renderUi(<Chip label="19″" onRemove={onRemove} testID="c" />);
    await fireEvent.press(screen.getByRole('button', { name: '19″: Entfernen' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('SM7: the pressed tone is state.pressed, state.pressedInverse on the inverted selected fill (ADR-421 c)', async () => {
    const { ForcedVisualStateProvider } = jest.requireActual<typeof import('@/ui/qaVisualState')>('@/ui/qaVisualState');
    await renderUi(
      <ForcedVisualStateProvider value={{ pressed: true }}>
        <Chip label="BMW" onPress={jest.fn()} selected={false} testID="off" />
        <Chip label="Audi" onPress={jest.fn()} selected testID="on" />
        <Chip label="Porsche" onPress={jest.fn()} selected onRemove={jest.fn()} testID="rm" />
      </ForcedVisualStateProvider>,
    );
    const tone = (id: string) => flat(toneLayerOf(id).props.style);
    expect(tone('off').backgroundColor).toBe(carbon.state.pressed);
    expect(tone('on').backgroundColor).toBe(carbon.state.pressedInverse);
    // The fill itself never changes on press: the tone layer is the only pressed colour, so it cannot double.
    expect(visualOf('off').backgroundColor).toBeUndefined();
    expect(visualOf('on').backgroundColor).toBe(carbon.bg.inverse);
    // Removable: one layer on the pill, with its full radius, over its border; the two targets draw none.
    const shell = flat(screen.getByTestId('rm').props.style);
    expect(tone('rm').backgroundColor).toBe(carbon.state.pressedInverse);
    expect(tone('rm').borderRadius).toBe(radius.full);
    expect(tone('rm').top).toBe(-(shell.borderWidth as number));
    expect(toneLayersIn('rm.body')).toHaveLength(0);
    expect(toneLayersIn('rm.remove')).toHaveLength(0);
  });

  it('shows the count', async () => {
    await renderUi(<Chip label="Filter" count={3} />);
    const count = screen.getByText('3');
    // DQ-806: label.badge in its 18 pill, capped by its role, with tabular figures.
    expect(flat(count.props.style).fontSize).toBeCloseTo(typography.labelBadge.fontSize * badgeScale());
    expect(count.props.allowFontScaling).toBe(false);
    expect((flat(count.props.style) as { fontVariant?: string[] }).fontVariant).toEqual(['tabular-nums']);
    expect(count.props.maxFontSizeMultiplier).toBe(maxFontScale.labelBadge);
    expect(screen.getByRole('button', { name: 'Filter 3' })).toBeTruthy();
  });

  it('disabled does not press', async () => {
    const onPress = jest.fn();
    await renderUi(<Chip label="Audi" disabled onPress={onPress} testID="c" />);
    await fireEvent.press(screen.getByTestId('c'));
    expect(onPress).not.toHaveBeenCalled();
  });
  it('takes an accessible name that starts with its visible label (WCAG 2.5.3), plain and removable', async () => {
    await renderUi(<Chip label="Filter" count={2} accessibilityLabel="Filter, 2 aktiv" onPress={jest.fn()} testID="c" />);
    expect(screen.getByLabelText('Filter, 2 aktiv')).toBeTruthy();
    await renderUi(<Chip label="BMW" onPress={jest.fn()} onRemove={jest.fn()} accessibilityLabel="BMW, 12 Builds" testID="r" />);
    expect(screen.getByLabelText('BMW, 12 Builds')).toBeTruthy();
    await renderUi(<Chip label="Audi" count={3} onPress={jest.fn()} testID="d" />);
    expect(screen.getByLabelText('Audi 3')).toBeTruthy();
  });
});
