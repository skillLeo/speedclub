import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { meKey, type Me } from '@/api/queries/auth';
import { CodeInput } from '@/features/auth/components/CodeInput';
import { EMAIL_INPUT, FormField } from '@/features/auth/components/FormField';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors, breakableEmail, isCode } from '@/features/auth/forms';
import { createStyles, size } from '@/theme';
import { Button, Skeleton, SkeletonBlock, SkeletonText, Text, TextInput, toast } from '@/ui';

import { useMemberGate } from '../components/MemberGate';
import { RestrictionNotice } from '../components/RestrictionNotice';
import { SecondFactorField } from '../components/SecondFactorField';
import { SettingsPage } from '../components/SettingsPage';
import { isSecondFactorLocked, useFailureMessage, useFieldMessage } from '../forms';
import { useConfirmEmailChange, useRequestEmailChange } from '@/api/queries/settings';
import { changeEmailSchema, codeSchema, type ChangeEmailValues, type CodeValues } from '../schemas';

const ROUTE = 'SET-03';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16] },
  field: { gap: t.space[8] },
}));

function EmailSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.body}>
        <SkeletonText variant="body" lines={2} />
        {[0, 1].map((index) => (
          <View key={index} style={styles.field}>
            <SkeletonText variant="labelS" width="30%" />
            <SkeletonBlock height={size.input} corner="sm" />
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

type Step = { kind: 'address' } | { kind: 'code'; email: string };

/**
 * SET-03 /settings/account/email. Step one: the new address and the password. The answer is neutral whatever the address
 * (contract §1); a code goes to the new address. Step two: the six digits switch it, and the old address hears of it. The new
 * address lives in this screen's memory only. With two-factor on, step one also asks for the current code (SEC-P2-07); a server that
 * asks for it although Me said off (switched on elsewhere meanwhile) shows the field with its message.
 */
function ChangeEmailForm({ me }: { me: Me }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const client = useQueryClient();
  const fieldMessage = useFieldMessage();
  const failure = useFailureMessage();
  const request = useRequestEmailChange();
  const confirm = useConfirmEmailChange();
  const [step, setStep] = useState<Step>({ kind: 'address' });
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [askCode, setAskCode] = useState(me.two_factor_enabled);
  /** The second factor is locked (ADR-203 f): the button rests until a field changes. */
  const [locked, setLocked] = useState(false);
  const schema = useMemo(() => changeEmailSchema(me.email, askCode), [askCode, me.email]);

  const address = useForm<ChangeEmailValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', code: '' },
  });
  const code = useForm<CodeValues>({ resolver: zodResolver(codeSchema), mode: 'onSubmit', defaultValues: { code: '' } });

  // After a success the guard is off before leaving: this effect runs after the guard's own in the same commit.
  useEffect(() => {
    if (!done) return;
    if (router.canGoBack()) router.back();
    else router.replace('/settings/account');
  }, [done, router]);

  const sendCode = address.handleSubmit(async (values) => {
    setNotice(null);
    const secondFactor = (values.code ?? '').replace(/\s/g, '');
    try {
      await request.mutateAsync({ email: values.email.trim(), password: values.password, ...(secondFactor ? { code: secondFactor } : {}) });
      address.resetField('password');
      address.resetField('code');
      setStep({ kind: 'code', email: values.email.trim() });
    } catch (error) {
      if (isSecondFactorLocked(error)) {
        setLocked(true);
        setNotice(t('reauth.locked'));
        return;
      }
      if (isCode(error, 'two_factor_code_required')) setAskCode(true);
      setNotice(
        error instanceof ApiError
          ? applyServerErrors(error, address.setError, { email: 'email', password: 'password', code: 'code' })
          : failure(error),
      );
    }
  });

  const confirmCode = code.handleSubmit(async (values) => {
    if (confirm.isPending) return;
    setNotice(null);
    try {
      await confirm.mutateAsync(values.code);
      await client.invalidateQueries({ queryKey: meKey });
      toast(t('email.changed'), { haptic: 'success', testID: `${ROUTE}.changed` });
      setDone(true);
    } catch (error) {
      if (isCode(error, 'invalid_code')) {
        code.setValue('code', '');
        code.setError('code', { type: 'server', message: t('email.invalidCode') }, { shouldFocus: true });
      } else if (error instanceof ApiError) {
        setNotice(applyServerErrors(error, code.setError, { code: 'code' }));
      } else {
        setNotice(failure(error));
      }
    }
  });

  const dirty = !done && (step.kind === 'code' || address.formState.isDirty) && !request.isPending && !confirm.isPending;

  if (step.kind === 'code') {
    return (
      <SettingsPage
        routeId={ROUTE}
        title={t('email.title')}
        fallback="/settings/account"
        offlineLabel={t('offlineForm')}
        section="account"
        form={{ dirty, cta: { label: t('email.confirm'), onPress: () => void confirmCode(), loading: confirm.isPending } }}
      >
        <View style={styles.body}>
          <RestrictionNotice routeId={ROUTE} />
          <Text variant="body" color="text.secondary" testID={`${ROUTE}.sentTo`}>
            {t('email.sentTo', { email: breakableEmail(step.email) })}
          </Text>
          {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
          <Controller
            control={code.control}
            name="code"
            render={({ field, fieldState }) => (
              <CodeInput
                ref={field.ref}
                value={field.value}
                onChange={(next) => {
                  field.onChange(next);
                  if (fieldState.error) code.clearErrors('code');
                }}
                onComplete={() => void confirmCode()}
                onBlur={field.onBlur}
                label={t('email.codeLabel')}
                error={fieldMessage(fieldState.error)}
                disabled={confirm.isPending}
                autoFocus
                testID={`${ROUTE}.code`}
              />
            )}
          />
          <Text variant="supporting" color="text.secondary">
            {t('email.codeHint')}
          </Text>
          <Button
            label={t('email.otherAddress')}
            variant="tertiary"
            size="m"
            flush="start"
            onPress={() => {
              code.reset({ code: '' });
              setNotice(null);
              setStep({ kind: 'address' });
            }}
            testID={`${ROUTE}.otherAddress`}
          />
        </View>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      routeId={ROUTE}
      title={t('email.title')}
      fallback="/settings/account"
      offlineLabel={t('offlineForm')}
      section="account"
      form={{
        dirty,
        cta: { label: t('email.sendCode'), onPress: () => void sendCode(), loading: request.isPending, disabled: locked },
      }}
    >
      <View style={styles.body}>
        <RestrictionNotice routeId={ROUTE} />
        <Text variant="body" color="text.secondary" testID={`${ROUTE}.intro`}>
          {t('email.intro', { email: breakableEmail(me.email) })}
        </Text>
        {notice ? (
          <FormNotice message={notice} tone={locked ? 'info' : 'error'} testID={`${ROUTE}.notice`} />
        ) : null}
        <FormField
          control={address.control}
          name="email"
          label={t('email.newAddress')}
          {...EMAIL_INPUT}
          returnKeyType="next"
          testID={`${ROUTE}.email`}
        />
        <Controller
          control={address.control}
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
              label={t('email.password')}
              helper={t('email.passwordHelper')}
              error={fieldMessage(fieldState.error)}
              secure
              autoComplete="current-password"
              textContentType="password"
              returnKeyType={askCode ? 'next' : 'go'}
              onSubmitEditing={askCode ? () => address.setFocus('code') : () => void sendCode()}
              testID={`${ROUTE}.password`}
            />
          )}
        />
        {askCode ? (
          <SecondFactorField
            control={address.control}
            name="code"
            onChange={() => setLocked(false)}
            onSubmit={() => void sendCode()}
            testID={`${ROUTE}.secondFactor`}
          />
        ) : null}
      </View>
    </SettingsPage>
  );
}

export function ChangeEmailScreen() {
  const { t } = useTranslation('settings');
  const gate = useMemberGate({
    routeId: ROUTE,
    returnTo: '/settings/account/email',
    skeleton: <EmailSkeleton />,
  });
  if (gate.me) return <ChangeEmailForm me={gate.me} />;
  return (
    <SettingsPage routeId={ROUTE} title={t('email.title')} fallback="/settings/account" offlineLabel={t('offlineForm')} section="account">
      {gate.fallback}
    </SettingsPage>
  );
}
