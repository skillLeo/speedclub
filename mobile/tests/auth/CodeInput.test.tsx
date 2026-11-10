import { fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { CodeInput } from '@/features/auth/components/CodeInput';
import { hydrateThemePreference } from '@/theme';

import { renderUi } from '../ui/helpers';

beforeAll(hydrateThemePreference);

function Harness({ onComplete, error }: { onComplete: (code: string) => void; error?: string }) {
  const [value, setValue] = useState('');
  return <CodeInput value={value} onChange={setValue} onComplete={onComplete} label="Code" error={error} testID="code" />;
}

/** The cells are hidden from screen readers on purpose: the one input speaks for them. */
const cell = (index: number) => screen.getByTestId(`code.cell${index}`, { includeHiddenElements: true });
const cellText = (index: number) => {
  const text = cell(index).children[0];
  return typeof text === 'string' || !text ? '' : text.children.join('');
};

describe('CodeInput', () => {
  it('is one labelled input with the one-time-code hints, behind six cells', async () => {
    await renderUi(<Harness onComplete={jest.fn()} />);
    const input = screen.getByTestId('code');
    expect(input.props['aria-label']).toBe('Code');
    expect(input.props.autoComplete).toBe('one-time-code');
    expect(input.props.textContentType).toBe('oneTimeCode');
    expect(input.props.keyboardType).toBe('number-pad');
    expect(cell(0).props['aria-hidden']).toBe(true);
    expect(cell(5)).toBeTruthy();
  });

  it('spreads typed digits over the cells and completes once', async () => {
    const onComplete = jest.fn();
    await renderUi(<Harness onComplete={onComplete} />);
    const input = screen.getByTestId('code');
    await fireEvent.changeText(input, '12');
    expect([cellText(0), cellText(1), cellText(2)]).toEqual(['1', '2', '']);
    expect(onComplete).not.toHaveBeenCalled();
    await fireEvent.changeText(input, '123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    // The same six digits again, as from a re-render or a second paste, do not submit twice.
    await fireEvent.changeText(input, '123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('takes a pasted code with spaces and letters, and drops what is too long', async () => {
    const onComplete = jest.fn();
    await renderUi(<Harness onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByTestId('code'), 'Dein Code: 482 913 7');
    expect(onComplete).toHaveBeenCalledWith('482913');
    expect(cellText(5)).toBe('3');
  });

  it('completes again after the code was corrected', async () => {
    const onComplete = jest.fn();
    await renderUi(<Harness onComplete={onComplete} />);
    const input = screen.getByTestId('code');
    await fireEvent.changeText(input, '111111');
    await fireEvent.changeText(input, '11111');
    await fireEvent.changeText(input, '111112');
    expect(onComplete.mock.calls).toEqual([['111111'], ['111112']]);
  });

  // After a refusal the screen empties the field from outside, without a change event, and the mail still holds that same code.
  it('completes again for the same code once the field was emptied from outside', async () => {
    const onComplete = jest.fn();
    function Refusing() {
      const [value, setValue] = useState('');
      return (
        <>
          <CodeInput value={value} onChange={setValue} onComplete={onComplete} label="Code" testID="code" />
          <Pressable role="button" aria-label="refuse" testID="refuse" onPress={() => setValue('')} />
        </>
      );
    }
    await renderUi(<Refusing />);
    const input = screen.getByTestId('code');
    await fireEvent.changeText(input, '482913');
    expect(onComplete).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('refuse'));
    expect(input.props.value).toBe('');
    await fireEvent.changeText(input, '482913');
    expect(onComplete.mock.calls).toEqual([['482913'], ['482913']]);
  });

  it('shows an error as text with an alert role, not as colour alone', async () => {
    await renderUi(<Harness onComplete={jest.fn()} error="Das hat nicht gepasst." />);
    const error = screen.getByTestId('code.error');
    expect(error.props.role).toBe('alert');
    expect(screen.getByTestId('code').props['aria-invalid']).toBe(true);
  });
});

describe('CodeInput on arrival', () => {
  it('native: leaves the focus to autoFocus, where the keyboard decides what scrolls', async () => {
    await renderUi(<CodeInput value="" onChange={jest.fn()} label="Code" autoFocus testID="code" />);
    expect(screen.getByTestId('code').props.autoFocus).toBe(true);
  });
});
