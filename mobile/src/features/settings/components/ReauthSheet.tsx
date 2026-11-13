import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { createStyles } from '@/theme';
import { Button, Sheet, Text, TextInput } from '@/ui';

import { asksForSecondFactor, isSecondFactorLocked, useFailureMessage, useFieldMessage } from '../forms';
import { reauthSchema, type ReauthValues } from '../schemas';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], paddingBottom: t.space[16] },
}));

export type ReauthSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Why the password is asked for, in one sentence. */
  body: string;
  confirmLabel: string;
  /** Two-factor is on: the code field shows from the start. A server that asks for it shows it later. */
  needsCode?: boolean;
  /** Throws the API's error: 422 lands on its field, anything else in the notice. */
  onConfirm: (values: { password: string; code?: string }) => Promise<void>;
  testID: string;
};

/**
 * Password again, plus the second factor when two-factor is on, before a step that hands out data or changes access (SET-05,
 * SET-12).
 */
export function ReauthSheet({ visible, onClose, title, body, confirmLabel, needsCode = false, onConfirm, testID }: ReauthSheetProps) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const fieldMessage = useFieldMessage();
  const failure = useFailureMessage();
  const [askCode, setAskCode] = useState(needsCode);
  const [notice, setNotice] = useState<string | null>(null);
  /** The second factor is locked: the button rests until a field changes. */
  const [locked, setLocked] = useState(false);
  const schema = useMemo(() => reauthSchema(askCode || needsCode), [askCode, needsCode]);
  const { control, handleSubmit, reset, setError, formState } = useForm<ReauthValues>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    defaultValues: { password: '', code: '' },
  });

  /** Every way out empties the fields: a password never waits in memory for the next opening. */
  const clear = () => {
    reset({ password: '', code: '' });
    setNotice(null);
    setLocked(false);
    setAskCode(needsCode);
  };
  const close = () => {
    clear();
    onClose();
  };

  const submit = handleSubmit(async (values) => {
    setNotice(null);
    const code = values.code.replace(/\s/g, '');
    try {
      await onConfirm({ password: values.password, ...(code ? { code } : {}) });
      clear();
    } catch (error) {
      if (isSecondFactorLocked(error)) {
        setLocked(true);
        setNotice(t('reauth.locked'));
      } else if (asksForSecondFactor(error) && !askCode && !code) {
        setAskCode(true);
        setNotice(t('reauth.codeNeeded'));
      } else if (error instanceof ApiError) {
        setNotice(applyServerErrors(error, setError, { password: 'password', code: 'code' }));
      } else {
        setNotice(failure(error));
      }
    }
  });
  const busy = formState.isSubmitting;

  return (
    <Sheet
      visible={visible}
      onClose={busy ? () => undefined : close}
      title={title}
      dismissable={!busy}
      expandable={false}
      testID={testID}
      footer={<Button label={confirmLabel} size="l" fullWidth loading={busy} disabled={locked} onPress={() => void submit()} testID={`${testID}.confirm`} />}
    >
      <View style={styles.body}>
        <Text variant="body" color="text.secondary">
          {body}
        </Text>
        {notice ? (
          <FormNotice message={notice} tone={notice === t('reauth.locked') ? 'info' : 'error'} testID={`${testID}.notice`} />
        ) : null}
        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              value={field.value}
              onChangeText={(next) => {
                field.onChange(next);
                setLocked(false);
              }}
              onBlur={field.onBlur}
              label={t('reauth.password')}
              error={fieldMessage(fieldState.error)}
              secure
              autoComplete="current-password"
              textContentType="password"
              returnKeyType={askCode ? 'next' : 'go'}
              onSubmitEditing={askCode ? undefined : () => void submit()}
              disabled={busy}
              testID={`${testID}.password`}
            />
          )}
        />
        {askCode ? (
          <Controller
            control={control}
            name="code"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                value={field.value}
                onChangeText={(next) => {
                  field.onChange(next);
                  setLocked(false);
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
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                disabled={busy}
                testID={`${testID}.code`}
              />
            )}
          />
        ) : null}
      </View>
    </Sheet>
  );
}
