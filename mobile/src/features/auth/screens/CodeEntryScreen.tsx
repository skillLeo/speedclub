import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { errorNumber } from '@/api/queries/errorDetails';
import { useStartEmailCode, useVerifyEmailCode } from '@/api/queries/passwordless';
import { createStyles } from '@/theme';
import { Button, Text } from '@/ui';
import { slot } from '@/ui/SlotText';
import { identifierText } from '@/ui/textBreaks';

import { AuthScreen } from '../components/AuthScreen';
import { CodeInput, CodeInputSkeleton } from '../components/CodeInput';
import { FormNotice } from '../components/FormNotice';
import { handEmailTo } from '../emailHandoff';
import { heldEmailAttempt, holdEmailAttempt, maskEmail, resentAttempt, secondsUntilResend, type EmailAttempt } from '../emailAttempt';
import { formatClock, formatWait, isCode, useCountdown } from '../forms';
import { armPasskeyOffer, disarmPasskeyOffer } from '../passkeyOffer';
import { useAnswerRouting } from '../providers/useProviderSignIn';
import { CODE_LENGTH } from '../schemas';

const useStyles = createStyles((t) => ({
  links: { alignItems: 'flex-start', gap: t.space[2] },
  // The waiting line keeps the button's 44, so nothing moves when it turns into "Neuen Code senden".
  waiting: { justifyContent: 'center', minHeight: t.size.button.m },
}));

export type CodeFailure =
  | { kind: 'wrong'; attemptsLeft: number | null }
  | { kind: 'expired' }
  | { kind: 'locked'; seconds: number }
  | { kind: 'rate_limited'; seconds: number }
  | { kind: 'other'; message: string };

/** What a refused code means for AUTH-13 and AUTH-16 (the same server rules, 09 §8.1). */
export function codeFailureOf(error: unknown, fallback: string): CodeFailure {
  if (isCode(error, 'invalid_code')) return { kind: 'wrong', attemptsLeft: errorNumber(error, 'attempts_left') };
  if (isCode(error, 'code_expired')) return { kind: 'expired' };
  if (isCode(error, 'email_code_locked')) {
    return { kind: 'locked', seconds: errorNumber(error, 'retry_after') ?? (error as ApiError).retryAfter ?? 15 * 60 };
  }
  if (error instanceof ApiError && error.kind === 'rate_limited') return { kind: 'rate_limited', seconds: error.retryAfter ?? 60 };
  if (error instanceof ApiError && Object.keys(error.fieldErrors).length === 0) return { kind: 'other', message: error.message };
  if (error instanceof ApiError) return { kind: 'other', message: Object.values(error.fieldErrors)[0]?.join(' ') ?? error.message };
  return { kind: 'other', message: fallback };
}

/**
 * The code step shared by AUTH-13 and AUTH-16: cells that submit themselves, the shake and its message on a wrong code, the lock
 * with its time left, the resend timer. The screen passes how a code is checked and how a new one is asked for.
 */
