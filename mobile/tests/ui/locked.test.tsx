import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference } from '@/theme';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { Text } from '@/ui/Text';
import { useCurrentToast } from '@/ui/toast';

import { renderUi } from './helpers';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()), notificationAsync: jest.fn(() => Promise.resolve()) }));

beforeAll(hydrateThemePreference);

function ToastProbe() {
  const current = useCurrentToast();
  return current ? <Text variant="body">{current.message}</Text> : null;
}

describe('locked controls (M3.5 view-as)', () => {
  it('a locked button looks and announces disabled and says why instead of acting', async () => {
    const onPress = jest.fn();
    await renderUi(
      <>
        <Button label="Folgen" locked="In der Ansicht als Mitglied kannst du nichts ändern." onPress={onPress} testID="b" />
        <ToastProbe />
      </>,
    );
    expect(screen.getByTestId('b').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByText('In der Ansicht als Mitglied kannst du nichts ändern.')).toBeTruthy();
  });

  it('an icon button does the same; without a reason both act as before', async () => {
    const onPress = jest.fn();
    await renderUi(
      <>
        <IconButton icon="bookmark-simple" label="Speichern" locked="Nur lesen" onPress={onPress} testID="i" />
        <Button label="Weiter" onPress={onPress} testID="free" />
      </>,
    );
    await fireEvent.press(screen.getByTestId('i'));
    expect(onPress).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('free'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('free').props.accessibilityState.disabled).toBeFalsy();
  });
});
