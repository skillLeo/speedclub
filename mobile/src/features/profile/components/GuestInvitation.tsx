import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { clearAuthIntent } from '@/state/session';
import { createStyles, layout } from '@/theme';
import { Button, Icon, Text } from '@/ui';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[8], maxWidth: layout.inboxPane, paddingTop: t.space[8], width: '100%' },
  // The place of the avatar on FS-8, so the signed-in profile grows out of the same spot.
  mark: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.full,
    height: t.size.avatar.xl,
    justifyContent: 'center',
    marginBottom: t.space[8],
    width: t.size.avatar.xl,
  },
  actions: { gap: t.space[12], marginTop: t.space[16] },
}));

export type GuestInvitationProps = {
  routeId: string;
  /** Where the member lands after signing in. */
  returnTo: string;
};

/** A guest's profile: an invitation in the shape of the profile, never a fake one. */
export function GuestInvitation({ routeId, returnTo }: GuestInvitationProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const open = (pathname: '/sign-in' | '/sign-up') => {
    // A direct way in: nothing the guest tapped earlier belongs to it.
    clearAuthIntent();
    router.push({ pathname, params: { returnTo } });
  };
  return (
    <View style={styles.root} testID={`${routeId}.guest`}>
      <View style={styles.mark} aria-hidden>
        <Icon name="user" size={48} color="text.secondary" />
      </View>
      <Text variant="titleM" role="heading" {...({ 'aria-level': 2 } as object)}>
        {t('guest.title')}
      </Text>
      <Text variant="body" color="text.secondary">
        {t('guest.body')}
      </Text>
      <View style={styles.actions}>
        <Button label={t('guest.signIn')} size="l" fullWidth onPress={() => open('/sign-in')} testID={`${routeId}.signIn`} />
        <Button
          label={t('guest.signUp')}
          variant="secondary"
          size="l"
          fullWidth
          onPress={() => open('/sign-up')}
          testID={`${routeId}.signUp`}
        />
      </View>
    </View>
  );
}
