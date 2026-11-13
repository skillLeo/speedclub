import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View, type TextInput as RNTextInput } from 'react-native';

import { ApiError } from '@/api/client';
import { endLocalSessionAfterReset, useForgotPassword, useResetPassword } from '@/api/queries/auth';
import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';
import { Button, Text, toast } from '@/ui';
import { identifierText } from '@/ui/textBreaks';

import { AuthScreen } from '../components/AuthScreen';
import { sanitizeCode } from '../code';
import { CodeInput, CodeInputSkeleton } from '../components/CodeInput';
import { EMAIL_INPUT, FormField } from '../components/FormField';
import { FormNotice } from '../components/FormNotice';
import { RuleList } from '../components/RuleList';
import { dropFragment, handEmailTo, useHandedEmail } from '../emailHandoff';
import { forgetResetLink, resetLinkFor, type ResetLink } from '../links';
import { applyServerErrors, fieldMessage, firstParam, formatClock, isCode, useCountdown } from '../forms';
import { passwordChecks, resetPasswordSchema, type ResetPasswordValues } from '../schemas';

const DEFAULT_RESEND_SECONDS = 60;

const useStyles = createStyles((t) => ({
  field: { gap: t.space[8] },
  codeLabel: { marginBottom: t.space[8] },
  resend: { alignItems: 'flex-start' },
  wait: { marginTop: -t.space[4] },
}));

/** Web: the mail link's fragment (links.ts). Native gets code and address as route parameters. */
function linkFragmentFor(routeEmail: string | undefined): ResetLink {
  if (!isWeb || typeof window === 'undefined') return {};
  return resetLinkFor(routeEmail, window.location?.hash ?? '');
}

