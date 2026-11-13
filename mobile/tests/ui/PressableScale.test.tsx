import { fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { hydrateThemePreference } from '@/theme';
import { Button } from '@/ui/Button';
import { PressableScale, visualFills } from '@/ui/PressableScale';
import { Text } from '@/ui/Text';

import { renderUi, toneLayerOf, toneLayersIn, visualOf } from './helpers';

beforeAll(hydrateThemePreference);

describe('PressableScale', () => {
  it('passes props and calls press handlers in order', async () => {
    const calls: string[] = [];
    await renderUi(
      <PressableScale
        role="button"
        aria-label="Karte"
        testID="p"
        onPressIn={() => calls.push('in')}
        onPress={() => calls.push('press')}
        onPressOut={() => calls.push('out')}
      >
        <Text>Inhalt</Text>
      </PressableScale>,
    );
    await fireEvent(screen.getByTestId('p'), 'pressIn');
    await fireEvent(screen.getByTestId('p'), 'press');
    await fireEvent(screen.getByTestId('p'), 'pressOut');
    expect(calls).toEqual(['in', 'press', 'out']);
    expect(screen.getByRole('button', { name: 'Karte' })).toBeTruthy();
  });

  it('gives children and styles the pressed state', async () => {
    await renderUi(
      <PressableScale testID="p">{(state) => <Text>{state.pressed ? 'gedrückt' : 'ruhig'}</Text>}</PressableScale>,
    );
    expect(screen.getByText('ruhig')).toBeTruthy();
    await fireEvent(screen.getByTestId('p'), 'pressIn');
    expect(screen.getByText('gedrückt')).toBeTruthy();
    await fireEvent(screen.getByTestId('p'), 'pressOut');
    expect(screen.getByText('ruhig')).toBeTruthy();
  });

  it('native hitSlop reaches 44 from the visual height', async () => {
    await renderUi(<PressableScale testID="p" visualHeight={36} />);
    expect(screen.getByTestId('p').props.hitSlop).toEqual({ top: 4, bottom: 4, left: 0, right: 0 });
  });

  it('adds no key handler on native, also for a toggle, and passes a caller’s own one through unchanged', async () => {
    const onKeyDown = jest.fn();
    await renderUi(
      <>
        <PressableScale role="checkbox" aria-checked={false} aria-label="A" onPress={jest.fn()} testID="c" />
        <PressableScale role="switch" aria-checked={false} aria-label="B" onPress={jest.fn()} onKeyDown={onKeyDown} testID="s" />
      </>,
    );
    expect(screen.getByTestId('c').props.onKeyDown).toBeUndefined();
    expect(screen.getByTestId('s').props.onKeyDown).toBe(onKeyDown);
  });

  it('does not press when disabled', async () => {
    const onPress = jest.fn();
    await renderUi(<PressableScale testID="p" disabled onPress={onPress} />);
    await fireEvent.press(screen.getByTestId('p'));
    expect(onPress).not.toHaveBeenCalled();
  });

  // BUG-2 (VEH-01 on Android): a growing visual inside a target that hugs its content takes the whole height its parent column
  // offers in Yoga's measure pass (RN 0.88 errata StretchFlexBasis), so the visual only grows when the target's height comes from outside.
  describe('visual fill (BUG-2)', () => {
    it('fills a target that stretches or is sized from outside', () => {
      expect(visualFills(undefined)).toBe(true);
      expect(visualFills({})).toBe(true);
      expect(visualFills({ alignSelf: 'auto' })).toBe(true);
      expect(visualFills({ alignSelf: 'stretch' })).toBe(true);
      expect(visualFills({ alignSelf: 'flex-start', height: 44 })).toBe(true);
      expect(visualFills({ alignSelf: 'center', flex: 1 })).toBe(true);
      expect(visualFills({ alignSelf: 'flex-end', flexGrow: 1 })).toBe(true);
    });

    it('never grows inside a target that hugs its content', () => {
      for (const alignSelf of ['flex-start', 'center', 'flex-end', 'baseline'] as const) {
        expect(visualFills({ alignSelf })).toBe(false);
        // A minimum height still leaves the height to the content, so it does not count as sized.
        expect(visualFills({ alignSelf, minHeight: 44, maxWidth: '100%', flexShrink: 1 })).toBe(false);
      }
    });

    it('drops the grow from the visual of a hugging target and keeps it for a stretching one', async () => {
      await renderUi(
        <>
          <PressableScale testID="hug" style={{ alignSelf: 'flex-start' }} />
          <PressableScale testID="stretch" />
          <PressableScale testID="state" style={(state) => (state.pressed ? null : { alignSelf: 'center' })} />
        </>,
      );
      expect(visualOf('hug').flexGrow).toBeUndefined();
      expect(visualOf('stretch').flexGrow).toBe(1);
      expect(visualOf('state').flexGrow).toBeUndefined();
    });

    it('keeps a Button that hugs its label at its own height, and a full-width one filling its target', async () => {
      await renderUi(
        <>
          <Button label="Alle Mods (14)" variant="tertiary" size="s" onPress={jest.fn()} testID="hug" />
          <Button label="Alle Mods (14)" variant="tertiary" size="s" flush="start" onPress={jest.fn()} testID="flush" />
          <Button label="Fortfahren" fullWidth onPress={jest.fn()} testID="full" />
        </>,
      );
      expect(visualOf('hug').flexGrow).toBeUndefined();
      expect(visualOf('flush').flexGrow).toBeUndefined();
      expect(visualOf('full').flexGrow).toBe(1);
    });
  });
});

describe('press feedback (SM7, 09 §4.7)', () => {
  const { ForcedVisualStateProvider } = jest.requireActual<typeof import('@/ui/qaVisualState')>('@/ui/qaVisualState');
  const { motion, themes } = jest.requireActual<typeof import('@/theme')>('@/theme');
  const { cornersOf, toneShapeOf } = jest.requireActual<typeof import('@/ui/PressableScale')>('@/ui/PressableScale');

  it('scales the pressed visual to 0.97 and shows the state.pressed tone layer, never opacity', async () => {
    await renderUi(
      <ForcedVisualStateProvider value={{ pressed: true }}>
        <PressableScale testID="p" contentStyle={{ borderRadius: 999 }}>
          <Text>Inhalt</Text>
        </PressableScale>
      </ForcedVisualStateProvider>,
    );
    expect(motion.press.scale).toBe(0.97);
    const visual = visualOf('p');
    expect(visual.opacity).toBeUndefined();
    const tone = toneLayerOf('p');
    const toneStyle = StyleSheet.flatten(tone.props.style);
    expect(toneStyle.backgroundColor).toBe(themes.carbon.color.state.pressed);
    expect(toneStyle.borderRadius).toBe(999);
    expect(toneStyle.pointerEvents).toBe('none');
    expect(tone).toHaveAnimatedStyle({ opacity: 1 });
  });

  it('keeps the tone layer decorative: aria-hidden, and no test ID that extends the control prefix', async () => {
    await renderUi(<PressableScale testID="p" />);
    const tone = toneLayerOf('p');
    expect(tone.props['aria-hidden']).toBe(true);
    expect(tone.props.testID).toBeUndefined();
    // Flows list controls by test-ID prefix (f5-discover's chip row): the layer must never be one of them.
    expect(screen.queryAllByTestId(/^p\./)).toHaveLength(0);
  });

  it('keeps the tone layer hidden at rest', async () => {
    await renderUi(<PressableScale testID="p" />);
    expect(toneLayerOf('p')).toHaveAnimatedStyle({ opacity: 0 });
  });

  it('draws no tone layer when the component has its own pressed fill, or while feedback is off', async () => {
    await renderUi(
      <>
        <PressableScale testID="own" toneShift={false} />
        <PressableScale testID="busy" feedback={false} />
      </>,
    );
    expect(toneLayersIn('own')).toHaveLength(0);
    expect(toneLayersIn('busy')).toHaveLength(0);
  });

  it('draws state.pressedInverse on an inverse fill (ADR-421 c)', async () => {
    await renderUi(
      <ForcedVisualStateProvider value={{ pressed: true }}>
        <PressableScale testID="p" tone="inverse" />
      </ForcedVisualStateProvider>,
    );
    const tone = toneLayerOf('p');
    expect(StyleSheet.flatten(tone.props.style).backgroundColor).toBe(themes.carbon.color.state.pressedInverse);
    expect(tone).toHaveAnimatedStyle({ opacity: 1 });
  });

  it('gives every Button one tone: the press base layer, inverse on primary, none where it has its own pressed fill', async () => {
    await renderUi(
      <>
        <Button label="Speichern" variant="primary" testID="primary" />
        <Button label="Abbrechen" variant="secondary" testID="secondary" />
        <Button label="Mehr" variant="tertiary" testID="tertiary" />
        <Button label="Konto erstellen" variant="brand" testID="brand" />
        <Button label="Anmelden" variant="onPhoto" testID="photo" />
      </>,
    );
    const colour = (id: string) => StyleSheet.flatten(toneLayerOf(id).props.style).backgroundColor;
    expect(colour('primary')).toBe(themes.carbon.color.state.pressedInverse);
    expect(colour('secondary')).toBe(themes.carbon.color.state.pressed);
    expect(colour('tertiary')).toBe(themes.carbon.color.state.pressed);
    // accent.fillPressed and the photo chip ground are their own pressed fills.
    expect(toneLayersIn('brand')).toHaveLength(0);
    expect(toneLayersIn('photo')).toHaveLength(0);
  });

  it('copies only the corner radii of the visual to the tone layer', () => {
    expect(cornersOf({ borderRadius: 8, padding: 4, borderTopLeftRadius: 2 })).toEqual({ borderRadius: 8, borderTopLeftRadius: 2 });
    expect(cornersOf(undefined)).toEqual({});
  });

  it('covers the border too, so a pressed fill keeps no rim of the resting tone', () => {
    expect(toneShapeOf({ borderRadius: 8, borderWidth: 1, padding: 4 })).toEqual({ borderRadius: 8, top: -1, right: -1, bottom: -1, left: -1 });
    expect(toneShapeOf({ borderRadius: 8 })).toEqual({ borderRadius: 8 });
  });
});
