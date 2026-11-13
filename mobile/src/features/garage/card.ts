import type { TFunction } from 'i18next';

import type { VehicleCardData } from '@/api/queries/profile';
import { photoFields } from '@/features/profile/media';
import type { VehicleCardProps, VehicleCardStat } from '@/ui';

/** The mini spec of the 2.0 card (09 §5): power, torque, model year — the drivetrain stays on the vehicle page. */
const STAT_KEYS = ['power', 'torque', 'model_year'] as const;

/** "BMW · M3 · G80 · 2021": the caption of 09 §5 from the catalogue parts that are known. */
export function cardCaption(card: Pick<VehicleCardData, 'make' | 'model' | 'generation' | 'model_year'>): string | undefined {
  const parts = [card.make, card.model, card.generation, card.model_year === null ? null : String(card.model_year)].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** The cells with a value; a value not entered yet stays out rather than showing a dash on the owner's own card. */
export function cardStats(card: Pick<VehicleCardData, 'spec_strip'>, t: TFunction<'garage'>): VehicleCardStat[] {
  return STAT_KEYS.flatMap((key) => {
    const item = card.spec_strip.find((entry) => entry.key === key);
    if (!item?.value) return [];
    return [{ key, value: item.value, unit: key === 'model_year' ? null : item.unit, label: t(`garage.card.${key}`) }];
  });
}

export type CardStatus = 'public' | 'unlisted' | 'private' | 'draft';

/** The status pill of 09 §5: a draft is "Entwurf" whatever its planned visibility; archived builds are not on GAR-01. */
export function cardStatus(card: Pick<VehicleCardData, 'status' | 'visibility'>): CardStatus {
  return card.status === 'draft' ? 'draft' : card.visibility;
}

/** Everything the 2.0 garage card shows of a vehicle. */
export function garageCardProps(
  card: VehicleCardData,
  width: number,
  t: TFunction<'garage'>,
): Pick<VehicleCardProps, 'variant' | 'title' | 'photo' | 'caption' | 'stats' | 'status' | 'isMain' | 'sample' | 'layoutWidth'> {
  return {
    variant: 'garage',
    title: card.full_title.trim() || t('wizard.untitled'),
    photo: photoFields(card.cover, width),
    caption: cardCaption(card),
    stats: cardStats(card, t),
    status: t(`garage.status.${cardStatus(card)}`),
    isMain: card.is_main,
    sample: { is_sample: card.is_sample },
    layoutWidth: width,
  };
}
