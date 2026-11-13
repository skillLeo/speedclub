import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { clearAuthIntent } from '@/state/session';
import { createStyles, layout } from '@/theme';
import { Button, Text } from '@/ui';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[8], maxWidth: layout.inboxPane, paddingTop: t.space[8], width: '100%' },
  actions: { gap: t.space[12], marginTop: t.space[16] },
}));

export type SettingsGuestProps = {
  routeId: string;
  /** Where the member lands after signing in. */
  returnTo: string;
};

/**
 * A guest on a settings page that needs an account (09 §7.15: never a dead page): what the page is for in one line, "Anmelden"
 * (the one filled action) and "Konto erstellen". Left-aligned, no grey glyph (09 §14.3). The profile tab's own guest moment is
 * PROF-01's brand stage (features/profile GuestInvitation); a settings page stays quiet.
 */
export function SettingsGuest({ routeId, returnTo }: SettingsGuestProps) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const open = (pathname: '/auth/email' | '/sign-up') => {
    // A direct way in: nothing the guest tapped earlier belongs to it.
    clearAuthIntent();
    router.push({ pathname, params: { returnTo } });
  };
  return (
    <View style={styles.root} testID={`${routeId}.guest`}>
      <Text variant="title2" role="heading" {...({ 'aria-level': 2 } as object)}>
        {t('guest.title')}
      </Text>
      <Text variant="body" color="text.secondary">
        {t('guest.body')}
      </Text>
      <View style={styles.actions}>
        <Button label={t('guest.signIn')} size="l" fullWidth onPress={() => open('/auth/email')} testID={`${routeId}.signIn`} />
        <Button label={t('guest.signUp')} variant="secondary" size="l" fullWidth onPress={() => open('/sign-up')} testID={`${routeId}.signUp`} />
      </View>
    </View>
  );
}
