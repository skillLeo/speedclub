import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { EMPTY_HERO, SAMPLE_CARD_PHOTO } from '@/features/garage/sample';
import { createStyles, size } from '@/theme';
import { Avatar, Photo, SampleBadge, Text, type PhotoFields } from '@/ui';

const useStyles = createStyles((t) => ({
  list: { gap: t.space[4], pointerEvents: 'none' },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12], paddingVertical: t.space[12] },
  text: { flex: 1, gap: t.space[4], minWidth: 0 },
  meta: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  thumb: { borderRadius: t.radius.sm, flexShrink: 0, height: t.size.avatar.md, overflow: 'hidden', width: t.size.avatar.md },
}));

/** The bold runs of a sentence: the actor and the object, as HOME-02 sets them. */
export function boldRuns(text: string, strong: readonly string[]): { text: string; strong: boolean }[] {
  const names = strong.filter(Boolean);
  if (names.length === 0) return [{ text, strong: false }];
  const pattern = new RegExp(`(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'u');
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, strong: names.includes(part) }));
}

type Sample = { key: string; name: string; car: string; message: 'sampleUpdate' | 'sampleFollow'; time: string; photo: PhotoFields };

/**
 * DQ-1033 (09 §5 EmptyState, §7.4): the preview of an empty HOME-02, two rows as notifications will look, each badged "Beispiel". It
 * is a picture of the state: hidden from readers and not pressable. Names and cars are the same in every language.
 */
export function SampleNotifications({ testID }: { testID: string }) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const samples: readonly Sample[] = [
    { key: 'update', name: 'Lukas', car: 'E46 M3', message: 'sampleUpdate', time: t('notifications.sampleTimeUpdate'), photo: EMPTY_HERO }, // i18n-ignore
    { key: 'follow', name: 'Kenji', car: 'Skyline R34', message: 'sampleFollow', time: t('notifications.sampleTimeFollow'), photo: SAMPLE_CARD_PHOTO }, // i18n-ignore
  ];
  return (
    <View aria-hidden style={styles.list} testID={testID}>
      {samples.map((sample) => {
        const sentence = t(`notifications.${sample.message}`, { name: sample.name, car: sample.car });
        return (
          <View key={sample.key} style={styles.row} testID={`${testID}.${sample.key}`}>
            <Avatar decorative name={sample.name} size={size.avatar.md} />
            <View style={styles.text}>
              <Text variant="body">
                {boldRuns(sentence, [sample.name, sample.car]).map((run, index) =>
                  run.strong ? (
                    <Text key={index} variant="bodyStrong" hyphenate={false}>
                      {run.text}
                    </Text>
                  ) : (
                    <Fragment key={index}>{run.text}</Fragment>
                  ),
                )}
              </Text>
              <View style={styles.meta}>
                <Text variant="caption" color="text.tertiary">
                  {sample.time}
                </Text>
                <SampleBadge />
              </View>
            </View>
            <View style={styles.thumb}>
              <Photo {...sample.photo} aspect="1:1" />
            </View>
          </View>
        );
      })}
    </View>
  );
}
