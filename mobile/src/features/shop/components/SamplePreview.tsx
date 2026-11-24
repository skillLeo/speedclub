import '@/features/shop/i18n';

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { aspect, createStyles } from '@/theme';
import { SampleBadges } from '@/ui/Badge';
import { Photo } from '@/ui/Photo';
import { Text } from '@/ui/Text';

import { SHOP_PHOTO } from './ShopClosed';

const useStyles = createStyles((t) => ({
  // Half the column, as one cell of the 2-column wall.
  tile: { maxWidth: '50%', width: '100%' },
  badges: { left: t.space[8], position: 'absolute', top: t.space[8] },
  text: { paddingTop: t.space[8] },
}));

/**
 * 09 §5 EmptyState preview for the shop: one wall cell as a product will look (4:5, 0 radius, the name below), badged "Beispiel".
 * The licensed GT86 frame with its windscreen sticker, and no price: a picture of the state, not an offer, hidden from readers.
 */
export function SamplePreview({ testID }: { testID: string }) {
  const { t } = useTranslation('shop');
  const styles = useStyles();
  return (
    <View aria-hidden style={styles.tile} testID={testID}>
      <Photo {...SHOP_PHOTO} aspect={aspect.gridTall}>
        <SampleBadges flags={{ is_sample: true }} tone="onPhoto" style={styles.badges} testID={`${testID}.badge`} />
      </Photo>
      <View style={styles.text}>
        <Text variant="headline" numberOfLines={2}>
          {t('empty.sampleName')}
        </Text>
      </View>
    </View>
  );
}
