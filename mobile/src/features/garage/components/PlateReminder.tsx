import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Icon, Text } from '@/ui';

const useStyles = createStyles((t) => ({
  reminder: { alignItems: 'flex-start', backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, flexDirection: 'row', gap: t.space[12], padding: t.space[16] },
  text: { flex: 1, gap: t.space[4] },
}));

/**
 * "Achte auf Kennzeichen und Personen" (GAR-12, and step 4 of the wizard before publishing, 09 §7.6): a quiet info row, not a
 * warning — the member decides what their photos show.
 */
export function PlateReminder({ testID }: { testID: string }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  return (
    <View style={styles.reminder} testID={testID}>
      <Icon name="info" size={20} color="text.secondary" />
      <View style={styles.text}>
        <Text variant="bodyStrong">{t('visibility.plateTitle')}</Text>
        <Text variant="callout" color="text.secondary">
          {t('visibility.plateBody')}
        </Text>
      </View>
    </View>
  );
}
