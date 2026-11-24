import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { carOfTheDayDate, type CarOfTheDay } from '@/api/queries/carOfTheDay';
import type { FeedVehicle } from '@/api/queries/home';
import { leadMinHeight } from '@/features/home/components/HomeLead';
import { railSpec } from '@/features/home/components/NewInGarageRail';
import { photoFields, variantUrl } from '@/features/profile/media';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, useBreakpoint } from '@/theme';
import { Button } from '@/ui/Button';
import { MediaCard } from '@/ui/MediaCard';
import { Text } from '@/ui/Text';

import { qaCarOfTheDayPhoto } from '../qaGift';
import { CarOfTheDayEditorLazy } from './CarOfTheDayEditorLazy';

const useStyles = createStyles((t) => ({
  label: { alignItems: 'baseline', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', paddingBottom: t.space[12] },
  below: { alignItems: 'flex-start', gap: t.space[8], paddingTop: t.space[12] },
}));

export type CarOfTheDayModuleProps = {
  pick: CarOfTheDay;
  /** The photo's width (the pane on a phone, the column wider). */
  width: number;
  /** The signed-in member owns the car: the story editor is theirs. */
  own: boolean;
  onOpen: (vehicle: FeedVehicle) => void;
  /** The gutter for the label and the lines under the photo when the photo runs edge to edge. */
  textStyle?: StyleProp<ViewStyle>;
  testID: string;
};

/**
 * HOME-01 lead "Car of the Day" (contract §3, §8; 09 §7.3 position 1): the label "Car of the Day · 14. Nov." (tnum), the car as the
 * `lead` MediaCard (4:5 full bleed on a phone, the name in display.title, owner chip, "Beispiel" on a sample, the photo already
 * pixelated by the server, ADR-509), then its one story line in quotes. The owner reads that the car is featured until 18:00
 * tomorrow and writes or edits the line (CarOfTheDayEditor). It takes the lead's place: Start shows one lead, never two.
 */
export const CarOfTheDayModule = memo(function CarOfTheDayModule({ pick, width, own, onOpen, textStyle, testID }: CarOfTheDayModuleProps) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const format = useFormat();
  const { kind } = useBreakpoint();
  const [editing, setEditing] = useState(false);
  // M5.12a: the editor is a chunk of its own on the web, loaded at the first open and mounted from then on (it closes with its own
  // animation afterwards).
  const [opened, setOpened] = useState(false);
  const vehicle = pick.vehicle;
  const date = format.dayMonth(carOfTheDayDate(pick.day));
  const owner = pick.owner ?? vehicle.owner;
  return (
    <View testID={testID}>
      <View style={[styles.label, textStyle]} aria-label={t('carOfTheDay.labelA11y', { date: format.longDate(carOfTheDayDate(pick.day)) })} testID={`${testID}.label`}>
        <Text variant="calloutStrong" role="heading" aria-level={2} hyphenate={false}>
          {t('carOfTheDay.label')}
        </Text>
        <Text variant="callout" color="text.secondary" numeric hyphenate={false} aria-hidden>
          {`· ${t('carOfTheDay.date', { date })}`}
        </Text>
      </View>
      <View style={{ minHeight: leadMinHeight(width, kind === 'desktop') }}>
        <MediaCard
          variant="lead"
          title={vehicle.full_title}
          photo={qaCarOfTheDayPhoto(vehicle.id) ?? photoFields(vehicle.cover, width)}
          spec={railSpec(vehicle)}
          owner={
            owner
              ? { username: owner.username, avatarUri: variantUrl(owner.avatar, size.avatar.sm), avatarBlurhash: owner.avatar?.blurhash ?? null }
              : undefined
          }
          sample={{ is_sample: vehicle.is_sample || owner?.is_sample === true, is_editorial: owner?.is_editorial ?? false }}
          layoutWidth={width}
          priority="high"
          onPress={() => onOpen(vehicle)}
          testID={`${testID}.card`}
        />
      </View>
      {pick.story_line || own ? (
        <View style={[styles.below, textStyle]}>
          {pick.story_line ? (
            <Text variant="body" testID={`${testID}.story`}>
              {t('carOfTheDay.story', { story: pick.story_line })}
            </Text>
          ) : null}
          {own ? (
            <>
              <Text variant="callout" color="text.secondary" testID={`${testID}.ownerNote`}>
                {t('carOfTheDay.ownerNote')}
              </Text>
              <Button
                label={pick.story_line ? t('carOfTheDay.edit') : t('carOfTheDay.add')}
                icon="pencil-simple"
                variant="secondary"
                size="m"
                onPress={() => {
                  setOpened(true);
                  setEditing(true);
                }}
                testID={`${testID}.edit`}
              />
            </>
          ) : null}
        </View>
      ) : null}
      {own && opened ? (
        <CarOfTheDayEditorLazy
          visible={editing}
          vehicleId={vehicle.id}
          storyLine={pick.story_line}
          onClose={() => setEditing(false)}
          testID={`${testID}.editor`}
        />
      ) : null}
    </View>
  );
});
