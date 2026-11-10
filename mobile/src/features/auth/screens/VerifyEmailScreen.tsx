import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useMe, useResendCode, useSignOut, useVerifyEmail } from '@/api/queries/auth';
import { dropBareReturnTo, useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { Button, Text, toast } from '@/ui';

import { AuthScreen, FooterLink } from '../components/AuthScreen';
import { CodeInput, CodeInputSkeleton } from '../components/CodeInput';
import { FormField } from '../components/FormField';
import { FormNotice } from '../components/FormNotice';
import { applyServerErrors, breakableEmail, fieldMessage, firstParam, formatClock, isCode, useCountdown } from '../forms';
import { handEmailTo, useHandedEmail } from '../emailHandoff';
import { holdTwoFactorChallenge } from '../twoFactorChallenge';
import { clearRegistrationPassword, registrationPasswordFor } from '../pendingRegistration';
import { verifyEmailSchema, type VerifyEmailValues } from '../schemas';

/** When an answer to a resend names no cooldown: the server's own is about this long. */
const DEFAULT_RESEND_SECONDS = 60;

const useStyles = createStyles((t) => ({
  links: { gap: t.space[2] },
  resend: { alignItems: 'flex-start' },
  hint: { marginTop: t.space[4] },
  wait: { marginTop: -t.space[4] },
}));

/**
 * AUTH-05. The wording stays neutral: an address that already has an account gets a notice mail and no code (ADR-133), so
 * this screen can never promise one. Verifying needs code and password, or a session of this account (ADR-135).
 *
 * Only an arrival from AUTH-04 carries `resend`, and only then did a mail just go out. Any other arrival, as a member who signed
 * in days later, has no such thing to report and nothing to wait for (BH-32); a mail is never sent by arriving here, because it
 * would invalidate a code the member may be about to type.
 */
export function VerifyEmailScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; resend?: string }>();
  const status = useSessionStore((state) => state.status);
  const signedIn = status === 'member';
  const { data: me } = useMe();
  const handedEmail = useHandedEmail('/verify-email', params.email);
  const email = handedEmail ?? me?.email ?? '';
  // In state, since it is read during render and clearing the module's copy alone would not show the field (BH-31).
  const [heldPassword, setHeldPassword] = useState(() => registrationPasswordFor(email));
  const needsPassword = !signedIn && heldPassword === null;
  /** Refusals of the held password. The first is the common mistyped code; a second points at the password. */
  const [heldRefusals, setHeldRefusals] = useState(0);

  const verify = useVerifyEmail();
  const resend = useResendCode();
  const signOut = useSignOut();
  const [notice, setNotice] = useState<string | null>(null);
  const resendParam = firstParam(params.resend);
  const fromRegistration = Boolean(resendParam);
  const initialWait = Number(resendParam);
  const timer = useCountdown(fromRegistration && Number.isFinite(initialWait) ? initialWait : 0);

  const { control, handleSubmit, setError, setValue, clearErrors } = useForm<VerifyEmailValues>({
    resolver: zodResolver(verifyEmailSchema),
    mode: 'onSubmit',
    defaultValues: { code: '', password: '' },
  });

  // Nothing to verify without an address, as after a reload of a link without one.
  useEffect(() => {
    if (status === 'guest' && !email) router.replace('/sign-up');
  }, [email, router, status]);

  const onSubmit = handleSubmit(async (values) => {
    // Six digits submit by themselves; a press on the button at the same moment must not send the code twice.
    if (verify.isPending) return;
    setNotice(null);
    if (needsPassword && !values.password) {
      setError('password', { type: 'required', message: 'validation.passwordRequired' }, { shouldFocus: true });
      return;
    }
    try {
      const answer = await verify.mutateAsync({
        email,
        code: values.code,
        ...(signedIn ? {} : { password: heldPassword ?? values.password }),
      });
      clearRegistrationPassword();
      if (answer.kind === 'two_factor') {
        holdTwoFactorChallenge(answer.challenge, answer.expiresIn);
        router.replace('/two-factor');
      }
    } catch (error) {
      if (isCode(error, 'password_change_required')) {
        clearRegistrationPassword();
        handEmailTo('/reset-password', email);
        router.replace({ pathname: '/reset-password', params: { forced: '1' } });
      } else if (isCode(error, 'invalid_code') && needsPassword) {
        // The server answers a wrong password with the same code, so the message names both, and the code stays to check.
        setError('code', { type: 'server', message: t('verify.invalidWithPassword') });
      } else if (isCode(error, 'invalid_code') && heldPassword !== null && !signedIn && heldRefusals >= 1) {
        // Registering again with another password keeps the first one (ADR-133), so the held one can be the wrong one. BH-31.
        clearRegistrationPassword();
        setHeldPassword(null);
        setError('code', { type: 'server', message: t('verify.invalidWithPassword') });
      } else if (isCode(error, 'invalid_code')) {
        if (heldPassword !== null && !signedIn) setHeldRefusals((refusals) => refusals + 1);
        setValue('code', '');
        setError('code', { type: 'server', message: t('verify.invalid') });
      } else if (error instanceof ApiError) {
        setNotice(applyServerErrors(error, setError, { code: 'code', password: 'password' }));
      } else {
        setNotice(t('common.serverError'));
      }
    }
  });

  const requestCode = async () => {
    setNotice(null);
    clearErrors('code');
    try {
      const next = await resend.mutateAsync(email);
      timer.restart(next.resend_after_seconds ?? DEFAULT_RESEND_SECONDS);
      toast(t('verify.resent'), { testID: 'AUTH-05.resentToast' });
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : t('common.serverError'));
    }
  };

  /** Back to AUTH-04. A member who signed in has no such screen under this one, and a session to end first. */
  const changeAddress = async () => {
    clearRegistrationPassword();
    if (signedIn) {
      await signOut.mutateAsync();
      router.replace('/sign-up');
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/sign-up');
    }
  };

  /**
   * A signed-in member may browse before verifying (§3.1, BH-29), so back is the page they came from. Without one, as after the
   * routing sent them here from a member-only screen, Home. A path kept for after the steps goes too: the member chose not to
   * verify now, and a later start of the steps from another page must not end on this one's (BH-29 resume).
   */
  const leaveAsMember = () => {
    dropBareReturnTo();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <AuthScreen
      routeId="AUTH-05"
      // Only an arrival from AUTH-04 follows a mail just sent; any other says what to do, not that a mail is waiting.
      title={t(fromRegistration ? 'verify.title' : 'verify.titleNoMail')}
      subtitle={t(fromRegistration ? 'verify.subtitle' : 'verify.subtitleNoMail', { email: breakableEmail(email) })}
      skeletonFields={0}
      skeleton={<CodeInputSkeleton />}
      onBack={signedIn ? leaveAsMember : undefined}
      cta={{ label: t('verify.submit'), onPress: () => void onSubmit(), loading: verify.isPending }}
      footer={
        <View style={styles.links}>
          <Button
            label={t('verify.changeAddress')}
            variant="tertiary"
            size="m"
            flush="start"
            loading={signOut.isPending}
            onPress={() => void changeAddress()}
            testID="AUTH-05.changeAddress"
          />
          {signedIn ? null : (
            <FooterLink text={t('verify.hasAccount')}>
              <Button
                label={t('verify.toSignIn')}
                variant="tertiary"
                size="m"
                role="link"
                flush="start"
                onPress={() => {
                  handEmailTo('/sign-in', email);
                  router.replace('/sign-in');
                }}
                testID="AUTH-05.toSignIn"
              />
            </FooterLink>
          )}
        </View>
      }
    >
      {notice ? <FormNotice message={notice} testID="AUTH-05.notice" /> : null}
      <Controller
        control={control}
        name="code"
        render={({ field, fieldState }) => (
          <CodeInput
            ref={field.ref}
            value={field.value}
            onChange={(code) => {
              field.onChange(code);
              if (fieldState.error) clearErrors('code');
            }}
            // A password still to enter stays in the way: the member is not done yet, and an error there would surprise.
            onComplete={needsPassword ? undefined : () => void onSubmit()}
            onBlur={field.onBlur}
            label={t('verify.codeLabel')}
            error={fieldMessage(t, fieldState.error)}
            disabled={verify.isPending}
            autoFocus
            testID="AUTH-05.code"
          />
        )}
      />
      {needsPassword ? (
        <FormField
          control={control}
          name="password"
          label={t('verify.passwordLabel')}
          helper={t('verify.passwordHelper')}
          secure
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
          testID="AUTH-05.password"
        />
      ) : null}
      <View style={styles.resend}>
        <Text variant="supporting" color="text.secondary" style={styles.hint} testID="AUTH-05.spamHint">
          {t('verify.spamHint')}
        </Text>
        <Button
          label={t('verify.resend')}
          variant="tertiary"
          size="m"
          flush="start"
          disabled={timer.remaining > 0}
          loading={resend.isPending}
          onPress={() => void requestCode()}
          testID="AUTH-05.resend"
        />
        {/* DQ-121: the wait is information, so it stands in readable text, not only in the disabled label. */}
        {timer.remaining > 0 ? (
          <Text variant="helper" color="text.tertiary" style={styles.wait} testID="AUTH-05.resendWait">
            {t('verify.resendWait', { time: formatClock(timer.remaining) })}
          </Text>
        ) : null}
      </View>
    </AuthScreen>
  );
}
