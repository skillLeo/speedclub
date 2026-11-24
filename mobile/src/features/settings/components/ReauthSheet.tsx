import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useMe } from '@/api/queries/auth';
import { isReauthCancelled } from '@/api/queries/recentAuth';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { useSingleFlight } from '@/lib/useSingleFlight';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { TextInput } from '@/ui/TextInput';

import { hasPassword } from '../account';
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
  /** The same sentence without the password, for a passwordless member (client round 6, L1); `body` when it does not name one. */
  bodyWithoutPassword?: string;
  confirmLabel: string;
  /** Two-factor is on: the code field shows from the start. A server that asks for it shows it later. */
  needsCode?: boolean;
  /** Throws the API's error: 422 lands on its field, anything else in the notice. */
  onConfirm: (values: { password: string; code?: string }) => Promise<void>;
  testID: string;
};

/**
 * Password again, plus the second factor when two-factor is on, before a step that hands out data or changes access (SET-05,
 * SET-12). A passwordless member (Me `password_set: false`) sees no password field: the sheet sends `password: ''` and the call's
 * withRecentAuth asks for recent authentication (the REAUTH sheet) when the server wants it (client round 6, L1).
 */
export function ReauthSheet({ visible, onClose, title, body, bodyWithoutPassword, confirmLabel, needsCode = false, onConfirm, testID }: ReauthSheetProps) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const fieldMessage = useFieldMessage();
  const failure = useFailureMessage();
  const { data: me } = useMe();
  const passwordSet = hasPassword(me);
  const [askCode, setAskCode] = useState(needsCode);
  const [notice, setNotice] = useState<string | null>(null);
  /** The second factor is locked: the button rests until a field changes. */
  const [locked, setLocked] = useState(false);
  const schema = useMemo(() => reauthSchema(askCode || needsCode, passwordSet), [askCode, needsCode, passwordSet]);
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

  const submit = useSingleFlight(handleSubmit(async (values) => {
    setNotice(null);
    const code = values.code.replace(/\s/g, '');
    try {
      await onConfirm({ password: passwordSet ? values.password : '', ...(code ? { code } : {}) });
      clear();
    } catch (error) {
      // The member closed the REAUTH sheet: nothing happened, so nothing is said; this sheet stays for another try.
      if (isReauthCancelled(error)) return;
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
  }));
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
          {passwordSet ? body : (bodyWithoutPassword ?? body)}
        </Text>
        {passwordSet ? null : (
          <Text variant="callout" color="text.secondary" testID={`${testID}.noPassword`}>
            {t('reauth.noPassword')}
          </Text>
        )}
        {notice ? (
          <FormNotice message={notice} tone={notice === t('reauth.locked') ? 'info' : 'error'} testID={`${testID}.notice`} />
        ) : null}
        {passwordSet ? (
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
        ) : null}
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
