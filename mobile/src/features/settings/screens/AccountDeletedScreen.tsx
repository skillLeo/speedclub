import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Button, Icon, Text } from '@/ui';

import { SettingsPage } from '../components/SettingsPage';
import { resetAccountDeleted, useAccountDeleted } from '../deletion';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[16], paddingTop: t.space[24] },
  mark: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.full,
    height: t.size.avatar.lg,
    justifyContent: 'center',
    width: t.size.avatar.lg,
  },
  actions: { marginTop: t.space[16] },
}));

/**
 * The end of SET-13: signed out, the account deactivated, and what happens next. Reached only right after a deletion; a typed
 * URL goes back to the settings. Whether it follows a deletion is decided once, as the screen opens: "Zur Startseite" clears the
 * flag for the rest of the app run, and that must not send this screen to the settings instead (M2.8: it landed on /settings,
 * whose start asked auth/me for a member that is gone). The same holds for a sign-in later, with this screen still in its stack.
 */
export function AccountDeletedScreen() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const deletedNow = useAccountDeleted();
  const [deleted] = useState(deletedNow);

  useEffect(() => {
    if (!deleted) router.replace('/settings');
  }, [deleted, router]);

  const home = () => {
    router.replace('/');
    resetAccountDeleted();
  };

  return (
    <SettingsPage routeId="SET-13" title={t('deleted.header')} fallback="/" offlineLabel={t('offlineForm')}>
      {deleted ? (
        <View style={styles.root} testID="SET-13.done">
          <View style={styles.mark} aria-hidden>
            <Icon name="check" size={24} color="text.secondary" />
          </View>
          <Text variant="titleM" role="heading" {...({ 'aria-level': 1 } as object)} testID="SET-13.done.title">
            {t('deleted.title')}
          </Text>
          <Text variant="body" color="text.secondary">
            {t('deleted.body')}
          </Text>
          <Text variant="body" color="text.secondary">
            {t('deleted.mail')}
          </Text>
          <Text variant="body" color="text.secondary" testID="SET-13.done.export">
            {t('deleted.export')}
          </Text>
          <View style={styles.actions}>
            <Button label={t('deleted.home')} size="l" fullWidth onPress={home} testID="SET-13.done.home" />
          </View>
        </View>
      ) : null}
    </SettingsPage>
  );
}
