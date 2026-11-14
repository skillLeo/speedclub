import type { TFunction } from 'i18next';

import type { VehicleCardData } from '@/api/queries/profile';
import { photoFields } from '@/features/profile/media';
import type { VehicleCardProps, VehicleCardStat } from '@/ui';

/** The mini spec of the 2.0 card (09 §5): power, torque, model year — the drivetrain stays on the vehicle page. */
const STAT_KEYS = ['power', 'torque', 'model_year'] as const;

/** The meta parts the web's garage card shows (WEB-02 vehicle-card.blade.php: the first two of `subline_parts`, year and engine). */
const CAPTION_PARTS = 2;

/**
 * The meta under the card's name (09 §5, DQ-1223): the vehicle's sub-line as on WEB-01 and the web's garage card (DQ-1175), never the
 * name again. The server's `subline_parts` are year, engine and colour ("2002", "2,6 l R6 Biturbo (RB26DETT)", "Bayside Blue"); the
 * web card shows the first two. The app's card shows the year as its BAUJAHR stat, so with `yearInStats` the caption leaves it out:
 * "2,6 l R6 Biturbo (RB26DETT)". Undefined when nothing is left (a draft without year or engine).
 */
export function cardCaption(card: Pick<VehicleCardData, 'subline_parts' | 'model_year'>, { yearInStats }: { yearInStats: boolean }): string | undefined {
  const year = card.model_year === null ? null : String(card.model_year);
  const parts = card.subline_parts
    .slice(0, CAPTION_PARTS)
    .filter((part) => part.trim() !== '' && !(yearInStats && part === year));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * "BMW · M3 · G80 · 2021": the catalogue parts that are known. Only for GAR-03's photo-less preview stage, whose draft may have no
 * engine yet; the garage card uses cardCaption.
 */
export function catalogueCaption(card: Pick<VehicleCardData, 'make' | 'model' | 'generation' | 'model_year'>): string | undefined {
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
  const stats = cardStats(card, t);
  return {
    variant: 'garage',
    title: card.full_title.trim() || t('wizard.untitled'),
    photo: photoFields(card.cover, width),
    caption: cardCaption(card, { yearInStats: stats.some((stat) => stat.key === 'model_year') }),
    stats,
    status: t(`garage.status.${cardStatus(card)}`),
    isMain: card.is_main,
    sample: { is_sample: card.is_sample },
    layoutWidth: width,
  };
}
