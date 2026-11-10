import { act, fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { hydrateThemePreference, size, themes, typography } from '@/theme';
import { Button } from '@/ui/Button';

import { flat, renderUi, visualOf } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

const carbon = themes.carbon.color;

describe('Button', () => {
  it('hugs its label but may not outgrow its parent', async () => {
    await renderUi(<Button label="Dialog mit langem Text" testID="b" />);
    const style = flat(screen.getByTestId('b').props.style);
    expect(style.alignSelf).toBe('flex-start');
    expect(style.flexShrink).toBe(1);
    expect(style.maxWidth).toBe('100%');
    expect(flat(screen.getByText('Dialog mit langem Text').props.style).flexShrink).toBe(1);
  });

  it('full width has no such limit to apply', async () => {
    await renderUi(<Button label="Weiter" fullWidth testID="b" />);
    expect(flat(screen.getByTestId('b').props.style).alignSelf).toBe('stretch');
  });

  it('as a link it takes the role and href, and hands on the press event, which Link asChild needs on web', async () => {
    const onPress = jest.fn();
    await renderUi(<Button label="Zur Startseite" role="link" href="/" onPress={onPress} testID="b" />);
    expect(screen.getByRole('link', { name: 'Zur Startseite' }).props.href).toBe('/');
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ isDefaultPrevented: expect.any(Function) }));
  });

  it.each([
    ['l', size.button.l, size.buttonPaddingX.l],
    ['m', size.button.m, size.buttonPaddingX.m],
    ['s', size.button.s, size.buttonPaddingX.s],
  ] as const)('size %s has the exact height, and its label sits the §8 padding inside the box (DQ-065)', async (name, height, padding) => {
    for (const variant of ['primary', 'brand', 'secondary', 'tertiary', 'destructive', 'onPhoto', 'onPhotoText'] as const) {
      await renderUi(<Button label="Weiter" size={name} variant={variant} testID="b" />);
      const style = visualOf('b');
      expect(style.minHeight).toBe(height);
      expect((style.paddingHorizontal as number) + (style.borderWidth as number)).toBe(padding);
      expect(style.borderRadius).toBe(8);
    }
  });

  it('tells the DOM audit that its padding compensates the border', async () => {
    await renderUi(<Button label="Weiter" testID="b" />);
    const box = screen.getByTestId('b').children.filter((child) => typeof child !== 'string').at(-1);
    expect(typeof box === 'string' ? undefined : box?.props.dataSet).toEqual({ qaExempt: 'hairline' });
  });

  describe('an icon beside a label that wraps (DQ-066)', () => {
    const rowOf = (label: string) => flat(screen.getByText(label).parent?.props.style);
    const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 200, height } } });

    it('stays beside a label on one line, and goes above it once the label has two', async () => {
      await renderUi(<Button label="Fahrzeug hinzufügen" icon="plus" fullWidth />);
      expect(rowOf('Fahrzeug hinzufügen').flexDirection).toBe('row');
      await fireEvent(screen.getByText('Fahrzeug hinzufügen'), 'layout', layout(typography.label.lineHeight));
      expect(rowOf('Fahrzeug hinzufügen').flexDirection).toBe('row');
      await fireEvent(screen.getByText('Fahrzeug hinzufügen'), 'layout', layout(typography.label.lineHeight * 2));
      expect(rowOf('Fahrzeug hinzufügen').flexDirection).toBe('column');
    });

    it('stays above when the wider line then fits the label, and may go back once the window changes', async () => {
      let rerender = () => {};
      function Host() {
        const [, setTick] = useState(0);
        rerender = () => setTick((tick) => tick + 1);
        return <Button label="Fahrzeug hinzufügen" icon="plus" fullWidth />;
      }
      await renderUi(<Host />);
      await fireEvent(screen.getByText('Fahrzeug hinzufügen'), 'layout', layout(typography.label.lineHeight * 2));
      await fireEvent(screen.getByText('Fahrzeug hinzufügen'), 'layout', layout(typography.label.lineHeight));
      expect(rowOf('Fahrzeug hinzufügen').flexDirection).toBe('column');
      dimensions.mockReturnValue({ width: 430, height: 844, scale: 1, fontScale: 1 });
      await act(async () => rerender());
      expect(rowOf('Fahrzeug hinzufügen').flexDirection).toBe('row');
    });

    it('measures against the line of the font scale, so a large font on one line is no wrap', async () => {
      dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
      await renderUi(<Button label="Teilen" icon="share-network" />);
      await fireEvent(screen.getByText('Teilen'), 'layout', layout(typography.label.lineHeight * 2));
      expect(rowOf('Teilen').flexDirection).toBe('row');
      await fireEvent(screen.getByText('Teilen'), 'layout', layout(typography.label.lineHeight * 4));
      expect(rowOf('Teilen').flexDirection).toBe('column');
    });

    it('never moves without an icon or beside a flush label, which starts next to its icon', async () => {
      await renderUi(<Button label="Ohne Symbol" fullWidth />);
      await fireEvent(screen.getByText('Ohne Symbol'), 'layout', layout(typography.label.lineHeight * 2));
      expect(rowOf('Ohne Symbol').flexDirection).toBe('row');
      await renderUi(<Button label="Bündig" icon="trash" flush="start" variant="tertiary" />);
      await fireEvent(screen.getByText('Bündig'), 'layout', layout(typography.label.lineHeight * 2));
      expect(rowOf('Bündig').flexDirection).toBe('row');
    });
  });

  it.each(['primary', 'brand', 'secondary', 'tertiary', 'destructive', 'onPhoto'] as const)(
    'S stays 36 as %s: line, padding and border fit inside the minimum height',
    async (variant) => {
      await renderUi(<Button label="Weiter" size="s" variant={variant} testID="b" />);
      const style = visualOf('b');
      const border = (style.borderWidth ?? 0) * 2;
      expect(typography.labelS.lineHeight + (style.paddingVertical as number) * 2 + border).toBeLessThanOrEqual(size.button.s);
      expect(style.minHeight).toBe(size.button.s);
    },
  );

  it.each([1, 1.5, 2])('every variant has the same box at font scale %s, so buttons side by side stay level', async (fontScale) => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale });
    const variants = ['primary', 'brand', 'secondary', 'tertiary', 'destructive', 'onPhoto', 'onPhotoText'] as const;
    const boxes = [];
    for (const variant of variants) {
      for (const disabled of [false, true]) {
        await renderUi(<Button label="Nachricht" variant={variant} size="m" disabled={disabled} testID="b" />);
        const { borderWidth, minHeight, paddingVertical } = visualOf('b');
        boxes.push({ borderWidth, minHeight, paddingVertical });
      }
    }
    await renderUi(<Button label="Löschen" variant="destructive" filled size="m" testID="b" />);
    const { borderWidth, minHeight, paddingVertical } = visualOf('b');
    boxes.push({ borderWidth, minHeight, paddingVertical });
    for (const box of boxes) {
      expect(box).toEqual({ borderWidth: size.border.control, minHeight: size.button.m, paddingVertical: boxes[0]?.paddingVertical });
    }
  });

  it('keeps the border of a filled or text-only variant invisible', async () => {
    await renderUi(<Button label="A" variant="primary" testID="a" />);
    expect(visualOf('a').borderColor).toBe('transparent');
    await renderUi(<Button label="B" variant="tertiary" testID="b" />);
    expect(visualOf('b').borderColor).toBe('transparent');
  });

  it('uses label for L, label.s for S', async () => {
    await renderUi(<Button label="Groß" />);
    expect(flat(screen.getByText('Groß').props.style).fontSize).toBe(typography.label.fontSize);
    await renderUi(<Button label="Klein" size="s" />);
    expect(flat(screen.getByText('Klein').props.style).fontSize).toBe(typography.labelS.fontSize);
  });

  it.each([
    ['primary', false, carbon.bg.inverse, carbon.text.inverse],
    ['brand', false, carbon.accent.fill, carbon.text.onAccent],
    ['secondary', false, carbon.bg.raised, carbon.text.primary],
    ['tertiary', false, undefined, carbon.text.primary],
    ['destructive', false, undefined, carbon.accent.fg],
    ['destructive', true, carbon.accent.fill, carbon.text.onAccent],
    ['onPhoto', false, undefined, carbon.onPhoto.primary],
    ['onPhotoText', false, undefined, carbon.onPhoto.primary],
  ] as const)('variant %s (filled %s) has its colours', async (variant, filled, background, text) => {
    await renderUi(<Button label="Aktion" variant={variant} filled={filled} testID="b" />);
    expect(visualOf('b').backgroundColor).toBe(background);
    expect(flat(screen.getByText('Aktion').props.style).color).toBe(text);
  });

  it('outlines secondary and onPhoto', async () => {
    await renderUi(<Button label="A" variant="secondary" testID="a" />);
    expect(visualOf('a').borderColor).toBe(carbon.border.default);
    expect(visualOf('a').borderWidth).toBe(1);
    await renderUi(<Button label="B" variant="onPhoto" testID="b" />);
    expect(visualOf('b').borderColor).toBe(carbon.onPhoto.border);
  });

  it('exposes role and label and presses', async () => {
    const onPress = jest.fn();
    await renderUi(<Button label="Speichern" onPress={onPress} testID="b" />);
    const button = screen.getByRole('button', { name: 'Speichern' });
    expect(button.props.accessibilityState.busy).toBe(false);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('accepts a more specific accessible name', async () => {
    await renderUi(<Button label="Folgen" accessibilityLabel="@lukas.sc folgen" />);
    expect(screen.getByRole('button', { name: '@lukas.sc folgen' })).toBeTruthy();
  });

  it('disabled: no press, text.disabled on bg.raised', async () => {
    const onPress = jest.fn();
    await renderUi(<Button label="Senden" disabled onPress={onPress} testID="b" />);
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
    expect(visualOf('b').backgroundColor).toBe(carbon.bg.raised);
    expect(flat(screen.getByText('Senden').props.style).color).toBe(carbon.text.disabled);
  });

  it('loading: busy, ignores presses, label stays in layout to lock the width', async () => {
    const onPress = jest.fn();
    await renderUi(<Button label="Speichern" loading onPress={onPress} testID="b" />);
    const button = screen.getByTestId('b');
    expect(button.props.accessibilityState.busy).toBe(true);
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(flat(screen.getByText('Speichern').parent?.props.style).opacity).toBe(0);
  });

  it('passes testID and renders a leading icon', async () => {
    await renderUi(<Button label="Teilen" icon="share-network" testID="AUTH-02.share" />);
    expect(screen.getByTestId('AUTH-02.share')).toBeTruthy();
    expect(screen.getByText('Teilen')).toBeTruthy();
  });
});
