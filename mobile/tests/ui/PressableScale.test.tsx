import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference } from '@/theme';
import { PressableScale } from '@/ui/PressableScale';
import { Text } from '@/ui/Text';

import { renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('PressableScale', () => {
  it('passes props and calls press handlers in order', async () => {
    const calls: string[] = [];
    await renderUi(
      <PressableScale
        role="button"
        aria-label="Karte"
        testID="p"
        onPressIn={() => calls.push('in')}
        onPress={() => calls.push('press')}
        onPressOut={() => calls.push('out')}
      >
        <Text>Inhalt</Text>
      </PressableScale>,
    );
    await fireEvent(screen.getByTestId('p'), 'pressIn');
    await fireEvent(screen.getByTestId('p'), 'press');
    await fireEvent(screen.getByTestId('p'), 'pressOut');
    expect(calls).toEqual(['in', 'press', 'out']);
    expect(screen.getByRole('button', { name: 'Karte' })).toBeTruthy();
  });

  it('gives children and styles the pressed state', async () => {
    await renderUi(
      <PressableScale testID="p">{(state) => <Text>{state.pressed ? 'gedrückt' : 'ruhig'}</Text>}</PressableScale>,
    );
    expect(screen.getByText('ruhig')).toBeTruthy();
    await fireEvent(screen.getByTestId('p'), 'pressIn');
    expect(screen.getByText('gedrückt')).toBeTruthy();
    await fireEvent(screen.getByTestId('p'), 'pressOut');
    expect(screen.getByText('ruhig')).toBeTruthy();
  });

  it('native hitSlop reaches 44 from the visual height', async () => {
    await renderUi(<PressableScale testID="p" visualHeight={36} />);
    expect(screen.getByTestId('p').props.hitSlop).toEqual({ top: 4, bottom: 4, left: 0, right: 0 });
  });

  it('adds no key handler on native, also for a toggle, and passes a caller’s own one through unchanged', async () => {
    const onKeyDown = jest.fn();
    await renderUi(
      <>
        <PressableScale role="checkbox" aria-checked={false} aria-label="A" onPress={jest.fn()} testID="c" />
        <PressableScale role="switch" aria-checked={false} aria-label="B" onPress={jest.fn()} onKeyDown={onKeyDown} testID="s" />
      </>,
    );
    expect(screen.getByTestId('c').props.onKeyDown).toBeUndefined();
    expect(screen.getByTestId('s').props.onKeyDown).toBe(onKeyDown);
  });

  it('does not press when disabled', async () => {
    const onPress = jest.fn();
    await renderUi(<PressableScale testID="p" disabled onPress={onPress} />);
    await fireEvent.press(screen.getByTestId('p'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
