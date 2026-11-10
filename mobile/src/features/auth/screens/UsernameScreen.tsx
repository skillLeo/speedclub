import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useChooseUsername, useSignOut, useUsernameCheck, type UsernameReason } from '@/api/queries/auth';
import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';
import { Button, Icon, Text, TextInput } from '@/ui';

import { AuthScreen } from '../components/AuthScreen';
import { FormNotice } from '../components/FormNotice';
import { RuleList } from '../components/RuleList';
import { applyServerErrors, fieldMessage, useDebouncedValue } from '../forms';
import { profileUrlPreview } from '../links';
import { normalizeUsername, usernameSchema, usernameViolations, USERNAME_MAX_LENGTH, type UsernameValues } from '../schemas';

/** Long enough that typing a name in one go asks once. */
const CHECK_DEBOUNCE_MS = 300;

const useStyles = createStyles((t) => ({
  field: { gap: t.space[8] },
  available: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
  preview: { flexShrink: 1 },
}));

function browserHost(): string | undefined {
  return isWeb && typeof window !== 'undefined' ? window.location?.host : undefined;
}

/** AUTH-08. Asks while typing; the server's word on sending decides. */
export function UsernameScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const choose = useChooseUsername();
  const signOut = useSignOut();
  const [notice, setNotice] = useState<string | null>(null);

  const { control, handleSubmit, setError, formState } = useForm<UsernameValues>({
    resolver: zodResolver(usernameSchema),
    mode: 'onChange',
    defaultValues: { username: '' },
  });
  const value = useWatch({ control, name: 'username' });
  const normalized = normalizeUsername(value);
  const debounced = useDebouncedValue(normalized, CHECK_DEBOUNCE_MS);
  const violations = usernameViolations(normalized);
  const checkable = violations.length === 0 && normalized === debounced ? normalized : null;
  const check = useUsernameCheck(checkable);

  const reason: UsernameReason | null = check.data && check.data.username === checkable ? check.data.reason : null;
  const available = Boolean(checkable && check.data?.username === checkable && check.data.available);
  // Local rules and the server's answer share one field. The server's own message on sending replaces both.
  const reasonText = reason ? t(`username.reason.${reason}`) : undefined;

  const onSubmit = handleSubmit(async ({ username }) => {
    setNotice(null);
    try {
      await choose.mutateAsync(normalizeUsername(username));
    } catch (error) {
      setNotice(error instanceof ApiError ? applyServerErrors(error, setError, { username: 'username' }) : t('common.serverError'));
    }
  });

  return (
    <AuthScreen
      routeId="AUTH-08"
      title={t('username.title')}
      subtitle={t('username.subtitle')}
      skeletonFields={1}
      onBack={null}
      headerTrailing={
        <Button
          label={t('common.signOut')}
          variant="tertiary"
          size="m"
          loading={signOut.isPending}
          onPress={() => signOut.mutate()}
          testID="AUTH-08.signOut"
        />
      }
      cta={{ label: t('username.submit'), onPress: () => void onSubmit(), loading: choose.isPending }}
    >
      {notice ? <FormNotice message={notice} testID="AUTH-08.notice" /> : null}
      <View style={styles.field}>
        <Controller
          control={control}
          name="username"
          render={({ field, fieldState }) => (
            <TextInput
              ref={field.ref}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              label={t('username.label')}
              error={
                fieldState.error?.type === 'server' || (formState.isSubmitted && fieldState.error)
                  ? fieldMessage(t, fieldState.error)
                  : reasonText
              }
              loading={check.isFetching}
              autoCapitalize="none"
              autoCorrect={false}
              // Android's hint for a new name; the web has no such token (axe autocomplete-valid), only `username`.
              autoComplete={isWeb ? 'username' : 'username-new'}
              textContentType="username"
              spellCheck={false}
              maxLength={USERNAME_MAX_LENGTH}
              returnKeyType="go"
              onSubmitEditing={() => void onSubmit()}
              testID="AUTH-08.username"
            />
          )}
        />
        {available ? (
          <View style={styles.available} role="status" testID="AUTH-08.available">
            <Icon name="check" size={16} color="status.success" />
            <Text variant="helper" color="status.success">
              {t('username.available')}
            </Text>
          </View>
        ) : null}
        {check.isError && checkable ? (
          <Text variant="helper" color="text.secondary" role="status" testID="AUTH-08.checkFailed">
            {t('username.checkFailed')}
          </Text>
        ) : null}
        {normalized ? (
          <Text variant="supporting" color="text.secondary" hyphenate={false} style={styles.preview} testID="AUTH-08.preview">
            {profileUrlPreview(normalized, process.env.EXPO_PUBLIC_WEB_URL, browserHost())}
          </Text>
        ) : null}
      </View>
      <RuleList
        testID="AUTH-08.rules"
        rules={[
          { key: 'length', label: t('username.rules.length'), met: normalized ? !violations.includes('length') : false },
          { key: 'characters', label: t('username.rules.characters'), met: normalized ? !violations.includes('characters') : false },
          {
            key: 'shape',
            label: t('username.rules.shape'),
            met: normalized ? !violations.some((violation) => ['start', 'trailing_dot', 'consecutive_dots'].includes(violation)) : false,
          },
        ]}
      />
    </AuthScreen>
  );
}
