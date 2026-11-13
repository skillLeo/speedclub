/**
 * DQ-1033 / 09 §5 EmptyState: the real components with sample data, badged "Beispiel", above the empty profile tabs. They show
 * what the tab turns into; they are decorative (hidden from screen readers, which read the state's title and line).
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { PHOTOS } from '@/features/gallery/data';
import { EMPTY_HERO, SAMPLE_CARD_PHOTO } from '@/features/garage/sample';
import { createStyles, size, space } from '@/theme';
import { BuildUpdateRow, SampleBadge, VehicleCard } from '@/ui';

import { EventDateRow } from './EventDateRow';

const useStyles = createStyles((t) => ({
  stack: { gap: t.space[8] },
  list: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
}));

/** A real VehicleCard of the bundled R34, at the width of the column. */
export function SampleGarageCard({ width, testID }: { width: number; testID: string }) {
  const { t } = useTranslation('garage');
  return (
    <View aria-hidden testID={testID}>
      <VehicleCard
        title={t('garage.sample.title')}
        subtitle={t('garage.sample.subtitle')}
        photo={SAMPLE_CARD_PHOTO}
        specs={[t('garage.sample.power'), t('garage.sample.torque'), t('garage.sample.drive')]}
        sample={{ is_sample: true }}
        style={{ width }}
      />
    </View>
  );
}

/** Two build-update rows as the Updates tab shows them. */
export function SampleUpdates({ testID }: { testID: string }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  return (
    <View aria-hidden style={styles.stack} testID={testID}>
      <SampleBadge />
      <View style={styles.list}>
        <BuildUpdateRow
          title={t('tabs.sample.updateTitle')}
          diff={t('tabs.sample.updateDiff')}
          meta={t('tabs.sample.updateMeta')}
          photo={PHOTOS.wheels}
          inset={space[16]}
        />
        <BuildUpdateRow
          title={t('tabs.sample.update2Title')}
          diff={t('tabs.sample.update2Diff')}
          meta={t('tabs.sample.update2Meta')}
          photo={EMPTY_HERO}
          inset={space[16]}
          divider={false}
        />
      </View>
    </View>
  );
}

/** One event row as the Treffen tab shows it. */
export function SampleEvent({ testID }: { testID: string }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  return (
    <View aria-hidden style={styles.stack} testID={testID}>
      <SampleBadge />
      <View style={styles.list}>
        <EventDateRow
          day={t('tabs.sample.eventDay')}
          month={t('tabs.sample.eventMonth')}
          title={t('tabs.sample.eventTitle')}
          meta={t('tabs.sample.eventMeta')}
          divider={false}
        />
      </View>
    </View>
  );
}

/** The thumb of a row: the same 56 the rows use. */
export const ROW_THUMB = size.thumb.row;
