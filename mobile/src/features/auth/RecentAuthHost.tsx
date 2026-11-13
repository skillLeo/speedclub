/**
 * Recent authentication (09 §8.1 "sudo mode"): the one sheet behind every sensitive call. A call that answers 403
 * `reauthentication_required` (api/queries/recentAuth.ts) opens it with the server's `methods`; the member confirms with a
 * passkey, a code to their address or their password (plus the two-factor code where it is on), and the call runs again.
 *
 * Methods: the server's list when the call kept it, else what the member has (Me: password_set; passkeys where this platform can
 * use them). Passkey first when it is offered, then the e-mail code, then the password (the server's order).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { useMe } from '@/api/queries/auth';
import { errorNumber, type ReauthMethod } from '@/api/queries/errorDetails';
import { settleRecentAuth, useRecentAuthStore } from '@/api/queries/recentAuth';
import { fetchReauthPasskeyOptions, startReauthCode, useReauthenticate } from '@/api/queries/security';
import { haptics } from '@/lib/haptics';
import { createStyles } from '@/theme';
import { Button, Sheet, Text, TextInput } from '@/ui';
import { slot, SlotText } from '@/ui/SlotText';
import { identifierText } from '@/ui/textBreaks';

import { CodeInput } from './components/CodeInput';
import { FormNotice } from './components/FormNotice';
import { maskEmail, newAttemptId } from './emailAttempt';
import { formatClock, formatWait, isCode, useCountdown } from './forms';
import { getPasskey, isPasskeyCancelled, passkeysAvailable } from './providers/passkeys';
import { CODE_LENGTH } from './schemas';

const ROUTE = 'REAUTH';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], paddingBottom: t.space[16] },
  others: { alignItems: 'flex-start', gap: t.space[4] },
}));

/** The methods the sheet offers, in order. */
export function reauthMethods(input: {
  server: ReauthMethod[] | null;
  passwordSet: boolean;
  passkeysOn: boolean;
  passkeysHere: boolean;
}): ReauthMethod[] {
  const { server, passwordSet, passkeysOn, passkeysHere } = input;
  const usable = (method: ReauthMethod) =>
    method === 'passkey' ? passkeysOn && passkeysHere : method === 'password' ? server !== null || passwordSet : true;
  const base: ReauthMethod[] = server ?? ['passkey', 'email_code', 'password'];
  const methods = base.filter(usable);
  return methods.length > 0 ? methods : ['email_code'];
}

export function RecentAuthHost() {
  const pending = useRecentAuthStore((state) => state.pending);
  // Mounted only while asked: every opening starts empty, and nothing typed outlives the sheet.
  return pending ? <RecentAuthSheet serverMethods={pending.methods} /> : null;
}

