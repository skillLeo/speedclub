import { act, fireEvent, screen } from '@testing-library/react-native';

import { useWindowDimensions } from 'react-native';

import { hydrateThemePreference, motion, radius, size, space } from '@/theme';
import { SearchBar } from '@/ui/SearchBar';

import { flat, renderUi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

beforeAll(hydrateThemePreference);

describe('SearchBar', () => {
  const props = { placeholder: 'Marke, Modell, Mods oder Mitglieder', testID: 's' };

  describe('a press on an action that is abandoned', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const settle = () =>
      act(async () => {
        jest.advanceTimersByTime(motion.css['effect.fast'].duration);
      });

    it('does not leave the cancel action up after the field lost focus', async () => {
      await renderUi(<SearchBar {...props} value="" onChangeText={jest.fn()} />);
      await fireEvent(screen.getByTestId('s'), 'focus');
      const cancel = screen.getByTestId('s.cancel');
      await fireEvent(cancel, 'pressIn');
      await fireEvent(screen.getByTestId('s'), 'blur');
      expect(screen.queryByTestId('s.cancel')).not.toBeNull();
      await fireEvent(cancel, 'pressOut');
      await settle();
      expect(screen.queryByTestId('s.cancel')).toBeNull();
    });

    it('a later blur counts again', async () => {
      await renderUi(<SearchBar {...props} value="abc" onChangeText={jest.fn()} />);
      await fireEvent(screen.getByTestId('s'), 'focus');
      const clear = screen.getByTestId('s.clear');
      await fireEvent(clear, 'pressIn');
      await fireEvent(clear, 'pressOut');
      await settle();
      await fireEvent(screen.getByTestId('s'), 'focus');
      await fireEvent(screen.getByTestId('s'), 'blur');
      expect(screen.queryByTestId('s.cancel')).toBeNull();
    });

    it('a completed press still runs, though the release came first as on web', async () => {
      const onCancel = jest.fn();
      await renderUi(<SearchBar {...props} value="abc" onChangeText={jest.fn()} onCancel={onCancel} />);
      await fireEvent(screen.getByTestId('s'), 'focus');
      const cancel = screen.getByTestId('s.cancel');
      await fireEvent(cancel, 'pressIn');
      await fireEvent(screen.getByTestId('s'), 'blur');
      await fireEvent(cancel, 'pressOut');
      await fireEvent.press(screen.getByTestId('s.cancel'));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  it('has the search metrics, role and name', async () => {
    await renderUi(<SearchBar {...props} value="" onChangeText={jest.fn()} />);
    const input = screen.getByTestId('s');
    expect(input.props.role).toBe('searchbox');
    expect(input.props['aria-label']).toBe(props.placeholder);
    const field = flat(screen.getByTestId('s.field').props.style);
    expect(field.minHeight).toBe(size.search);
    expect(field.borderRadius).toBe(radius.md);
  });

  it('shows clear only with text, and clear empties the field', async () => {
    const onChangeText = jest.fn();
    const view = await renderUi(<SearchBar {...props} value="" onChangeText={onChangeText} />);
    expect(screen.queryByTestId('s.clear')).toBeNull();
    await view.unmount();
    await renderUi(<SearchBar {...props} value="BMW" onChangeText={onChangeText} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Eingabe löschen' }));
    expect(onChangeText).toHaveBeenCalledWith('');
  });

  it('shows the cancel action only while focused', async () => {
    const onCancel = jest.fn();
    const onChangeText = jest.fn();
    await renderUi(<SearchBar {...props} value="M4" onChangeText={onChangeText} onCancel={onCancel} />);
    expect(screen.queryByTestId('s.cancel')).toBeNull();
    await fireEvent(screen.getByTestId('s'), 'focus');
    await fireEvent.press(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onChangeText).toHaveBeenCalledWith('');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('s.cancel')).toBeNull();
  });

  it('hides the cancel action on blur', async () => {
    await renderUi(<SearchBar {...props} value="" onChangeText={jest.fn()} />);
    await fireEvent(screen.getByTestId('s'), 'focus');
    expect(screen.getByTestId('s.cancel')).toBeTruthy();
    await fireEvent(screen.getByTestId('s'), 'blur');
    expect(screen.queryByTestId('s.cancel')).toBeNull();
  });

  it('opens the bar when focus arrives on clear, so it looks the same from both directions (DQ-098)', async () => {
    await renderUi(<SearchBar {...props} value="BMW" onChangeText={jest.fn()} />);
    expect(screen.queryByTestId('s.cancel')).toBeNull();
    await fireEvent(screen.getByTestId('s.clear'), 'focus', {});
    expect(screen.queryByTestId('s.cancel')).not.toBeNull();
    await fireEvent(screen.getByTestId('s.clear'), 'blur', {});
    expect(screen.queryByTestId('s.cancel')).toBeNull();
  });

  it('gives the field a right padding only without the clear button (DQ-038)', async () => {
    const view = await renderUi(<SearchBar {...props} value="" onChangeText={jest.fn()} />);
    expect(flat(screen.getByTestId('s.field').props.style).paddingRight).toBe(space[12]);
    await view.unmount();
    await renderUi(<SearchBar {...props} value="BMW" onChangeText={jest.fn()} />);
    expect(flat(screen.getByTestId('s.field').props.style).paddingRight).toBeUndefined();
  });

  describe('at a large font (DQ-060)', () => {
    afterEach(() => (useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

    it('puts the cancel action on its own line on a phone while open', async () => {
      (useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
      await renderUi(<SearchBar {...props} value="BMW" onChangeText={jest.fn()} />);
      expect(flat(screen.getByTestId('s.field').props.style).flex).toBe(1);
      await fireEvent(screen.getByTestId('s'), 'focus');
      expect(flat(screen.getByTestId('s.field').props.style).flex).toBeUndefined();
      expect(screen.getByTestId('s.cancel')).toBeTruthy();
    });

    it('keeps it beside the field where there is room', async () => {
      (useWindowDimensions as jest.Mock).mockReturnValue({ width: 1280, height: 844, scale: 1, fontScale: 2 });
      await renderUi(<SearchBar {...props} value="BMW" onChangeText={jest.fn()} />);
      await fireEvent(screen.getByTestId('s'), 'focus');
      expect(flat(screen.getByTestId('s.field').props.style).flex).toBe(1);
    });
  });

  it('submits the value', async () => {
    const onSubmit = jest.fn();
    await renderUi(<SearchBar {...props} value="E46" onChangeText={jest.fn()} onSubmit={onSubmit} />);
    await fireEvent(screen.getByTestId('s'), 'submitEditing');
    expect(onSubmit).toHaveBeenCalledWith('E46');
  });
});
