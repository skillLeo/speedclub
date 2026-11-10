import { fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { hydrateThemePreference, radius, size, themes } from '@/theme';
import { SegmentedControl } from '@/ui/SegmentedControl';

import { flat, renderUi } from './helpers';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

beforeAll(hydrateThemePreference);

const options = [
  { value: 'mine', label: 'Für dich' },
  { value: 'following', label: 'Folge ich' },
] as const;

describe('SegmentedControl', () => {
  it('at a large font: scrolls with content-sized segments, labels never hyphenated', async () => {
    // Jest's window has font scale 2.
    await renderUi(<SegmentedControl options={options} value="mine" onChange={jest.fn()} label="Feed" testID="s" />);
    expect(flat(screen.getByTestId('s.mine').props.style).flexShrink).toBe(0);
  });

  it('has the metrics and a tablist by default', async () => {
    await renderUi(<SegmentedControl options={options} value="mine" onChange={jest.fn()} label="Feed" testID="s" />);
    const track = screen.getByTestId('s');
    expect(track.props.role).toBe('tablist');
    expect(track.props['aria-label']).toBe('Feed');
    expect(flat(track.props.style).minHeight).toBe(size.segmented);
    expect(flat(track.props.style).borderRadius).toBe(radius.sm);
    expect(flat(track.props.style).backgroundColor).toBe(themes.carbon.color.bg.raised);
  });

  it('marks the selected tab and reaches 44 natively', async () => {
    await renderUi(<SegmentedControl options={options} value="following" onChange={jest.fn()} label="Feed" testID="s" />);
    expect(screen.getByRole('tab', { name: 'Folge ich' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('tab', { name: 'Für dich' }).props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId('s.mine').props.hitSlop.top).toBe(6);
  });

  it('radiogroup uses radio and aria-checked', async () => {
    await renderUi(<SegmentedControl options={options} role="radiogroup" value="mine" onChange={jest.fn()} label="Feed" />);
    expect(screen.getByRole('radio', { name: 'Für dich' }).props.accessibilityState.checked).toBe(true);
  });

  it('selects with a haptic, and not when already selected', async () => {
    const onChange = jest.fn();
    await renderUi(<SegmentedControl options={options} value="mine" onChange={onChange} label="Feed" testID="s" />);
    await fireEvent.press(screen.getByTestId('s.mine'));
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('s.following'));
    expect(onChange).toHaveBeenCalledWith('following');
    expect(Haptics.selectionAsync).toHaveBeenCalled();
  });

  it('arrow keys move the selection and skip disabled segments', async () => {
    const onChange = jest.fn();
    const three = [
      { value: 'a', label: 'Verbaut' },
      { value: 'b', label: 'Geplant', disabled: true },
      { value: 'c', label: 'Entfernt' },
    ] as const;
    await renderUi(<SegmentedControl options={three} value="a" onChange={onChange} label="Status" testID="s" />);
    await fireEvent(screen.getByTestId('s'), 'keyDown', { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('disabled does not select', async () => {
    const onChange = jest.fn();
    await renderUi(<SegmentedControl options={options} value="mine" disabled onChange={onChange} label="Feed" testID="s" />);
    await fireEvent.press(screen.getByTestId('s.following'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