export function useCodeStep(input: {
  verify: (code: string) => Promise<void>;
  resend: () => Promise<number>;
  initialWait: number;
}) {
  const { t } = useTranslation('auth');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [errorKey, setErrorKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resendTimer = useCountdown(input.initialWait);
  const lock = useCountdown();

  const refuse = (message: string) => {
    setCode('');
    setError(message);
    setErrorKey((key) => key + 1);
  };

  const submit = async (value: string) => {
    if (busy || value.length < CODE_LENGTH || lock.remaining > 0) return;
    setBusy(true);
    setNotice(null);
    setError(undefined);
    try {
      await input.verify(value);
    } catch (failure) {
      const reason = codeFailureOf(failure, t('common.serverError'));
      switch (reason.kind) {
        case 'wrong':
          refuse(reason.attemptsLeft === null ? t('code.wrong') : t('code.wrongLeft', { count: reason.attemptsLeft }));
          break;
        case 'expired':
          refuse(t('code.expired'));
          resendTimer.restart(0);
          break;
        case 'locked':
          lock.restart(reason.seconds);
          setCode('');
          break;
        case 'rate_limited':
          setNotice(t('code.rateLimited', { time: formatWait(t, reason.seconds) }));
          break;
        default:
          setNotice(reason.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setNotice(null);
    try {
      const wait = await input.resend();
      resendTimer.restart(wait);
      setCode('');
      setError(undefined);
      setNotice(null);
    } catch (failure) {
      if (failure instanceof ApiError && failure.kind === 'rate_limited') {
        resendTimer.restart(errorNumber(failure, 'retry_after') ?? failure.retryAfter ?? 60);
      } else {
        setNotice(failure instanceof ApiError ? failure.message : t('common.serverError'));
      }
    }
  };

  return {
    code,
    setCode: (next: string) => {
      setCode(next);
      if (error) setError(undefined);
    },
    error,
    errorKey,
    // DQ-1004: the lock says when a code can be entered again, as a running clock ("Wieder möglich in 14:52").
    notice: lock.remaining > 0 ? t('code.locked', { time: formatClock(lock.remaining) }) : notice,
    locked: lock.remaining > 0,
    busy,
    submit,
    resend,
    resendIn: resendTimer.remaining,
  };
}

/**
 * "Neuen Code in 0:28" → "Neuen Code senden". DQ-993: the time left is information, not a dead control: readable text in
 * text.secondary with tabular figures; the button comes when it can be used, and the change is announced politely.
 */
export function ResendButton({ seconds, onPress, disabled, testID }: { seconds: number; onPress: () => void; disabled?: boolean; testID: string }) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  if (seconds > 0) {
    return (
      <View style={styles.waiting}>
        <Text variant="callout" color="text.secondary" numeric testID={testID}>
          {t('code.resendIn', { time: formatClock(seconds) })}
        </Text>
      </View>
    );
  }
  return (
    <View aria-live="polite">
      <Button label={t('code.resend')} variant="tertiary" size="m" flush="start" disabled={disabled} onPress={onPress} testID={testID} />
    </View>
  );
}

/**
 * AUTH-13 (09 §7.2): the 6-digit code of AUTH-12, auto-submitted. The magic link lands on WEB-12 (/auth/magic), which signs in with
 * the same attempt. Wrong code: shake + "Noch n Versuche"; expired: a new code; locked: 15 minutes with the time left.
 */
export function CodeEntryScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const [attempt, setAttempt] = useState<EmailAttempt | null>(() => heldEmailAttempt());
  const [initialWait] = useState(() => secondsUntilResend(heldEmailAttempt()));
  const passkeysOn = useFlag('auth.passkeys');
  const verify = useVerifyEmailCode();
  const start = useStartEmailCode();
  const route = useAnswerRouting();

  const step = useCodeStep({
    initialWait,
    verify: async (code) => {
      if (!attempt) return;
      await armPasskeyOffer(passkeysOn);
      try {
        const answer = await verify.mutateAsync({ email: attempt.email, attemptId: attempt.attemptId, code });
        route(answer);
      } catch (error) {
        disarmPasskeyOffer();
        throw error;
      }
    },
    resend: async () => {
      if (!attempt) return 0;
      const started = await start.mutateAsync({ email: attempt.email, attemptId: attempt.attemptId });
      const next = resentAttempt(attempt, started.resend_after);
      holdEmailAttempt(next);
      setAttempt(next);
      return started.resend_after;
    },
  });

  // Without an attempt (a reload, an expired one) there is nothing to check a code against: back to AUTH-12.
  useEffect(() => {
    if (!attempt) router.replace('/auth/email');
  }, [attempt, router]);

  const changeEmail = () => {
    handEmailTo('/auth/email', attempt?.email);
    router.replace('/auth/email');
  };

  if (!attempt) {
    return <AuthScreen routeId="AUTH-13" title={t('code.title')} titleVariant="title2" skeleton={<CodeInputSkeleton />} skeletonFields={0} />;
  }

  return (
    <AuthScreen
      routeId="AUTH-13"
      title={t('code.title')}
      titleVariant="title2"
      subtitle={t('code.sentTo', { email: slot('email') })}
      subtitleSlots={{ email: identifierText(maskEmail(attempt.email)) }}
      skeleton={<CodeInputSkeleton />}
      skeletonFields={0}
      footer={
        <View style={styles.links}>
          {/* DQ-1004: a new code cannot be entered during the lock, so none is offered; "E-Mail ändern" stays. */}
          {step.locked ? null : (
            <ResendButton seconds={step.resendIn} onPress={() => void step.resend()} disabled={start.isPending} testID="AUTH-13.resend" />
          )}
          <Button
            label={t('code.changeEmail')}
            variant="tertiary"
            size="m"
            flush="start"
            onPress={changeEmail}
            testID="AUTH-13.changeEmail"
          />
        </View>
      }
    >
      {step.notice ? <FormNotice message={step.notice} tone={step.locked ? 'info' : 'error'} numeric={step.locked} testID="AUTH-13.notice" /> : null}
      <CodeInput
        value={step.code}
        onChange={step.setCode}
        onComplete={(code) => void step.submit(code)}
        label={t('code.label')}
        error={step.error}
        errorKey={step.errorKey}
        success={verify.isSuccess}
        disabled={step.busy}
        inert={step.locked}
        autoFocus
        testID="AUTH-13.code"
      />
      <Text variant="caption" color="text.secondary" testID="AUTH-13.hint">
        {t('code.hint')}
      </Text>
    </AuthScreen>
  );
}
