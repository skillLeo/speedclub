import { usePublicVehicle, type VehicleMedia } from '@/api/queries/vehicles';

import { visiblePhotos } from './media';

/** What a card knows of its build: the page slug, its cover and how many photos the build has. */
export type CoverCard = { slug: string; cover: VehicleMedia | null; photo_count: number };

/**
 * The photo a card shows when the page above it already shows `avoid` (DQ-1160 PROF-01, DQ-1215 BIZ-01): no picture twice in the
 * first scroll (skill rule 6). Pure, for the tests: the card's cover unless it is that photo; then the build's next gallery photo,
 * when known; else the cover (a build with one photo has no other to give).
 */
export function distinctCover(card: Pick<CoverCard, 'cover'>, avoid: string | null | undefined, gallery: readonly VehicleMedia[] | undefined): VehicleMedia | null {
  const cover = card.cover;
  if (!cover || !avoid || cover.id !== avoid) return cover;
  return gallery?.find((photo) => photo.id !== avoid) ?? cover;
}

/** True when the card would repeat `avoid` and its build has another photo to show instead. */
export function needsOtherCover(card: CoverCard, avoid: string | null | undefined): boolean {
  return Boolean(avoid && card.cover?.id === avoid && card.photo_count > 1);
}

/**
 * `distinctCover` with the gallery read from the build page (the card resources carry the cover only). The page is read only for
 * the one card that clashes, and it is the query VEH-01 uses, so opening the card afterwards starts from the cache.
 */
export function useDistinctCover(card: CoverCard, avoid: string | null | undefined): VehicleMedia | null {
  const page = usePublicVehicle(needsOtherCover(card, avoid) ? card.slug : undefined);
  return distinctCover(card, avoid, page.data ? visiblePhotos(page.data.photos) : undefined);
}
