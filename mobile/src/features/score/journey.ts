/**
 * M5.9c Build Journey (contract §2): a before/after pair as Verlauf and the owner's history set it, side by side, with the mod of a
 * before/after post under it ("Vorher/Nachher: KW V3").
 */
import type { TFunction } from 'i18next';

import type { BuildUpdate } from '@/api/queries/vehicles';
import type { PhotoPair } from '@/features/updates/model';
import { photoFields } from '@/features/vehicle/media';
import type { TimelineEntry } from '@/ui/Timeline';

import { updateKindOf } from './model';

/** The Timeline's side-by-side pair of an update; `photoWidth` is the width each half is drawn at (for the variant). */
export function journeyPair(update: BuildUpdate, pair: PhotoPair, t: TFunction<'vehicle'>, photoWidth: number): NonNullable<TimelineEntry['beforeAfter']> {
  const mod = updateKindOf(update) === 'before_after' ? update.modifications[0]?.title : undefined;
  return {
    before: { ...photoFields(pair.before, photoWidth), label: t('update.before') },
    after: { ...photoFields(pair.after, photoWidth), label: t('update.after') },
    label: t('update.beforeAfter'),
    layout: 'pair',
    ...(mod ? { caption: t('score.pairCaption', { mod }) } : {}),
  };
}
