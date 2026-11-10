import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference, size, themes } from '@/theme';
import { IconButton } from '@/ui/IconButton';

import { flat, renderUi, visualOf } from './helpers';

beforeAll(hydrateThemePreference);

describe('IconButton', () => {
  it('is a 44 target with the required name', async () => {
    const onPress = jest.fn();
    await renderUi(<IconButton icon="bell" label="Benachrichtigungen" onPress={onPress} testID="i" />);
    const button = screen.getByRole('button', { name: 'Benachrichtigungen' });
    expect(flat(button.props.style).width).toBe(size.touchMin);
    expect(flat(button.props.style).height).toBe(size.touchMin);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('on a photo draws a 36 circle inside the 44 target', async () => {
    await renderUi(<IconButton icon="share-network" label="Teilen" variant="onPhoto" testID="i" />);
    expect(flat(screen.getByTestId('i').props.style).width).toBe(size.touchMin);
    expect(visualOf('i').width).toBe(size.iconButtonOnPhoto);
    expect(visualOf('i').backgroundColor).toBe(themes.carbon.color.onPhoto.chipBg);
  });

  it('shows state.pressed while pressed', async () => {
    await renderUi(<IconButton icon="bell" label="Glocke" testID="i" />);
    expect(visualOf('i').backgroundColor).toBeUndefined();
    await fireEvent(screen.getByTestId('i'), 'pressIn');
    expect(visualOf('i').backgroundColor).toBe(themes.carbon.color.state.pressed);
  });

  it('disabled and loading block the press', async () => {
    const onPress = jest.fn();
    await renderUi(<IconButton icon="bell" label="A" disabled onPress={onPress} testID="a" />);
    await fireEvent.press(screen.getByTestId('a'));
    await renderUi(<IconButton icon="bell" label="B" loading onPress={onPress} testID="b" />);
    expect(screen.getByTestId('b').props.accessibilityState.busy).toBe(true);
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('a toggle reports its state', async () => {
    await renderUi(<IconButton icon="star" label="Speichern" selected testID="i" />);
    expect(screen.getByTestId('i').props.accessibilityState.selected).toBe(true);
  });
});
