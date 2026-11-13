import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles, layout, useBreakpoint } from '@/theme';
import { Button, Photo, PhotoStageScrim, SectionHeader, Text, VehicleCard } from '@/ui';

import { EMPTY_HERO, SAMPLE_CARD_PHOTO } from '../sample';

const ROUTE = 'GAR-01';

const useStyles = createStyles((t) => ({
  root: { paddingBottom: t.space[32] },
  // The title sits in the photo's bottom band, on the scrim: large text, inside the large-text safe line (ADR-421 b).
  heroText: { bottom: 0, left: 0, paddingBottom: t.space[20], position: 'absolute', right: 0 },
  below: { gap: t.space[16], paddingTop: t.space[16] },
  columns: { columnGap: t.space[32], flexDirection: 'row', rowGap: t.space[24] },
  intro: { flex: 1, gap: t.space[16], minWidth: 0 },
  sample: { gap: t.space[12] },
  sampleWide: { flex: 1, minWidth: 0 },
}));

export type GarageEmptyProps = {
  onAdd: () => void;
  disabled?: boolean;
  /** The pane's width (the list's), so the photo bleeds to its edges and the sample card knows its width before layout. */
  paneWidth: number;
};

/**
 * GAR-01 empty (09 §7.6): a full-bleed night photo with `title.2` "Deine Garage wartet." on its scrim, one line, the one filled
 * action "Auto hinzufügen", and a real VehicleCard badged "Beispiel" that shows what the garage turns into. Phones and tablets
 * stack; from 1280 the line and the action stand beside the sample card, so the page is not a phone column stretched wide.
 */
export function GarageEmpty({ onAdd, disabled = false, paneWidth }: GarageEmptyProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const { gutter, kind } = useBreakpoint();
  const wide = kind === 'desktop';
  const content = Math.min(paneWidth, layout.contentMax) - 2 * gutter;
  const cardWidth = wide ? (content - layout.grid.desktop.gutter) / 2 : Math.min(content, layout.feedColumn);
  const pad = { paddingHorizontal: gutter };

  const intro = (
    <View style={wide ? styles.intro : styles.below}>
      <Text variant="body" color="text.secondary" testID={`${ROUTE}.empty.body`}>
        {t('garage.emptyBody')}
      </Text>
      <Button label={t('garage.emptyAction')} size="l" fullWidth={!wide} disabled={disabled} onPress={onAdd} testID={`${ROUTE}.empty.action`} />
    </View>
  );
  const sample = (
    <View style={[styles.sample, wide ? styles.sampleWide : null]}>
      <SectionHeader title={t('garage.sampleTitle')} testID={`${ROUTE}.empty.sampleTitle`} />
      {/* DQ-1050: the same 2.0 card the garage will show, badged "Beispiel". */}
      <VehicleCard
        variant="garage"
        title={t('garage.sample.title')}
        caption={t('garage.sample.caption')}
        photo={SAMPLE_CARD_PHOTO}
        stats={[
          { key: 'power', value: '500', unit: 'PS', label: t('garage.card.power') },
          { key: 'torque', value: '540', unit: 'Nm', label: t('garage.card.torque') },
          { key: 'model_year', value: '2002', label: t('garage.card.model_year') },
        ]}
        status={t('garage.status.public')}
        sample={{ is_sample: true }}
        layoutWidth={cardWidth}
        style={{ width: cardWidth }}
        testID={`${ROUTE}.empty.sample`}
      />
    </View>
  );

  return (
    <View style={styles.root} testID={`${ROUTE}.empty`}>
      <Photo {...EMPTY_HERO} aspect={wide || kind === 'tablet' ? '16:9' : '4:5'} corner="none" testID={`${ROUTE}.empty.photo`}>
        <PhotoStageScrim />
        <View style={[styles.heroText, pad]}>
          <Text variant="title2" color="onPhoto.primary" role="heading" aria-level={2} testID={`${ROUTE}.empty.title`}>
            {t('garage.emptyTitle')}
          </Text>
        </View>
      </Photo>
      {wide ? (
        <View style={[styles.columns, styles.below, pad]}>
          {intro}
          {sample}
        </View>
      ) : (
        <View style={[styles.below, pad]}>
          {intro}
          {sample}
        </View>
      )}
    </View>
  );
}
