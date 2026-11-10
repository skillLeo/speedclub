import { act, cleanup, fireEvent, screen, within } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Dimensions, Text as RNText } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';

import { hydrateThemePreference, radius, size, space } from '@/theme';
import { Dialog, orderActions } from '@/ui/Dialog';

import { flat, renderUi } from './helpers';

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Warning: 'warning' },
  notificationAsync: jest.fn(() => Promise.resolve()),
}));

const keyboardState = useKeyboardState as jest.Mock;

beforeAll(hydrateThemePreference);
beforeEach(() => jest.clearAllMocks());

describe('Dialog', () => {
  it('keeps a model name in title and body whole, and the accessible name plain (DQ-047)', async () => {
    await renderUi(<Dialog visible onClose={jest.fn()} title="Skyline GT-R löschen?" body="Die GT-R Seite verschwindet." actions={[]} testID="d" />);
    expect(screen.getByTestId('d.title').props.children).toBe('Skyline GT-\u2060R löschen?');
    expect(screen.getByTestId('d.body').props.children).toBe('Die GT-\u2060R Seite verschwindet.');
    expect(screen.getByTestId('d').props['aria-label']).toBe('Skyline GT-R löschen?');
  });

  it('shows a hairline above the buttons while the body runs on under them, until it is scrolled to the end (DQ-454)', async () => {
    await renderUi(<Dialog visible onClose={jest.fn()} title="Konto löschen?" body="Lang." actions={[]} testID="d" />);
    expect(screen.queryByTestId('d.more', { includeHiddenElements: true })).toBeNull();
    const scroll = screen.getByTestId('d.scroll');
    await fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 272, height: 300 } } });
    await fireEvent(scroll, 'contentSizeChange', 272, 700);
    expect(screen.getByTestId('d.more', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 0, y: 400 }, contentSize: { width: 272, height: 700 }, layoutMeasurement: { width: 272, height: 300 } } });
    expect(screen.queryByTestId('d.more', { includeHiddenElements: true })).toBeNull();
  });

  it('renders nothing while closed', async () => {
    await renderUi(<Dialog visible={false} title="Fahrzeug löschen?" actions={[]} testID="d" />);
    expect(screen.queryByTestId('d')).toBeNull();
  });

  it('is a modal dialog with the §8 shape', async () => {
    await renderUi(<Dialog visible title="Fahrzeug löschen?" body="Das kann nicht rückgängig gemacht werden." actions={[]} testID="d" />);
    const panel = screen.getByTestId('d');
    expect(panel.props.role).toBe('dialog');
    expect(panel.props['aria-modal']).toBe(true);
    expect(panel.props['aria-label']).toBe('Fahrzeug löschen?');
    const style = flat(panel.props.style);
    expect(style.maxWidth).toBe(size.dialogMaxWidth);
    expect(style.borderRadius).toBe(radius.md);
    expect(style.borderRadius).toBe(12);
    expect(screen.getByTestId('d.body')).toHaveTextContent('Das kann nicht rückgängig gemacht werden.');
  });

  it('keeps the text clear of the scroller and its ring, and on the edge of the panel', async () => {
    await renderUi(<Dialog visible title="Konto löschen?" body="Lang." actions={[]} testID="d" />);
    const scroll = screen.getByTestId('d.scroll');
    const box = flat(scroll.props.style);
    const content = flat(scroll.props.contentContainerStyle);
    expect(box.borderRadius).toBe(radius.sm);
    expect(box.margin).toBe(-space[8]);
    expect(content.padding).toBe(space[8]);
  });

  it('always puts the destructive action last', () => {
    const remove = { label: 'Löschen', destructive: true, onPress: jest.fn() };
    const keep = { label: 'Behalten', onPress: jest.fn() };
    expect(orderActions([remove, keep]).map((action) => action.label)).toEqual(['Behalten', 'Löschen']);
  });

  it('plays the warning haptic for a destructive action only', async () => {
    const onDelete = jest.fn();
    const onKeep = jest.fn();
    await renderUi(
      <Dialog
        visible
        title="Fahrzeug löschen?"
        testID="d"
        actions={[
          { label: 'Fahrzeug löschen', destructive: true, onPress: onDelete, testID: 'd.delete' },
          { label: 'Behalten', onPress: onKeep, testID: 'd.keep' },
        ]}
      />,
    );
    await fireEvent.press(screen.getByTestId('d.keep'));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('d.delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
  });

  it('closes on the scrim only when it has an onClose', async () => {
    const onClose = jest.fn();
    await renderUi(<Dialog visible onClose={onClose} title="Titel" actions={[]} testID="d" />);
    await fireEvent.press(screen.getByTestId('d.scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('during the exit animation', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function renderClosing(onDelete: jest.Mock, onClose: jest.Mock) {
      function Host() {
        const [visible, setVisible] = useState(true);
        return (
          <Dialog
            visible={visible}
            onClose={() => {
              onClose();
              setVisible(false);
            }}
            title="Fahrzeug löschen?"
            testID="d"
            actions={[
              {
                label: 'Löschen',
                destructive: true,
                testID: 'd.delete',
                onPress: () => {
                  onDelete();
                  setVisible(false);
                },
              },
            ]}
          />
        );
      }
      return renderUi(<Host />);
    }

    it('a second tap on a destructive action does nothing', async () => {
      const onDelete = jest.fn();
      await renderClosing(onDelete, jest.fn());
      await fireEvent.press(screen.getByTestId('d.delete'));
      expect(screen.queryByTestId('d')).not.toBeNull();
      expect(flat(screen.getByTestId('d').props.style).pointerEvents).toBe('none');
      await fireEvent.press(screen.getByTestId('d.delete'));
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    });

    // Enter on web and a screen reader activation arrive as a click, past `pointerEvents`.
    it('a keyboard activation does nothing either', async () => {
      const onDelete = jest.fn();
      await renderClosing(onDelete, jest.fn());
      await fireEvent.press(screen.getByTestId('d.delete'));
      await act(async () => {
        screen.getByTestId('d.delete').props.onClick({ stopPropagation: () => undefined, persist: () => undefined });
      });
      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('the scrim and the accessibility escape do not close it again', async () => {
      const onClose = jest.fn();
      await renderClosing(jest.fn(), onClose);
      await fireEvent.press(screen.getByTestId('d.scrim'));
      await fireEvent.press(screen.getByTestId('d.scrim'));
      await act(async () => screen.getByTestId('d').props.onAccessibilityEscape());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('unmounts afterwards', async () => {
      await renderClosing(jest.fn(), jest.fn());
      await fireEvent.press(screen.getByTestId('d.delete'));
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.queryByTestId('d')).toBeNull();
    });
  });

  it('scrolls text and content inside the panel, with the actions fixed below', async () => {
    await renderUi(
      <Dialog visible title="Titel" body="Lang" testID="d" actions={[{ label: 'OK', onPress: jest.fn(), testID: 'd.ok' }]}>
        <RNText>Eingabe</RNText>
      </Dialog>,
    );
    const scroll = screen.getByTestId('d.scroll');
    expect(within(scroll).getByTestId('d.title')).toBeTruthy();
    expect(within(scroll).getByTestId('d.body')).toBeTruthy();
    expect(within(scroll).getByText('Eingabe')).toBeTruthy();
    expect(within(scroll).queryByTestId('d.ok')).toBeNull();
    expect(within(screen.getByTestId('d')).getByTestId('d.ok')).toBeTruthy();
    expect(flat(scroll.props.style).flexShrink).toBe(1);
  });

  it('keeps the panel on the screen and above the keyboard', async () => {
    const { height } = Dimensions.get('window');
    await renderUi(<Dialog visible title="Titel" testID="d" actions={[]} />);
    expect(flat(screen.getByTestId('d').props.style).maxHeight).toBe(height - 2 * space[24]);
    await cleanup();

    keyboardState.mockImplementation((selector: (state: { height: number }) => number) => selector({ height: 300 }));
    try {
      await renderUi(<Dialog visible title="Titel" testID="d" actions={[]} />);
      expect(flat(screen.getByTestId('d').props.style).maxHeight).toBe(height - 300 - 2 * space[24]);
    } finally {
      keyboardState.mockImplementation((selector: (state: { height: number }) => number) => selector({ height: 0 }));
    }
  });

  it('ignores presses on a loading action', async () => {
    const onPress = jest.fn();
    await renderUi(
      <Dialog visible title="Titel" testID="d" actions={[{ label: 'Senden', loading: true, onPress, testID: 'd.send' }]} />,
    );
    await fireEvent.press(screen.getByTestId('d.send'));
    expect(screen.getByTestId('d.send').props.accessibilityState.busy).toBe(true);
    expect(onPress).not.toHaveBeenCalled();
  });
});
