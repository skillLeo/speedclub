import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Chip } from '@/ui/Chip';
import { Text } from '@/ui/Text';
import { haptics } from '@/ui/motion';

const useStyles = createStyles((t) => ({
  root: { alignItems: 'flex-start', gap: t.space[8], paddingBottom: t.space[12] },
}));

/**
 * EVT-01 Karte, the "Spots" layer (contract §6/§8): one toggle chip and, while it is on, the rule that keeps it private (SEC-P5G-03,
 * `dex.map.min_cars`): only cities with spots of at least 5 different cars, each spot older than 24 hours. No per-car pins, ever.
 */
export function SpotLayerToggle({ on, onChange, failed, testID }: { on: boolean; onChange: (next: boolean) => void; failed: boolean; testID: string }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  return (
    <View style={styles.root} testID={testID}>
      <Chip
        label={t('map.layer')}
        accessibilityLabel={t('map.layerLabel')}
        icon="map-trifold"
        selected={on}
        selectionRole="checkbox"
        onPress={() => {
          haptics.selection();
          onChange(!on);
        }}
        testID={`${testID}.chip`}
      />
      {on ? (
        <Text variant="caption" color="text.secondary" numeric testID={`${testID}.caption`}>
          {failed ? t('map.unavailable') : t('map.caption')}
        </Text>
      ) : null}
    </View>
  );
}