/** AUTH-07. Also the end of a forced change (ADR-137). A reset ends every session, so sign-in follows. */
export function ResetPasswordScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; code?: string; forced?: string; resend?: string }>();
  // A native mail link's parameter, or the address AUTH-03, AUTH-05, AUTH-06 or a forced change handed over (SEC-P1-05).
  const routeEmail = useHandedEmail('/reset-password', params.email);
  const [fragment] = useState(() => linkFragmentFor(routeEmail));
  const forced = firstParam(params.forced) === '1';
  // The route's own parameters win: on native they are the mail link itself, on web a newer start than the fragment.
  const prefilledEmail = routeEmail ?? fragment.email ?? '';
  const routeCode = firstParam(params.code);
  const prefilledCode = routeCode !== undefined ? sanitizeCode(routeCode) : (fragment.code ?? '');
  const repeatRef = useRef<ComponentRef<typeof RNTextInput>>(null);
  const reset = useResetPassword();
  const forgot = useForgotPassword();
  const [notice, setNotice] = useState<string | null>(null);
  /** BH-33: the reset was for another account than the one signed in here, which stays. Then the screen goes, as it came. */
  const [keptSession, setKeptSession] = useState(false);
  const initialWait = Number(firstParam(params.resend));
  const timer = useCountdown(Number.isFinite(initialWait) && firstParam(params.resend) ? initialWait : DEFAULT_RESEND_SECONDS);

  // The code is used from now on. Once read it has no business staying in the address bar or the history. Through the
  // router: it keeps the URL of its routes and would write the fragment back on its next state change. The screen that
  // replaces this one finds the fragment again in links.ts.
  // After the render that drops the discard guard: a back the guard saw as dirty would be stopped.
  useEffect(() => {
    if (!keptSession) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [keptSession, router]);

  const hashCarriesCode = isWeb && typeof window !== 'undefined' && (window.location?.hash ?? '').includes('code=');
  useEffect(() => {
    if (hashCarriesCode && fragment.code) {
      // Out of the address bar first: a screen mounted before the router's own history write read it again (M2.8 run 3).
      dropFragment();
      router.replace({ pathname: '/reset-password', params: forced ? { forced: '1' } : {} });
    }
  }, [forced, fragment.code, hashCarriesCode, router]);

  const { control, handleSubmit, setError, getValues, clearErrors, formState } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onTouched',
    defaultValues: { email: prefilledEmail, code: prefilledCode, password: '', passwordRepeat: '' },
  });
  const password = useWatch({ control, name: 'password' });
  const email = useWatch({ control, name: 'email' });
  const checks = passwordChecks(password, email);

  const onSubmit = handleSubmit(async (values) => {
    setNotice(null);
    try {
      await reset.mutateAsync({ email: values.email, code: values.code, password: values.password });
      forgetResetLink();
      // The reset ended every session of that account. If that was this device's, signed in the app would go home and then
      // hear a 401. Another address leaves this device's session as it is.
      const session = await endLocalSessionAfterReset(values.email);
      if (session === 'kept') {
        // Signing in with the new password would first need a sign-out here, so the toast only names the account that changed.
        toast(t('reset.successOther', { email: identifierText(values.email) }), { haptic: 'success', testID: 'AUTH-07.successToast' });
        setKeptSession(true);
        return;
      }
      toast(t('reset.success'), { haptic: 'success', testID: 'AUTH-07.successToast' });
      handEmailTo('/sign-in', values.email);
      router.replace('/sign-in');
    } catch (error) {
      if (isCode(error, 'invalid_code')) {
        setError('code', { type: 'server', message: t('reset.invalidCode') }, { shouldFocus: true });
      } else if (error instanceof ApiError) {
        setNotice(applyServerErrors(error, setError, { email: 'email', code: 'code', password: 'password' }));
      } else {
        setNotice(t('common.serverError'));
      }
    }
  });

  const requestCode = async () => {
    setNotice(null);
    clearErrors('code');
    const address = getValues('email').trim();
    if (!address) {
      setError('email', { type: 'required', message: 'validation.emailRequired' }, { shouldFocus: true });
      return;
    }
    try {
      const next = await forgot.mutateAsync(address);
      timer.restart(next.resend_after_seconds ?? DEFAULT_RESEND_SECONDS);
      toast(t('reset.resent'), { testID: 'AUTH-07.resentToast' });
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : t('common.serverError'));
    }
  };

  return (
    <AuthScreen
      routeId="AUTH-07"
      title={t('reset.title')}
      subtitle={forced ? t('reset.forcedSubtitle') : t('reset.subtitle')}
      skeletonFields={2}
      skeleton={<CodeInputSkeleton />}
      dirty={formState.isDirty && !reset.isPending && !reset.isSuccess}
      cta={{ label: t('reset.submit'), onPress: () => void onSubmit(), loading: reset.isPending }}
    >
      {notice ? <FormNotice message={notice} testID="AUTH-07.notice" /> : null}
      <FormField control={control} name="email" label={t('fields.email')} {...EMAIL_INPUT} testID="AUTH-07.email" />
      <Controller
        control={control}
        name="code"
        render={({ field, fieldState }) => (
          <View>
            <Text variant="callout" color="text.secondary" style={styles.codeLabel}>
              {t('reset.codeLabel')}
            </Text>
            <CodeInput
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              label={t('reset.codeLabel')}
              error={fieldMessage(t, fieldState.error)}
              testID="AUTH-07.code"
            />
          </View>
        )}
      />
      <View style={styles.resend}>
        <Button
          label={t('verify.resend')}
          variant="tertiary"
          size="m"
          flush="start"
          disabled={timer.remaining > 0}
          loading={forgot.isPending}
          onPress={() => void requestCode()}
          testID="AUTH-07.resend"
        />
        {timer.remaining > 0 ? (
          <Text variant="caption" color="text.tertiary" style={styles.wait} testID="AUTH-07.resendWait">
            {t('verify.resendWait', { time: formatClock(timer.remaining) })}
          </Text>
        ) : null}
      </View>
      <View style={styles.field}>
        <FormField
          control={control}
          name="password"
          label={t('fields.newPassword')}
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => repeatRef.current?.focus()}
          submitBehavior="submit"
          testID="AUTH-07.password"
        />
        <RuleList
          testID="AUTH-07.rules"
          rules={[
            { key: 'length', label: t('rules.length'), met: checks.length },
            { key: 'notEmail', label: t('rules.notEmail'), met: checks.notEmail },
            { key: 'common', label: t('rules.common'), met: null },
          ]}
        />
      </View>
      <FormField
        control={control}
        name="passwordRepeat"
        label={t('fields.passwordRepeat')}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void onSubmit()}
        testID="AUTH-07.passwordRepeat"
        inputRef={repeatRef}
      />
    </AuthScreen>
  );
}
