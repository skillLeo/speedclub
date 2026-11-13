import { act, fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { hydrateThemePreference, size, space } from '@/theme';
import { StickyCTABar, stickyBarHeight } from '@/ui/StickyCTABar';
import { useStickyBarHeight } from '@/ui/toastPlacement';

import { flat, renderUi, visualOf } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));
jest.mock('expo-haptics', () => ({}));
// Mounted means focused here. Blur, another tab and a pushed screen run in the real router: tests/shell/shellToast.test.tsx.
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('react-native-keyboard-controller', () => jest.requireActual('react-native-keyboard-controller/jest'));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

beforeAll(hydrateThemePreference);

describe('StickyCTABar', () => {
  it.each([
    // 09 §4.3: 20 on phones below 430, 24 from 430 and on tablets and desktop.
    [360, space[20]],
    [390, space[20]],
    [430, space[24]],
    [1280, space[24]],
  ])('has the screen gutter at %i, so it lines up with the form', async (width, gutter) => {
    (useWindowDimensions as jest.Mock).mockReturnValue({ width, height: 844, scale: 1, fontScale: 1 });
    await renderUi(<StickyCTABar label="Weiter" onPress={jest.fn()} testID="c" />);
    expect(flat(screen.getByTestId('c').props.style).paddingHorizontal).toBe(gutter);
    (useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
  });

  it('has a 52 button, 12 vertical padding and the safe inset below', async () => {
    await renderUi(<StickyCTABar label="Weiter" onPress={jest.fn()} testID="c" />);
    const style = flat(screen.getByTestId('c').props.style);
    expect(style.paddingTop).toBe(space[12]);
    expect(style.paddingBottom as number).toBeGreaterThanOrEqual(space[12]);
    expect(visualOf('c.primary').minHeight).toBe(size.button.l);
    expect(size.button.l).toBe(52);
  });

  it('presses the primary and the secondary', async () => {
    const onPress = jest.fn();
    const onDraft = jest.fn();
    await renderUi(
      <StickyCTABar
        label="Weiter"
        onPress={onPress}
        secondary={{ label: 'Entwurf speichern', onPress: onDraft, testID: 'c.draft' }}
        testID="c"
      />,
    );
    await fireEvent.press(screen.getByTestId('c.primary'));
    await fireEvent.press(screen.getByTestId('c.draft'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(flat(screen.getByTestId('c.primary').props.style).flexBasis).toBe('50%');
  });

  // Jest has no layout engine: this pins what lets a label wrap inside the bar. The measured right edge at 360, 390 and 430
  // comes from the browser (DQ-048).
  describe.each([
    ['alone', undefined],
    ['next to a draft action', { label: 'Entwurf speichern', onPress: jest.fn() }],
  ])('at 200 %% font with a long label, %s', (_name, secondary) => {
    const label = 'Fahrzeug veröffentlichen';

    afterEach(() => (useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

    it.each([360, 390, 430])('can shrink to the bar at %i and wraps instead of truncating', async (width) => {
      (useWindowDimensions as jest.Mock).mockReturnValue({ width, height: 844, scale: 1, fontScale: 2 });
      await renderUi(<StickyCTABar label={label} onPress={jest.fn()} secondary={secondary} testID="c" />);
      const primary = flat(screen.getByTestId('c.primary').props.style);
      expect(primary.flexShrink).toBe(1);
      expect(primary.minWidth).toBe(0);
      const text = screen.getByText(label);
      expect(text.props.numberOfLines).toBeUndefined();
      expect(flat(text.props.style).flexShrink).toBe(1);
    });
  });

  it('lets both actions take their own line when they no longer fit side by side', async () => {
    await renderUi(<StickyCTABar label="Weiter" onPress={jest.fn()} secondary={{ label: 'Entwurf speichern', onPress: jest.fn() }} testID="c" />);
    const row = screen.getByTestId('c').children[1];
    expect(flat(typeof row === 'string' ? undefined : row?.props.style).flexWrap).toBe('wrap');
  });

  it('blocks presses while loading', async () => {
    const onPress = jest.fn();
    await renderUi(<StickyCTABar label="Weiter" onPress={onPress} loading testID="c" />);
    await fireEvent.press(screen.getByTestId('c.primary'));
    expect(screen.getByTestId('c.primary').props.accessibilityState.busy).toBe(true);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('blocks presses while disabled', async () => {
    const onPress = jest.fn();
    await renderUi(<StickyCTABar label="Weiter" onPress={onPress} disabled testID="c" />);
    await fireEvent.press(screen.getByTestId('c.primary'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('StickyCTABar and the toast', () => {
  let reported = -1;
  function Probe() {
    reported = useStickyBarHeight();
    return null;
  }
  /** The layout of the whole bar: the hairline and the safe inset are inside it. */
  const layOut = (testID: string, height: number) =>
    fireEvent(screen.getByTestId(`${testID}.sticky`), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });
  const ONE_ROW = 1 + space[12] + size.button.l + space[12];
  const TWO_ROWS = ONE_ROW + size.button.s + space[8];

  it('reports its whole height, follows it when the actions wrap, and withdraws it when it goes', async () => {
    const { unmount } = await renderUi(
      <>
        <StickyCTABar label="Weiter" onPress={jest.fn()} secondary={{ label: 'Entwurf speichern', onPress: jest.fn() }} testID="c" />
        <Probe />
      </>,
    );
    // Before its first layout it already reports one row, so the toast never sits on the content and moves up (F3, M2.8).
    expect(reported).toBe(stickyBarHeight(0));
    expect(reported).toBeGreaterThan(size.button.l);
    // Less than half a pixel off the estimate is no change, so nothing moves by rounding (M2.8 run 3).
    await layOut('c', stickyBarHeight(0) + 0.25);
    expect(reported).toBe(stickyBarHeight(0));
    await layOut('c', ONE_ROW);
    expect(reported).toBe(ONE_ROW);
    // 200 % font: the primary takes its own line under the draft action.
    await layOut('c', TWO_ROWS);
    expect(reported).toBe(TWO_ROWS);
    await act(async () => unmount());
    await renderUi(<Probe />);
    expect(reported).toBe(0);
  });

  it('two bars on one screen, as in the gallery: the taller counts until it goes', async () => {
    let hideSecond = () => undefined as void;
    function Two() {
      const [second, setSecond] = useState(true);
      hideSecond = () => setSecond(false);
      return (
        <>
          <StickyCTABar label="Weiter" onPress={jest.fn()} testID="c" />
          {second ? <StickyCTABar label="Fahrzeug veröffentlichen" onPress={jest.fn()} testID="d" /> : null}
          <Probe />
        </>
      );
    }
    const { unmount } = await renderUi(<Two />);
    await layOut('c', ONE_ROW);
    await layOut('d', TWO_ROWS);
    expect(reported).toBe(TWO_ROWS);
    await act(async () => hideSecond());
    expect(reported).toBe(ONE_ROW);
    await act(async () => unmount());
    expect(reported).toBe(ONE_ROW);
  });
});
