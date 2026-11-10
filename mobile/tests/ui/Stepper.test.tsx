import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference, size } from '@/theme';
import { Stepper } from '@/ui/Stepper';

import { flat, renderUi } from './helpers';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

beforeAll(hydrateThemePreference);

describe('Stepper', () => {
  it('is 36 high with 44 wide controls and native hit area', async () => {
    await renderUi(<Stepper value={2} label="Sitze" onChange={jest.fn()} testID="s" />);
    expect(flat(screen.getByTestId('s').props.style).minHeight).toBe(size.stepper);
    const plus = screen.getByTestId('s.increase');
    expect(flat(plus.props.style).width).toBe(size.touchMin);
    expect(plus.props.hitSlop.top).toBe(4);
    expect(plus.props.role).toBe('button');
    expect(screen.getByTestId('s.value')).toHaveTextContent('2');
  });

  it('steps within the bounds', async () => {
    const onChange = jest.fn();
    await renderUi(<Stepper value={4} min={0} max={5} step={2} label="Sitze" onChange={onChange} testID="s" />);
    await fireEvent.press(screen.getByTestId('s.increase'));
    expect(onChange).toHaveBeenLastCalledWith(5);
    await fireEvent.press(screen.getByTestId('s.decrease'));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('keeps decimal steps exact', async () => {
    const onChange = jest.fn();
    await renderUi(<Stepper value={0.1} step={0.2} label="Faktor" onChange={onChange} testID="s" />);
    await fireEvent.press(screen.getByTestId('s.increase'));
    expect(onChange).toHaveBeenCalledWith(0.3);
  });

  it('disables a control at its bound', async () => {
    const onChange = jest.fn();
    await renderUi(<Stepper value={0} min={0} max={1} label="Sitze" onChange={onChange} testID="s" />);
    await fireEvent.press(screen.getByTestId('s.decrease'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('names the controls from common', async () => {
    await renderUi(<Stepper value={1} label="Sitze" onChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Sitze: Weniger' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sitze: Mehr' })).toBeTruthy();
  });

  it('formats by locale', async () => {
    await renderUi(<Stepper value={1500} label="PS" onChange={jest.fn()} testID="s" />);
    expect(screen.getByTestId('s.value')).toHaveTextContent('1.500');
  });
});
