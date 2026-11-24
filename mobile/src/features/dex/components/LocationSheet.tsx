import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/icons/Icon';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';


const useStyles = createStyles((t) => ({
  body: { gap: t.space[12], paddingBottom: t.space[8] },
  footer: { gap: t.space[8] },
}));

export type LocationSheetProps = {
  visible: boolean;
  onAllow: () => void;
  onSkip: () => void;
  /** Dismissed without a choice: this scan goes without a city, the sheet comes again next time. */
  onDismiss: () => void;
  testID: string;
};

/**
 * DEX-02, the first scan (contract §8, ADR-508): why the app would like the location before the system asks. Optional; the
 * scan goes on either way. One filled action.
 */
export function LocationSheet({ visible, onAllow, onSkip, onDismiss, testID }: LocationSheetProps) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  return (
    <Sheet
      visible={visible}
      onClose={onDismiss}
      title={t('location.title')}
      narrow
      expandable={false}
      footer={
        <View style={styles.footer}>
          <Button label={t('location.allow')} size="l" fullWidth onPress={onAllow} testID={`${testID}.allow`} />
          <Button label={t('location.skip')} variant="tertiary" size="l" fullWidth onPress={onSkip} testID={`${testID}.skip`} />
        </View>
      }
      testID={testID}
    >
      <View style={styles.body}>
        <Icon name="map-pin" size={24} color="text.secondary" />
        <Text color="text.secondary" testID={`${testID}.body`}>
          {t('location.body')}
        </Text>
      </View>
    </Sheet>
  );
}
