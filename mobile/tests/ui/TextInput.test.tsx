import { fireEvent, screen } from '@testing-library/react-native';
import { createRef, type ComponentRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import type { TextInput as RNTextInput } from 'react-native';

import { hydrateThemePreference, size, themes } from '@/theme';
import { errorFocusWidth, TextInput } from '@/ui/TextInput';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

const carbon = themes.carbon.color;

/** The overlay that draws the border is the last child of the field. */
function frameOf(testID: string) {
  const children = screen.getByTestId(`${testID}.field`).children;
  const frame = children[children.length - 1];
  return flat(frame && typeof frame !== 'string' ? frame.props.style : undefined);
}

describe('errorFocusWidth (DQ-095)', () => {
  it.each([
    [1, size.border.focusRing],
    [1.25, size.border.focusRing],
    [1.5, size.border.inputFocus],
    [2, size.border.inputFocus],
    [3, size.border.inputFocus],
  ])('on web at pixel ratio %s the frame is %s, wide enough to differ from the resting border', (ratio, width) => {
    expect(errorFocusWidth(ratio, true)).toBe(width);
  });

  it('native draws 1.5 as it is', () => {
    expect(errorFocusWidth(1, false)).toBe(size.border.inputFocus);
  });
});

describe('TextInput', () => {
  it('shows the label above and uses it as accessible name', async () => {
    await renderUi(<TextInput label="Motorcode" placeholder="z. B. RB26DETT" testID="f" />);
    expect(screen.getByText('Motorcode')).toBeTruthy();
    expect(screen.getByTestId('f').props['aria-label']).toBe('Motorcode');
    expect(screen.getByPlaceholderText('z. B. RB26DETT')).toBeTruthy();
  });

  it('has the field metrics: 52 min height, 1 control border that becomes 1.5 text.primary on focus', async () => {
    await renderUi(<TextInput label="Motor" testID="f" />);
    const field = flat(screen.getByTestId('f.field').props.style);
    expect(field.minHeight).toBe(size.input);
    expect(field.borderRadius).toBe(8);
    expect(frameOf('f').borderWidth).toBe(1);
    expect(frameOf('f').borderColor).toBe(carbon.border.control);
    await fireEvent(screen.getByTestId('f'), 'focus');
    expect(frameOf('f').borderWidth).toBe(1.5);
    expect(frameOf('f').borderColor).toBe(carbon.text.primary);
    await fireEvent(screen.getByTestId('f'), 'blur');
    expect(frameOf('f').borderWidth).toBe(1);
  });

  it('error: border, icon and text, an alert, and it replaces the helper', async () => {
    await renderUi(<TextInput label="Hubraum" helper="In Kubikzentimetern" error="Pflichtfeld" testID="f" />);
    expect(screen.queryByText('In Kubikzentimetern')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('f.error')).toBeTruthy();
    expect(screen.getByTestId('f').props['aria-invalid']).toBe(true);
    expect(frameOf('f').borderColor).toBe(carbon.accent.fg);
  });

  it('shows the helper and the unit suffix', async () => {
    await renderUi(<TextInput label="Hubraum" helper="Auf ganze Zahlen runden" suffix="cm³" testID="f" />);
    expect(screen.getByText('cm³')).toBeTruthy();
    expect(screen.getByText('Auf ganze Zahlen runden')).toBeTruthy();
    expect(screen.getByTestId('f').props['aria-label']).toBe('Hubraum (cm³)');
  });

  it('secure: the toggle shows and hides with the common labels', async () => {
    await renderUi(<TextInput label="Passwort" secure testID="f" />);
    expect(screen.getByTestId('f').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Passwort anzeigen' }));
    expect(screen.getByTestId('f').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: 'Passwort verbergen' })).toBeTruthy();
  });

  it('disabled is not editable and reports aria-disabled', async () => {
    await renderUi(<TextInput label="Motor" disabled testID="f" />);
    expect(screen.getByTestId('f').props.editable).toBe(false);
    expect(screen.getByTestId('f').props['aria-disabled']).toBe(true);
  });

  it('multiline caps the height at maxRows: 3 rows of text, the 12 above and below outside the scrolling text (DQ-153)', async () => {
    await renderUi(<TextInput label="Notizen" multiline maxRows={3} testID="f" />);
    const input = screen.getByTestId('f');
    expect(input.props.multiline).toBe(true);
    const text = flat(input.props.style);
    expect(text.maxHeight).toBe(24 * 3);
    expect(text.paddingTop ?? text.paddingVertical ?? text.padding).toBe(0);
    // The field's box around the text carries the padding, so the cap is still 3 × 24 + 2 × 12.
    const box = screen.getByTestId('f.field').children[0];
    expect(flat(box && typeof box !== 'string' ? box.props.style : undefined).paddingVertical).toBe(12);
  });

  it('forwards the ref', async () => {
    const ref = createRef<ComponentRef<typeof RNTextInput>>();
    await renderUi(<TextInput ref={ref} label="Motor" />);
    expect(ref.current).toBeTruthy();
  });

  it('works inside a React Hook Form Controller', async () => {
    let submitted: { engine: string } | undefined;
    function Form() {
      const { control, handleSubmit } = useForm({ defaultValues: { engine: 'RB26' } });
      return (
        <>
          <Controller
            control={control}
            name="engine"
            render={({ field }) => (
              <TextInput
                ref={field.ref}
                label="Motor"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                testID="f"
              />
            )}
          />
          <TextInput
            label="Absenden"
            testID="send"
            onFocus={() => {
              void handleSubmit((values) => {
                submitted = values;
              })();
            }}
          />
        </>
      );
    }
    await renderUi(<Form />);
    expect(screen.getByTestId('f').props.value).toBe('RB26');
    await fireEvent.changeText(screen.getByTestId('f'), '2JZ');
    expect(screen.getByTestId('f').props.value).toBe('2JZ');
    await fireEvent(screen.getByTestId('send'), 'focus');
    expect(submitted).toEqual({ engine: '2JZ' });
  });
});
