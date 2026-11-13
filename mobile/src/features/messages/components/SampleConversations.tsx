import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { EMPTY_HERO, SAMPLE_CARD_PHOTO } from '@/features/garage/sample';
import { createStyles } from '@/theme';
import { SampleBadge, Text, type PhotoFields } from '@/ui';

import { CarBadgeAvatar } from './CarBadgeAvatar';

const useStyles = createStyles((t) => ({
  list: { pointerEvents: 'none' },
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.withThumb, paddingVertical: t.space[8] },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  line: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  name: { flexShrink: 1, minWidth: 0 },
  spacer: { flex: 1 },
}));

type Sample = { key: string; name: string; message: 'sampleQuestion' | 'sampleMeet'; time: string; car: PhotoFields };

/**
 * DQ-1033 (09 §5 EmptyState, §7.8): the preview of an empty MSG-01, two conversation rows as they will look (avatar 56 with the car
 * badge, name, last message, time), each badged "Beispiel". A picture of the state: hidden from readers and not pressable. The
 * names are the same in every language.
 */
export function SampleConversations({ testID }: { testID: string }) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const samples: readonly Sample[] = [
    { key: 'question', name: 'Kenji', message: 'sampleQuestion', time: t('inbox.sample.timeQuestion'), car: SAMPLE_CARD_PHOTO }, // i18n-ignore
    { key: 'meet', name: 'Lukas', message: 'sampleMeet', time: t('inbox.sample.timeMeet'), car: EMPTY_HERO }, // i18n-ignore
  ];
  return (
    <View aria-hidden style={styles.list} testID={testID}>
      {samples.map((sample) => (
        <View key={sample.key} style={styles.row} testID={`${testID}.${sample.key}`}>
          <CarBadgeAvatar name={sample.name} car={sample.car} />
          <View style={styles.text}>
            <View style={styles.line}>
              <Text variant="bodyStrong" numberOfLines={1} hyphenate={false} style={styles.name}>
                {sample.name}
              </Text>
              <SampleBadge />
              <View style={styles.spacer} />
              <Text variant="caption" color="text.tertiary">
                {sample.time}
              </Text>
            </View>
            <Text variant="callout" color="text.secondary" numberOfLines={1}>
              {t(`inbox.sample.${sample.message}`)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

