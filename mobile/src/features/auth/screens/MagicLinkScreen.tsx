import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useVerifyEmailCode } from '@/api/queries/passwordless';
import { isWeb } from '@/lib/platform';
import { useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { Button, Skeleton, SkeletonText } from '@/ui';

import { AuthScreen, AuthSkeletonLink } from '../components/AuthScreen';
import { FormNotice } from '../components/FormNotice';
import { dropFragment } from '../emailHandoff';
import { storedEmailAttempt } from '../emailAttempt';
import { firstParam } from '../forms';
import { armPasskeyOffer, disarmPasskeyOffer } from '../passkeyOffer';
import { useAnswerRouting } from '../providers/useProviderSignIn';
import { codeFailureOf } from './CodeEntryScreen';

/** The token of the mail's link: base64url-ish, 43 characters from the server; anything else is no token. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,64}$/;

/** `#t=…` of the address bar (web, ADR-429 b: the token travels in the fragment only, never to a log). */
export function magicTokenFromHash(hash: string): string | null {
  const values = new URLSearchParams(hash.replace(/^#/, ''));
  const all = values.getAll('t');
  const token = all.length === 1 ? all[0] : undefined;
  return token && TOKEN_SHAPE.test(token) ? token : null;
}

type Phase = 'checking' | 'signing_in' | 'elsewhere' | 'failed';

const useStyles = createStyles((t) => ({
  actions: { alignItems: 'flex-start', gap: t.space[8] },
  waiting: { gap: t.space[8] },
}));

/**
 * WEB-12 / AUTH-13 magic link (09 §7.2, §8.1): `/auth/magic#t=…` signs in only on the device that asked for the code, because only
 * there is the attempt kept (features/auth/emailAttempt.ts). Anywhere else it says to type the code in the app. The fragment
 * leaves the address bar at once.
 */
export function MagicLinkScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ t?: string }>();
  const status = useSessionStore((state) => state.status);
  const passkeysOn = useFlag('auth.passkeys');
  const verify = useVerifyEmailCode();
  const route = useAnswerRouting();
  const [phase, setPhase] = useState<Phase>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);
  const [token] = useState(() => {
    if (isWeb && typeof window !== 'undefined') return magicTokenFromHash(window.location?.hash ?? '');
    const param = firstParam(params.t);
    return param && TOKEN_SHAPE.test(param) ? param : null;
  });

  useEffect(() => {
    dropFragment();
  }, []);

  useEffect(() => {
    // A member already signed in has nothing to do here; the session routing takes them on.
    if (started.current || status === 'loading' || status === 'member') return;
    started.current = true;
    void (async () => {
      const attempt = await storedEmailAttempt();
      if (!token || !attempt) {
        setPhase('elsewhere');
        return;
      }
      setPhase('signing_in');
      await armPasskeyOffer(passkeysOn);
      try {
        route(await verify.mutateAsync({ email: attempt.email, attemptId: attempt.attemptId, magicToken: token }));
      } catch (error) {
        disarmPasskeyOffer();
        const failure = codeFailureOf(error, t('common.serverError'));
        setMessage(
          failure.kind === 'expired' || failure.kind === 'wrong'
            ? t('magic.expired')
            : failure.kind === 'locked'
              ? t('magic.locked')
              : failure.kind === 'other'
                ? failure.message
                : t('magic.expired'),
        );
        setPhase('failed');
      }
    })();
    // The link is read once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (phase === 'elsewhere') {
    return (
      <AuthScreen
        routeId="WEB-12"
        title={t('magic.elsewhereTitle')}
        titleVariant="title2"
        subtitle={t('magic.elsewhereBody')}
        onBack={() => router.replace('/')}
        skeletonFields={0}
        skeletonSubtitleLines={3}
        skeletonAfter={<AuthSkeletonLink />}
        footer={
          <Button
            label={t('magic.newCode')}
            variant="tertiary"
            size="m"
            flush="start"
            role="link"
            onPress={() => router.replace('/auth/email')}
            testID="WEB-12.newCode"
          />
        }
      />
    );
  }

  if (phase === 'failed') {
    return (
      <AuthScreen
        routeId="WEB-12"
        title={t('magic.failedTitle')}
        titleVariant="title2"
        onBack={() => router.replace('/')}
        skeletonFields={0}
        footer={
          <View style={styles.actions}>
            <Button
              label={t('magic.enterCode')}
              variant="secondary"
              size="m"
              onPress={() => router.replace('/auth/code')}
              testID="WEB-12.enterCode"
            />
            <Button
              label={t('magic.newCode')}
              variant="tertiary"
              size="m"
              flush="start"
              onPress={() => router.replace('/auth/email')}
              testID="WEB-12.newCode"
            />
          </View>
        }
      >
        {message ? <FormNotice message={message} testID="WEB-12.notice" /> : null}
      </AuthScreen>
    );
  }

  // Checking and signing in: the screen's own geometry as a skeleton, never a spinner (§14).
  return (
    // DQ-1003: no field here; its skeleton is the waiting lines below.
    <AuthScreen routeId="WEB-12" title={t('magic.signingIn')} titleVariant="title2" onBack={null} skeletonFields={0} skeletonAfter={<SkeletonText variant="body" lines={2} />}>
      <Skeleton testID="WEB-12.skeleton">
        <View style={styles.waiting}>
          <SkeletonText variant="body" lines={2} />
        </View>
      </Skeleton>
    </AuthScreen>
  );
}
