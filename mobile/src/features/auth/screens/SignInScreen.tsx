import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View, type TextInput as RNTextInput } from 'react-native';

import { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { useLogin } from '@/api/queries/auth';
import { Button } from '@/ui';

import { AuthScreen, FooterLink } from '../components/AuthScreen';
import { EMAIL_INPUT, FormField } from '../components/FormField';
import { FormNotice } from '../components/FormNotice';
import { handEmailTo, useHandedEmail } from '../emailHandoff';
import { armPasskeyOffer, disarmPasskeyOffer } from '../passkeyOffer';
import { holdTwoFactorChallenge } from '../twoFactorChallenge';
import { applyServerErrors, formatWait, isCode, onlyEmailDirty, useCountdown, useLeaveForm, useReturnToParam } from '../forms';
import { signInSchema, type SignInValues } from '../schemas';

/** AUTH-03. A wrong password and an unknown address read the same; a success ends in SessionHost, not here. */
export function SignInScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; returnTo?: string; next?: string }>();
  useReturnToParam(params);
  const handedEmail = useHandedEmail('/sign-in', params.email);
  const passwordRef = useRef<ComponentRef<typeof RNTextInput>>(null);
  const login = useLogin();
  const passkeysOn = useFlag('auth.passkeys');
  const [notice, setNotice] = useState<string | null>(null);
  const wait = useCountdown();
  const { leaving, leave } = useLeaveForm();

  const { control, handleSubmit, setError, getValues, formState } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    mode: 'onTouched',
    defaultValues: { email: handedEmail ?? '', password: '' },
  });
  // Read during render: React Hook Form only tracks the parts of formState that render reads.
  const { isDirty, dirtyFields } = formState;

  const onSubmit = handleSubmit(async (values) => {
    setNotice(null);
    // M4.6 AUTH-14: a device that can hold a passkey gets the offer after this sign-in.
    await armPasskeyOffer(passkeysOn);
    try {
      const answer = await login.mutateAsync(values);
      if (answer.kind === 'two_factor') {
        // AUTH-11: the challenge waits in memory; the form goes without asking, as after any sign-in.
        holdTwoFactorChallenge(answer.challenge, answer.expiresIn);
        leave('/two-factor');
      }
    } catch (error) {
      disarmPasskeyOffer();
      if (isCode(error, 'password_change_required')) {
        // A mandatory way on (ADR-137): whatever was typed, nothing asks.
        handEmailTo('/reset-password', values.email);
        leave({ pathname: '/reset-password', params: { forced: '1' } });
      } else if (isCode(error, 'invalid_credentials')) {
        setNotice(t('signIn.invalid'));
      } else if (error instanceof ApiError && error.kind === 'rate_limited') {
        wait.restart(error.retryAfter ?? 60);
        setNotice(null);
      } else if (error instanceof ApiError) {
        setNotice(applyServerErrors(error, setError, { email: 'email', password: 'password' }));
      } else {
        setNotice(t('common.serverError'));
      }
    }
  });

  const toSignUp = () => {
    handEmailTo('/sign-up', getValues('email'));
    const target = '/sign-up';
    if (onlyEmailDirty(dirtyFields)) leave(target);
    else router.replace(target);
  };

  return (
    <AuthScreen
      routeId="AUTH-03"
      signInStep
      skeletonFields={2}
      title={t('signIn.title')}
      dirty={isDirty && !leaving && !login.isPending && !login.isSuccess}
      cta={{ label: t('signIn.submit'), onPress: () => void onSubmit(), loading: login.isPending, disabled: wait.remaining > 0 }}
      footer={
        <FooterLink text={t('signIn.noAccount')}>
          <Button
            label={t('signIn.toSignUp')}
            variant="tertiary"
            size="m"
            role="link"
            flush="start"
            onPress={toSignUp}
            testID="AUTH-03.toSignUp"
          />
        </FooterLink>
      }
    >
      {wait.remaining > 0 ? (
        <FormNotice message={t('signIn.rateLimited', { time: formatWait(t, wait.remaining) })} testID="AUTH-03.notice" />
      ) : notice ? (
        <FormNotice message={notice} testID="AUTH-03.notice" />
      ) : null}
      <FormField
        control={control}
        name="email"
        label={t('fields.email')}
        {...EMAIL_INPUT}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
        testID="AUTH-03.email"
      />
      <View>
        <FormField
          control={control}
          name="password"
          label={t('fields.password')}
          secure
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
          testID="AUTH-03.password"
          inputRef={passwordRef}
        />
        <Button
          label={t('signIn.forgot')}
          variant="tertiary"
          size="m"
          role="link"
          flush="end"
          onPress={() => {
            handEmailTo('/forgot-password', getValues('email'));
            router.push('/forgot-password');
          }}
          testID="AUTH-03.forgot"
        />
      </View>
    </AuthScreen>
  );
}
