import { fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { hydrateThemePreference, radius, size, themes } from '@/theme';
import { Switch } from '@/ui/Switch';

import { flat, renderUi, visualOf } from './helpers';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

beforeAll(hydrateThemePreference);

describe('Switch', () => {
  it('is 51 × 31 with role switch and aria-checked', async () => {
    await renderUi(<Switch value label="Öffentlich zeigen" onValueChange={jest.fn()} testID="s" />);
    const control = screen.getByRole('switch', { name: 'Öffentlich zeigen' });
    expect(control.props.accessibilityState.checked).toBe(true);
    expect(flat(control.props.style).width).toBe(size.switch.width);
    expect(flat(control.props.style).height).toBe(size.switch.height);
    expect(visualOf('s').width).toBe(size.switch.width);
  });

  it('keeps the canvas thumb when disabled and on: only the track takes the disabled colour', async () => {
    await renderUi(<Switch value disabled label="A" onValueChange={jest.fn()} testID="s" />);
    expect(flat(screen.getByTestId('s.thumbOn').props.style).backgroundColor).toBe(themes.carbon.color.bg.canvas);
    expect(visualOf('s').borderRadius).toBe(radius.full);
  });

  it('reaches a 44 native hit area', async () => {
    await renderUi(<Switch value={false} label="A" onValueChange={jest.fn()} testID="s" />);
    expect(screen.getByTestId('s').props.hitSlop.top).toBe((size.touchMin - size.switch.height) / 2);
  });

  it('toggles with a selection haptic', async () => {
    const onValueChange = jest.fn();
    await renderUi(<Switch value={false} label="A" onValueChange={onValueChange} testID="s" />);
    await fireEvent.press(screen.getByTestId('s'));
    expect(onValueChange).toHaveBeenCalledWith(true);
    expect(Haptics.selectionAsync).toHaveBeenCalled();
  });

  it('disabled does not toggle', async () => {
    const onValueChange = jest.fn();
    await renderUi(<Switch value label="A" disabled onValueChange={onValueChange} testID="s" />);
    await fireEvent.press(screen.getByTestId('s'));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
