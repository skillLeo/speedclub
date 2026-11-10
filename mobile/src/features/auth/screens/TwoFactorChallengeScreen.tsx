import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useTwoFactorChallenge } from '@/api/queries/auth';
import { useQaState } from '@/lib/qa';
import { createStyles } from '@/theme';
import { Button, TextInput } from '@/ui';

import { AuthScreen } from '../components/AuthScreen';
import { CodeInput, CodeInputSkeleton } from '../components/CodeInput';
import { FormNotice } from '../components/FormNotice';
import { formatWait, isCode, useCountdown } from '../forms';
import { CODE_LENGTH } from '../schemas';
import { forgetTwoFactorChallenge, heldTwoFactorChallenge } from '../twoFactorChallenge';

/** A wrong or spent code: 422 on `code` or `recovery_code`, or the `invalid_code` of the other code forms. */
function isWrongCode(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.code === 'invalid_code' || 'code' in error.fieldErrors || 'recovery_code' in error.fieldErrors;
}

/** As the server prints it, with or without dashes; the alphabet is the server's. */
const RECOVERY_CODE = /^[A-Za-z0-9-]{8,32}$/;

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16] },
  links: { alignItems: 'flex-start' },
}));

/** The stand-in challenge of a QA cell. */
const QA_CHALLENGE = 'qa-cell';

/**
 * AUTH-11 /two-factor: the six digits of the authenticator app, like AUTH-05's cells, or a recovery code instead. The
 * challenge comes from the sign-in in memory; without one (a reload, or after 5 minutes) the member signs in again. A success
 * ends in SessionHost like any sign-in.
 */
export function TwoFactorChallengeScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const submit = useTwoFactorChallenge();
  const qaState = useQaState();
  // QA cells only (qaState is compiled out of production): a forced state other than loading shows the code form, which a capture
  // cannot reach otherwise, since a live challenge only comes from a sign-in. Its code is never sent.
  const [challenge] = useState(() => heldTwoFactorChallenge() ?? (qaState !== 'default' && qaState !== 'loading' ? QA_CHALLENGE : null));
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(challenge ? null : t('twoFactor.expired'));
  const [expired, setExpired] = useState(challenge === null);
  /** ADR-203 (f): too many wrong codes lock the second factor until a password reset. No sign-out; the button rests until a change. */
  const [locked, setLocked] = useState(false);
  const wait = useCountdown();

  const backToSignIn = () => {
    forgetTwoFactorChallenge();
    router.replace('/sign-in');
  };

  const send = async (value: string) => {
    if (submit.isPending || !challenge || challenge === QA_CHALLENGE || expired || locked) return;
    setNotice(null);
    setError(undefined);
    if (useRecovery) {
      const cleaned = value.replace(/\s/g, '');
      if (!cleaned) return setError(t('twoFactor.recoveryRequired'));
      if (!RECOVERY_CODE.test(cleaned)) return setError(t('twoFactor.recoveryInvalid'));
    } else if (value.length !== CODE_LENGTH) {
      return setError(t('validation.codeInvalid'));
    }
    try {
      await submit.mutateAsync(useRecovery ? { challenge, recoveryCode: value.replace(/\s/g, '') } : { challenge, code: value });
      forgetTwoFactorChallenge();
    } catch (failure) {
      if (isCode(failure, 'second_factor_locked')) {
        setLocked(true);
        setNotice(t('twoFactor.locked'));
      } else if (isCode(failure, 'challenge_expired')) {
        forgetTwoFactorChallenge();
        setExpired(true);
        setNotice(t('twoFactor.expired'));
      } else if (isWrongCode(failure)) {
        if (useRecovery) setRecovery('');
        else setCode('');
        setError(t(useRecovery ? 'twoFactor.recoveryWrong' : 'twoFactor.codeWrong'));
      } else if (failure instanceof ApiError && failure.kind === 'rate_limited') {
        wait.restart(failure.retryAfter ?? 60);
      } else {
        setNotice(failure instanceof ApiError ? failure.message : t('common.serverError'));
      }
    }
  };

  const value = useRecovery ? recovery : code;
  return (
    <AuthScreen
      routeId="AUTH-11"
      title={t('twoFactor.title')}
      subtitle={t(useRecovery ? 'twoFactor.subtitleRecovery' : 'twoFactor.subtitle')}
      subtitleHyphenate={false}
      signInStep
      skeletonFields={0}
      skeleton={<CodeInputSkeleton />}
      cta={
        // DQ-441: the skeleton's CTA is the form's, disabled; "Zur Anmeldung" belongs to the expired challenge only.
        expired && qaState !== 'loading'
          ? { label: t('twoFactor.toSignIn'), onPress: backToSignIn }
          : { label: t('twoFactor.submit'), onPress: () => void send(value), loading: submit.isPending, disabled: wait.remaining > 0 || locked }
      }
      footer={
        expired ? null : (
          <View style={styles.links}>
            <Button
              label={t(useRecovery ? 'twoFactor.useApp' : 'twoFactor.useRecovery')}
              variant="tertiary"
              size="m"
              flush="start"
              onPress={() => {
                setUseRecovery((current) => !current);
                setError(undefined);
                setLocked(false);
                setNotice(null);
              }}
              testID="AUTH-11.toggle"
            />
            <Button label={t('twoFactor.cancel')} variant="tertiary" size="m" flush="start" onPress={backToSignIn} testID="AUTH-11.cancel" />
          </View>
        )
      }
    >
      <View style={styles.body}>
        {wait.remaining > 0 ? (
          <FormNotice message={t('twoFactor.rateLimited', { time: formatWait(t, wait.remaining) })} testID="AUTH-11.notice" />
        ) : notice ? (
          <FormNotice message={notice} tone={expired || notice === t('twoFactor.locked') ? 'info' : 'error'} testID="AUTH-11.notice" />
        ) : null}
        {expired ? null : useRecovery ? (
          <TextInput
            value={recovery}
            onChangeText={(next) => {
              setRecovery(next);
              setError(undefined);
              setLocked(false);
            }}
            label={t('twoFactor.recoveryLabel')}
            helper={t('twoFactor.recoveryHelper')}
            error={error}
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            returnKeyType="go"
            onSubmitEditing={() => void send(recovery)}
            disabled={submit.isPending}
            autoFocus
            testID="AUTH-11.recovery"
          />
        ) : (
          <CodeInput
            value={code}
            onChange={(next) => {
              setCode(next);
              setError(undefined);
              setLocked(false);
            }}
            onComplete={(next) => void send(next)}
            label={t('twoFactor.codeLabel')}
            error={error}
            disabled={submit.isPending}
            autoFocus
            testID="AUTH-11.code"
          />
        )}
      </View>
    </AuthScreen>
  );
}