function RecentAuthSheet({ serverMethods }: { serverMethods: ReauthMethod[] | null }) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const { data: me } = useMe();
  const passkeysOn = useFlag('auth.passkeys');
  const methods = useMemo(
    () => reauthMethods({ server: serverMethods, passwordSet: me?.password_set ?? false, passkeysOn, passkeysHere: passkeysAvailable() }),
    [me?.password_set, passkeysOn, serverMethods],
  );
  const [method, setMethod] = useState<ReauthMethod>(methods[0] ?? 'email_code');
  const needsSecondFactor = Boolean(me?.two_factor_enabled) && method !== 'passkey';
  const reauth = useReauthenticate();
  const [notice, setNotice] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secondFactor, setSecondFactor] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [codeError, setCodeError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const resend = useCountdown();
  const busy = reauth.isPending || sending;
  const sentFor = useRef<string | null>(null);

  const close = () => {
    if (busy) return;
    settleRecentAuth(false);
  };

  const confirmed = () => {
    haptics.success();
    settleRecentAuth(true);
  };

  const fail = (error: unknown) => {
    if (error instanceof ApiError && error.kind === 'rate_limited') {
      const wait = errorNumber(error, 'retry_after') ?? error.retryAfter ?? 60;
      setNotice(t('reauth.locked', { time: formatWait(t, wait) }));
    } else if (isCode(error, 'passkey_invalid')) {
      setNotice(t('reauth.passkeyInvalid'));
    } else if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
      const field = error.fieldErrors.code ?? error.fieldErrors.password ?? error.fieldErrors.two_factor_code;
      if (method === 'email_code' && error.fieldErrors.code) {
        setCode('');
        setErrorKey((key) => key + 1);
        setCodeError(error.fieldErrors.code.join(' '));
      } else {
        setNotice(field?.join(' ') ?? error.message);
      }
      haptics.warning();
    } else if (error instanceof ApiError) {
      setNotice(error.message);
    } else {
      setNotice(t('common.serverError'));
    }
  };

  /** The e-mail code goes out when the method is chosen, once per opening (a resend asks again). */
  const sendCode = async () => {
    const id = attempt ?? newAttemptId();
    setAttempt(id);
    setSending(true);
    setNotice(null);
    try {
      const started = await startReauthCode(id);
      resend.restart(started.resend_after);
    } catch (error) {
      fail(error);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (method !== 'email_code' || sentFor.current === 'email_code') return;
    sentFor.current = 'email_code';
    void sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);

  const submitPasskey = async () => {
    setNotice(null);
    try {
      const options = await fetchReauthPasskeyOptions();
      const credential = await getPasskey(options.options);
      await reauth.mutateAsync({ method: 'passkey', ceremonyId: options.ceremony_id, credential });
      confirmed();
    } catch (error) {
      if (isPasskeyCancelled(error)) return;
      fail(error);
    }
  };

  const submitCode = async (value: string = code) => {
    if (!attempt || value.length < CODE_LENGTH || (needsSecondFactor && !secondFactor.trim())) return;
    setNotice(null);
    setCodeError(undefined);
    try {
      await reauth.mutateAsync({ method: 'email_code', attemptId: attempt, code: value, twoFactorCode: secondFactor.trim() || undefined });
      confirmed();
    } catch (error) {
      fail(error);
    }
  };

  const submitPassword = async () => {
    if (!password) return;
    setNotice(null);
    try {
      await reauth.mutateAsync({ method: 'password', password, twoFactorCode: secondFactor.trim() || undefined });
      setPassword('');
      confirmed();
    } catch (error) {
      fail(error);
    }
  };

  const submit = () => {
    if (method === 'passkey') void submitPasskey();
    else if (method === 'email_code') void submitCode();
    else void submitPassword();
  };

  const confirmLabel = method === 'passkey' ? t('reauth.withPasskey') : t('reauth.confirm');
  const others = methods.filter((other) => other !== method);

  return (
    <Sheet
      visible
      onClose={close}
      title={t('reauth.title')}
      dismissable={!busy}
      expandable={false}
      testID={`${ROUTE}.sheet`}
      footer={
        <Button
          label={confirmLabel}
          size="l"
          fullWidth
          loading={reauth.isPending}
          disabled={sending}
          icon={method === 'passkey' ? 'key' : undefined}
          onPress={submit}
          testID={`${ROUTE}.confirm`}
        />
      }
    >
      <View style={styles.body}>
        <Text variant="body" color="text.secondary" testID={`${ROUTE}.body`}>
          {t(`reauth.body.${method}`)}
        </Text>
        {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
        {method === 'email_code' ? (
          <>
            {me?.email ? (
              <SlotText
                variant="callout"
                color="text.secondary"
                text={t('reauth.sentTo', { email: slot('email') })}
                slots={{ email: identifierText(maskEmail(me.email)) }}
                testID={`${ROUTE}.sentTo`}
              />
            ) : null}
            <CodeInput
              value={code}
              onChange={(next) => {
                setCode(next);
                setCodeError(undefined);
              }}
              onComplete={(full) => {
                if (!needsSecondFactor) void submitCode(full);
              }}
              label={t('reauth.codeLabel')}
              error={codeError}
              errorKey={errorKey}
              disabled={busy}
              autoFocus
              testID={`${ROUTE}.code`}
            />
            <Button
              label={resend.remaining > 0 ? t('code.resendIn', { time: formatClock(resend.remaining) }) : t('code.resend')}
              variant="tertiary"
              size="m"
              flush="start"
              disabled={resend.remaining > 0 || busy}
              onPress={() => void sendCode()}
              testID={`${ROUTE}.resend`}
            />
          </>
        ) : null}
        {method === 'password' ? (
          <TextInput
            value={password}
            onChangeText={setPassword}
            label={t('reauth.password')}
            secure
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submitPassword()}
            disabled={busy}
            testID={`${ROUTE}.password`}
          />
        ) : null}
        {needsSecondFactor ? (
          <TextInput
            value={secondFactor}
            onChangeText={setSecondFactor}
            label={t('reauth.secondFactor')}
            helper={t('reauth.secondFactorHelper')}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            disabled={busy}
            testID={`${ROUTE}.secondFactor`}
          />
        ) : null}
        {others.length > 0 ? (
          <View style={styles.others}>
            {others.map((other) => (
              <Button
                key={other}
                label={t(`reauth.switch.${other}`)}
                variant="tertiary"
                size="m"
                flush="start"
                disabled={busy}
                onPress={() => {
                  setNotice(null);
                  setMethod(other);
                }}
                testID={`${ROUTE}.switch.${other}`}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
