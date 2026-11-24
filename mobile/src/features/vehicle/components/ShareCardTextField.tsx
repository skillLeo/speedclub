import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { TextInput } from '@/ui/TextInput';

import { SHARE_CARD_TEXT_MAX, shareCardTextSchema } from '../shareCardOptions';

const schema = z.object({ text: shareCardTextSchema });
type Values = z.infer<typeof schema>;

export type ShareCardTextFieldProps = {
  value: string;
  onChange: (text: string) => void;
  /** The server's 422 message on `text` (an emoji it caught, or a keyword rule). */
  serverError: string | null;
  disabled?: boolean;
  routeId: string;
};

/**
 * R5-2e VEH-07: the member's own line on the card, one line of at most 60 characters with a counter. The card fonts' characters are
 * checked as the member types (shareCardTextSchema); what only the server knows (the keyword rules) comes back as 422 on `text` and
 * is shown on the field.
 */
export function ShareCardTextField({ value, onChange, serverError, disabled = false, routeId }: ShareCardTextFieldProps) {
  const { t } = useTranslation('vehicle');
  const form = useForm<Values>({ defaultValues: { text: value }, resolver: zodResolver(schema), mode: 'onChange' });
  const { reset, setError, getValues } = form;

  // "Standard" clears the line from outside.
  useEffect(() => {
    if (getValues('text') !== value) reset({ text: value });
  }, [getValues, reset, value]);

  useEffect(() => {
    if (serverError) setError('text', { type: 'server', message: serverError });
  }, [serverError, setError]);

  return (
    <Controller
      control={form.control}
      name="text"
      render={({ field, fieldState }) => {
        const message = fieldState.error?.message;
        const error = message ? (message.startsWith('shareCard.') ? t(message, { max: SHARE_CARD_TEXT_MAX }) : message) : undefined;
        return (
          <TextInput
            ref={field.ref}
            label={t('shareCard.ownText')}
            placeholder={t('shareCard.textPlaceholder')}
            value={field.value}
            onChangeText={(next) => {
              // One line: a pasted line break becomes a space.
              const line = next.replace(/[\r\n]+/g, ' ');
              field.onChange(line);
              onChange(line);
            }}
            onBlur={field.onBlur}
            maxLength={SHARE_CARD_TEXT_MAX}
            autoCorrect
            returnKeyType="done"
            helper={error ? undefined : t('shareCard.textCount', { count: [...field.value.trim()].length, max: SHARE_CARD_TEXT_MAX })}
            error={error}
            disabled={disabled}
            testID={`${routeId}.text`}
          />
        );
      }}
    />
  );
}
