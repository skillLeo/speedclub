import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { TextInput } from '@/ui';

import { useFieldMessage } from '../forms';

export type SecondFactorFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: Path<T>;
  onSubmit?: () => void;
  onChange?: () => void;
  disabled?: boolean;
  testID: string;
};

/**
 * SEC-P2-07: the current code from the authenticator app, or a recovery code, with the password of SET-03 and SET-04 when two-factor
 * is on. Same field as the re-authentication sheet: one-time-code autofill, no capitals forced on the digits, no spellcheck.
 */
export function SecondFactorField<T extends FieldValues>({ control, name, onSubmit, onChange, disabled, testID }: SecondFactorFieldProps<T>) {
  const { t } = useTranslation('settings');
  const fieldMessage = useFieldMessage();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextInput
          ref={field.ref}
          value={typeof field.value === 'string' ? field.value : ''}
          onChangeText={(next) => {
            field.onChange(next);
            onChange?.();
          }}
          onBlur={field.onBlur}
          label={t('reauth.code')}
          helper={t('reauth.codeHelper')}
          error={fieldMessage(fieldState.error)}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType={onSubmit ? 'go' : 'next'}
          onSubmitEditing={onSubmit}
          disabled={disabled}
          testID={testID}
        />
      )}
    />
  );
}
