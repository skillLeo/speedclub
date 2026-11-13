import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { SECURE_TOKEN_SHAPE, secureTokenFromHash, useSecureAccountByLink, type SecuredAccount } from '@/api/queries/accountSecurity';
import { endLocalSessionQuietly } from '@/api/queries/auth';
import { hapticFor } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { Button, SkeletonText, Text } from '@/ui';

import { AuthScreen } from '../components/AuthScreen';
import { FormNotice } from '../components/FormNotice';
import { dropFragment } from '../emailHandoff';
import { firstParam } from '../forms';
import { forgetSecuredAccount, useSecuredAccountStore } from '../securedAccount';

/** Route ID of /auth/secure (M4.7; not in the register yet, reported to the lead). */
const ROUTE = 'AUTH-17';

const useStyles = createStyles((t) => ({
  facts: { gap: t.space[8] },
  reference: { gap: t.space[2] },
  actions: { alignItems: 'flex-start', gap: t.space[8] },
}));

/** What "Das war ich nicht" removed because it came after the reported sign-in (SEC-M47-01), as sentences. */
export function removedLines(result: SecuredAccount, t: (key: string, options?: Record<string, unknown>) => string): string[] {
  const lines: string[] = [];
  if (result.removed.passkeys > 0) lines.push(t('secure.removed.passkeys', { count: result.removed.passkeys }));
  if (result.removed.providers > 0) lines.push(t('secure.removed.providers', { count: result.removed.providers }));
  if (result.removed.email_change) lines.push(t('secure.removed.emailChange'));
  if (result.removed.two_factor) lines.push(t('secure.removed.twoFactor'));
  return lines;
}

/** The answer: everything signed out, the support reference, what was removed, and the way back in. */
function SecuredView({ result }: { result: SecuredAccount }) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const member = useSessionStore((state) => state.status === 'member');
  const removed = removedLines(result, t);
  const signedOut = result.devices_signed_out + result.sessions_signed_out;
  const signInAgain = async () => {
    // The server ended every session of the account; on this device it ended with the answer (SET-21 and the link alike).
    if (member) await endLocalSessionQuietly();
    forgetSecuredAccount();
    router.replace('/auth/email');
  };
  return (
    <AuthScreen
      routeId={ROUTE}
      skeletonFields={0}
      title={t('secure.doneTitle')}
      titleVariant="title2"
      subtitle={signedOut > 0 ? t('secure.doneBody', { count: signedOut }) : t('secure.doneBodyNone')}
      onBack={null}
      cta={{ label: t('secure.signInAgain'), onPress: () => void signInAgain() }}
    >
      <View style={styles.facts} testID={`${ROUTE}.done`}>
        <View style={styles.reference}>
          <Text variant="callout" color="text.secondary">
            {t('secure.ticket')}
          </Text>
          {/* DQ-1019: a code, not a changing number: proportional figures, so "SC-HVAZ75AD" reads as one token. */}
          <Text variant="headline" selectable testID={`${ROUTE}.ticket`}>
            {result.ticket_reference}
          </Text>
        </View>
        {removed.length > 0 ? (
          <Text variant="body" color="text.secondary" testID={`${ROUTE}.removed`}>
            {t('secure.removedIntro')} {removed.join(' ')}
          </Text>
        ) : null}
        {result.password_reset_required ? (
          <Text variant="body" color="text.secondary" testID={`${ROUTE}.password`}>
            {t('secure.passwordNext')}
          </Text>
        ) : null}
      </View>
    </AuthScreen>
  );
}

type Phase = 'ready' | 'invalid';

/**
 * AUTH-17 /auth/secure (09 §8.4, M4.7): two ways in.
 * - From SET-21: the account is secured already; the screen shows the answer (held in securedAccount.ts) and the way back in.
 * - From the login alert's "Das war ich nicht" (`/auth/secure#t=<event>.<proof>`, no sign-in needed): the link only opens this
 *   screen. Nothing is sent until the member taps "Konto jetzt sichern", because mail scanners open links and run their scripts
 *   (SEC-M47 app note). The token leaves the address bar at once and is never logged.
 */
export function SecureAccountScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const member = useSessionStore((state) => state.status === 'member');
  const held = useSecuredAccountStore((state) => state.result);
  const params = useLocalSearchParams<{ t?: string }>();
  const secure = useSecureAccountByLink();
  const [token] = useState(() => {
    if (isWeb && typeof window !== 'undefined') return secureTokenFromHash(window.location?.hash ?? '');
    const param = firstParam(params.t);
    return param && SECURE_TOKEN_SHAPE.test(param) ? param : null;
  });
  const [phase, setPhase] = useState<Phase>(token ? 'ready' : 'invalid');
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<SecuredAccount | null>(null);

  useEffect(() => {
    dropFragment();
  }, []);

  const shown = result ?? held;
  if (shown) return <SecuredView result={shown} />;

  const run = async () => {
    if (!token) return;
    setNotice(null);
    try {
      const answer = await secure.mutateAsync(token);
      hapticFor('destructiveConfirm');
      // The alert went to this account's address, so a session on this device is almost surely the same account, which the server
      // has just ended: it ends here too, quietly, before a request could hear the 401 and raise "Sitzung abgelaufen".
      if (member) await endLocalSessionQuietly();
      setResult(answer);
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'validation') {
        setPhase('invalid');
        return;
      }
      setNotice(error instanceof ApiError && error.status !== 0 && error.message ? error.message : t('common.serverError'));
    }
  };

  if (phase === 'invalid') {
    return (
      <AuthScreen
        routeId={ROUTE}
        skeletonFields={0}
        title={t('secure.invalidTitle')}
        titleVariant="title2"
        subtitle={member ? t('secure.invalidBodyMember') : t('secure.invalidBody')}
        onBack={() => router.replace('/')}
        footer={
          <View style={styles.actions} testID={`${ROUTE}.invalid`}>
            {member ? (
              <Button
                label={t('secure.toActivity')}
                variant="secondary"
                size="m"
                onPress={() => router.replace('/settings/security/activity')}
                testID={`${ROUTE}.toActivity`}
              />
            ) : (
              <Button
                label={t('secure.toSignIn')}
                variant="secondary"
                size="m"
                onPress={() => router.replace('/auth/email')}
                testID={`${ROUTE}.toSignIn`}
              />
            )}
            <Button
              label={t('secure.contact')}
              variant="tertiary"
              size="m"
              flush="start"
              role="link"
              onPress={() => router.push('/settings/help')}
              testID={`${ROUTE}.help`}
            />
          </View>
        }
      />
    );
  }

  return (
    <AuthScreen
      routeId={ROUTE}
      skeletonFields={0}
      skeletonAfter={<SkeletonText variant="body" lines={4} />}
      title={t('secure.title')}
      titleVariant="title2"
      subtitle={t('secure.body')}
      onBack={() => router.replace('/')}
      cta={{ label: t('secure.confirm'), onPress: () => void run(), loading: secure.isPending, disabled: !online }}
      secondary={{ label: t('secure.wasMe'), onPress: () => router.replace('/'), disabled: secure.isPending, testID: `${ROUTE}.wasMe` }}
    >
      <View style={styles.facts} testID={`${ROUTE}.ready`}>
        <Text variant="body" color="text.secondary">
          {t('secure.what')}
        </Text>
        {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
      </View>
    </AuthScreen>
  );
}
