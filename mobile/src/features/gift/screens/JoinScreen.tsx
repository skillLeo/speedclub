import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { normalizeInviteCode, noteInviteCode } from '@/features/auth/inviteCode';
import { BrandStage } from '@/features/system/components/BrandStage';
import { NOT_FOUND_PHOTO } from '@/features/system/photos';
import { paramOf } from '@/features/vehicle/navigation';
import { useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Header } from '@/ui/Header';
import { Skeleton, SkeletonBlock } from '@/ui/Skeleton';

const ROUTE = 'INV-02';
/** AUTH-12, where a new account starts (the e-mail step; `/sign-up` redirects there, linkMap LEGACY_REDIRECTS). */
export const JOIN_TARGET = '/auth/email' as const;

const useStyles = createStyles(() => ({
  screen: { flex: 1 },
}));

/**
 * INV-02 `/join/{code}` (contract §5): the Blade landing opens the app (or the member web) here. A guest's code is held for the
 * sign-up (features/auth/inviteCode.ts) and the e-mail step opens at once, which says who invited them when the API names them. A
 * member already signed in is told that codes are for new accounts; a link without a valid code says so and still leads to sign-up.
 */
export function JoinScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const status = useSessionStore((state) => state.status);
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const code = normalizeInviteCode(paramOf(params.code));

  useEffect(() => {
    if (status !== 'guest' || !code) return;
    noteInviteCode(code);
    router.replace(JOIN_TARGET);
  }, [code, router, status]);

  const home = () => router.replace('/');
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (status === 'member' || (status === 'guest' && !code)) {
    const member = status === 'member';
    return (
      <View style={styles.screen} testID={`${ROUTE}.screen`}>
        <BrandStage
          routeId={ROUTE}
          photo={NOT_FOUND_PHOTO}
          title={t('invite.joinTitle')}
          body={member ? t('invite.member') : t('invite.badCode')}
          header={<Header variant="photo" onBack={back} hairline={false} testID={`${ROUTE}.header`} />}
          actions={
            member ? (
              <Button label={t('invite.toHome')} role="link" variant="primary" size="l" fullWidth onPress={home} testID={`${ROUTE}.home`} />
            ) : (
              <Button label={t('invite.toSignUp')} variant="primary" size="l" fullWidth onPress={() => router.replace(JOIN_TARGET)} testID={`${ROUTE}.signUp`} />
            )
          }
        />
      </View>
    );
  }

  // The session is being restored, or the sign-up opens this instant: the stage's block, no spinner.
  return (
    <View style={styles.screen} testID={`${ROUTE}.screen`}>
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <SkeletonBlock width="100%" aspectRatio={4 / 5} corner="none" />
      </Skeleton>
    </View>
  );
}
