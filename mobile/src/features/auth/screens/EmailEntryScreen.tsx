import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { errorNumber } from '@/api/queries/errorDetails';
import { fetchPasskeySignInOptions, usePasskeySignIn, useStartEmailCode } from '@/api/queries/passwordless';
import { isWeb } from '@/lib/platform';
import { Button, SkeletonText, Text } from '@/ui';

import { useAuthFlags } from '../authFlags';
import { AuthScreen, AuthSkeletonLink } from '../components/AuthScreen';
import { EMAIL_INPUT, FormField } from '../components/FormField';
import { FormNotice } from '../components/FormNotice';
import { handEmailTo, useHandedEmail } from '../emailHandoff';
import { attemptFrom, holdEmailAttempt, newAttemptId } from '../emailAttempt';
import { applyServerErrors, formatWait, useCountdown, useLeaveForm, useReturnToParam } from '../forms';
import { conditionalMediationAvailable, getPasskey, isPasskeyCancelled } from '../providers/passkeys';
import { useAnswerRouting } from '../providers/useProviderSignIn';
import { emailEntrySchema, type EmailEntryValues } from '../schemas';

/**
 * Web: the passkey offer inside the e-mail field's autofill (conditional mediation, 09 §8.2). The field's autocomplete names
 * `webauthn`, and a pending `navigator.credentials.get({ mediation: 'conditional' })` fills it. Aborted when the screen leaves.
 */
function useConditionalPasskey(enabled: boolean): void {
  const passkey = usePasskeySignIn();
  const route = useAnswerRouting();
  const { mutateAsync } = passkey;
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        if (!(await conditionalMediationAvailable())) return;
        const options = await fetchPasskeySignInOptions(controller.signal);
        const credential = await getPasskey(options.options, { conditional: true, signal: controller.signal });
        route(await mutateAsync({ ceremonyId: options.ceremony_id, credential }));
      } catch (error) {
        // The autofill is an offer: a cancel or a stale ceremony leaves the form as it is.
        if (!isPasskeyCancelled(error) && !controller.signal.aborted) console.warn('Passkey autofill ended', error);
      }
    })();
    return () => controller.abort();
    // `route` and the mutation are stable for the screen's life; the offer starts once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

/** Web: react-native-web hands `autoComplete` to the element as is, so the token list reaches the browser. */
const WEB_PASSKEY_AUTOCOMPLETE = 'username webauthn' as 'username';

/**
 * AUTH-12 (09 §7.2): the passwordless start. The answer never says whether the address has an account (always 202); a code goes
 * out, and AUTH-13 takes it. "Mit Passwort anmelden" leads to AUTH-03 while `auth.password_login` is on.
 */
export function EmailEntryScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; returnTo?: string; next?: string }>();
  useReturnToParam(params);
  const handedEmail = useHandedEmail('/auth/email', params.email);
  const start = useStartEmailCode();
  const { passwordLogin } = useAuthFlags();
  const passkeysOn = useFlag('auth.passkeys');
  const [notice, setNotice] = useState<string | null>(null);
  const wait = useCountdown();
  const { leaving, leave } = useLeaveForm();
  useConditionalPasskey(isWeb && passkeysOn);

  const { control, handleSubmit, setError, getValues, formState } = useForm<EmailEntryValues>({
    resolver: zodResolver(emailEntrySchema),
    mode: 'onTouched',
    defaultValues: { email: handedEmail ?? '' },
  });
  const { isDirty } = formState;

  const onSubmit = handleSubmit(async ({ email }) => {
    setNotice(null);
    const attemptId = newAttemptId();
    try {
      const started = await start.mutateAsync({ email, attemptId });
      holdEmailAttempt(attemptFrom(started.attempt_id, email, started.resend_after));
      leave('/auth/code');
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'rate_limited') {
        wait.restart(errorNumber(error, 'retry_after') ?? error.retryAfter ?? 60);
      } else if (error instanceof ApiError) {
        setNotice(applyServerErrors(error, setError, { email: 'email' }));
      } else {
        setNotice(t('common.serverError'));
      }
    }
  });

  const toPassword = () => {
    handEmailTo('/sign-in', getValues('email'));
    router.push('/sign-in');
  };

  return (
    <AuthScreen
      routeId="AUTH-12"
      title={t('email.title')}
      // DQ-1003: one field, the 2-line caption and the password link, as the loaded screen.
      skeletonFields={1}
      skeletonAfter={
        <>
          <SkeletonText variant="callout" lines={2} />
          {passwordLogin ? <AuthSkeletonLink /> : null}
        </>
      }
      titleVariant="title2"
      dirty={isDirty && !leaving && !start.isPending && !start.isSuccess}
      cta={{
        label: t('email.submit'),
        onPress: () => void onSubmit(),
        loading: start.isPending,
        disabled: wait.remaining > 0,
      }}
      footer={
        passwordLogin ? (
          <Button
            label={t('email.withPassword')}
            variant="tertiary"
            size="m"
            role="link"
            flush="start"
            onPress={toPassword}
            testID="AUTH-12.withPassword"
          />
        ) : null
      }
    >
      {wait.remaining > 0 ? (
        <FormNotice message={t('email.rateLimited', { time: formatWait(t, wait.remaining) })} testID="AUTH-12.notice" />
      ) : notice ? (
        <FormNotice message={notice} testID="AUTH-12.notice" />
      ) : null}
      <FormField
        control={control}
        name="email"
        label={t('fields.email')}
        {...EMAIL_INPUT}
        {...(isWeb && passkeysOn ? { autoComplete: WEB_PASSKEY_AUTOCOMPLETE } : {})}
        returnKeyType="send"
        onSubmitEditing={() => void onSubmit()}
        submitBehavior="submit"
        testID="AUTH-12.email"
      />
      <Text variant="callout" color="text.secondary" testID="AUTH-12.caption">
        {t('email.caption')}
      </Text>
    </AuthScreen>
  );
}
