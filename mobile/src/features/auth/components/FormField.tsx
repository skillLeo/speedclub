import type { ComponentRef, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import type { TextInput as RNTextInput } from 'react-native';

import { isWeb } from '@/lib/platform';
import { TextInput, type TextInputProps } from '@/ui';

import { fieldMessage } from '../forms';

type InputRef = ComponentRef<typeof RNTextInput>;

type Props<T extends FieldValues> = Omit<TextInputProps, 'value' | 'onChangeText' | 'onBlur' | 'error' | 'ref'> & {
  control: Control<T>;
  name: Path<T>;
  /** For moving on from the field before: React Hook Form keeps the field's own ref for focusing errors. */
  inputRef?: RefObject<InputRef | null>;
  /**
   * Web: the `inputmode` attribute, set on the element itself. react-native-web turns an `inputMode` prop into a matching `type`
   * as well, and for an e-mail field that type is what SEC-S-06 must avoid (see EMAIL_INPUT).
   */
  webInputMode?: 'email';
};

/** The DOM element behind a TextInput on web. */
type WebElement = { setAttribute?: (name: string, value: string) => void };

/** A TextInput bound to React Hook Form. */
export function FormField<T extends FieldValues>({ control, name, inputRef, webInputMode, ...input }: Props<T>) {
  const { t } = useTranslation('auth');
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextInput
          {...input}
          ref={(node) => {
            // React leaves an attribute alone that no prop names, so this stays across renders.
            if (isWeb && webInputMode && node) (node as unknown as WebElement).setAttribute?.('inputmode', webInputMode);
            field.ref(node);
            if (inputRef) inputRef.current = node;
          }}
          value={field.value as string}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldMessage(t, fieldState.error)}
        />
      )}
    />
  );
}

/**
 * The attributes an e-mail field needs for the right keyboard and autofill.
 *
 * SEC-S-06, web: the field is `type="text"` with `inputmode="email"`, never `type="email"`. Chromium's e-mail field converts the
 * domain itself, transitionally, so `straße.de` left the browser as `strasse.de`, another domain and another account; every client
 * now sends what was typed and the server's mapping (ADR-183) is the only one. The keyboard (`inputmode`), autofill
 * (`autocomplete="email"`), no capitals and no spell check stay. Native keeps its e-mail keyboard.
 */
export const EMAIL_INPUT = isWeb
  ? ({
      autoCapitalize: 'none',
      autoCorrect: false,
      spellCheck: false,
      // react-native-web renders `default` as type="text", and sets no inputmode of its own.
      keyboardType: 'default',
      autoComplete: 'email',
      webInputMode: 'email',
    } as const)
  : ({
      autoCapitalize: 'none',
      autoCorrect: false,
      spellCheck: false,
      keyboardType: 'email-address',
      inputMode: 'email',
      autoComplete: 'email',
      textContentType: 'emailAddress',
    } as const);
