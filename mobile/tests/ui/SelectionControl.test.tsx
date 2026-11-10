import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference, radius, size, themes } from '@/theme';
import { Checkbox } from '@/ui/Checkbox';
import { Radio } from '@/ui/Radio';
import { Text } from '@/ui/Text';

import { flat, renderUi } from './helpers';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

beforeAll(hydrateThemePreference);

const carbon = themes.carbon.color;

/** The 22 box: the first view inside the visual. */
function boxOf(testID: string) {
  const pressable = screen.getByTestId(testID);
  const visual = pressable.children[pressable.children.length - 1];
  if (!visual || typeof visual === 'string') throw new Error('no visual');
  const box = visual.children[0];
  if (!box || typeof box === 'string') throw new Error('no box');
  return flat(box.props.style);
}

describe('Checkbox', () => {
  it('is a 22 box in a 44 target with role and state', async () => {
    await renderUi(<Checkbox checked={false} label="AGB" onChange={jest.fn()} testID="c" />);
    const control = screen.getByRole('checkbox', { name: 'AGB' });
    expect(control.props.accessibilityState.checked).toBe(false);
    expect(flat(control.props.style).width).toBe(size.touchMin);
    expect(flat(control.props.style).height).toBe(size.touchMin);
    expect(boxOf('c').width).toBe(size.checkbox);
    expect(boxOf('c').borderRadius).toBe(radius.xs);
    expect(boxOf('c').borderColor).toBe(carbon.border.control);
  });

  it('checked is bg.inverse', async () => {
    await renderUi(<Checkbox checked label="AGB" onChange={jest.fn()} testID="c" />);
    expect(boxOf('c').backgroundColor).toBe(carbon.bg.inverse);
  });

  it('toggles and respects disabled', async () => {
    const onChange = jest.fn();
    await renderUi(<Checkbox checked={false} label="A" onChange={onChange} testID="a" />);
    await fireEvent.press(screen.getByTestId('a'));
    expect(onChange).toHaveBeenCalledWith(true);
    onChange.mockClear();
    await renderUi(<Checkbox checked={false} label="B" disabled onChange={onChange} testID="b" />);
    await fireEvent.press(screen.getByTestId('b'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('error uses accent.fg and aria-invalid', async () => {
    await renderUi(<Checkbox checked={false} label="AGB" error onChange={jest.fn()} testID="c" />);
    expect(boxOf('c').borderColor).toBe(carbon.accent.fg);
    expect(screen.getByTestId('c').props['aria-invalid']).toBe(true);
  });

  it('can show its label as a row', async () => {
    await renderUi(
      <>
        <Checkbox checked={false} label="Newsletter" showLabel onChange={jest.fn()} />
        <Text>Dahinter</Text>
      </>,
    );
    expect(screen.getByText('Newsletter')).toBeTruthy();
  });
});

describe('Radio', () => {
  it('is round and always selects', async () => {
    const onChange = jest.fn();
    await renderUi(<Radio checked label="Heck" onChange={onChange} testID="r" />);
    const control = screen.getByRole('radio', { name: 'Heck' });
    expect(control.props.accessibilityState.checked).toBe(true);
    expect(boxOf('r').borderRadius).toBe(radius.full);
    await fireEvent.press(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
