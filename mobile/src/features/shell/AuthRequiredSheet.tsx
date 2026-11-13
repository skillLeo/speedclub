import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { closeAuthPromptKeepingIntent, dismissAuthPrompt, isInternalPath, useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { Button, Sheet, Text } from '@/ui';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[12], paddingBottom: t.space[24] },
  line: { marginBottom: t.space[12] },
}));

/** The auth-required overlay of the register. Mounted once, in the root layout; opened through useRequireAuth(). */
export function AuthRequiredSheet() {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const router = useRouter();
  const open = useSessionStore((state) => state.promptOpen);
  const returnTo = useSessionStore((state) => state.intent?.returnTo);
  const params = isInternalPath(returnTo) ? { returnTo } : {};

  return (
    <Sheet
      visible={open}
      onClose={dismissAuthPrompt}
      title={t('authRequired.title')}
      expandable={false}
      narrow
      testID="shell.authRequired"
    >
      <View style={styles.body}>
        <Text color="text.secondary" style={styles.line}>
          {t('authRequired.body')}
        </Text>
        <Button
          label={t('auth.signIn')}
          fullWidth
          size="l"
          onPress={() => {
            closeAuthPromptKeepingIntent();
            router.push({ pathname: '/auth/email', params });
          }}
          testID="shell.authRequired.signIn"
        />
        <Button
          label={t('auth.signUp')}
          variant="secondary"
          fullWidth
          size="l"
          onPress={() => {
            closeAuthPromptKeepingIntent();
            router.push({ pathname: '/sign-up', params });
          }}
          testID="shell.authRequired.signUp"
        />
        <Button
          label={t('actions.cancel')}
          variant="tertiary"
          fullWidth
          size="l"
          onPress={dismissAuthPrompt}
          testID="shell.authRequired.cancel"
        />
      </View>
    </Sheet>
  );
}
