import { screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

import { hydrateThemePreference } from '@/theme';
import { KeyboardInsetView, keyboardInsetPadding } from '@/ui/KeyboardInsetView';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

/**
 * BUG-4 (MSG-02 on Android): the composer has to end right above the keyboard. The padding is the keyboard height minus the bottom
 * inset the composer keeps itself, whatever sits above the view (the thread's header bar made the library's frame-based offset
 * fall short by its height).
 */
describe('keyboardInsetPadding', () => {
  it('is the keyboard height minus the inset the content keeps', () => {
    expect(keyboardInsetPadding(550 / 2, 24)).toBe(251);
    expect(keyboardInsetPadding(336, 34)).toBe(302);
  });

  it('is 0 while the keyboard is closed or lower than the inset', () => {
    expect(keyboardInsetPadding(0, 34)).toBe(0);
    expect(keyboardInsetPadding(20, 34)).toBe(0);
  });
});

describe('KeyboardInsetView', () => {
  const keyboardAnimation = useReanimatedKeyboardAnimation as jest.Mock;
  const closed: unknown = keyboardAnimation();
  const open = (height: number) =>
    keyboardAnimation.mockReturnValue({
      height: { value: -height, get: () => -height, set: jest.fn() },
      progress: { value: 1, get: () => 1, set: jest.fn() },
    });

  afterEach(() => keyboardAnimation.mockReturnValue(closed));

  it('pads nothing with the keyboard closed', async () => {
    await renderUi(
      <KeyboardInsetView bottomInset={34} testID="kiv">
        <Text>Composer</Text>
      </KeyboardInsetView>,
    );
    expect(flat(screen.getByTestId('kiv').props.style).paddingBottom ?? 0).toBe(0);
  });

  it('lifts its content by the open keyboard, less the inset, and keeps the style it was given', async () => {
    open(336);
    await renderUi(
      <KeyboardInsetView bottomInset={34} style={{ flex: 1 }} testID="kiv">
        <Text>Composer</Text>
      </KeyboardInsetView>,
    );
    const style = flat(screen.getByTestId('kiv').props.style);
    expect(style.paddingBottom).toBe(302);
    expect(style.flex).toBe(1);
  });
});
