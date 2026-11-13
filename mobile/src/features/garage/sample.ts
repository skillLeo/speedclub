/**
 * The empty garage's real preview (09 §7.6 GAR-01 empty, SKILL "Never empty"): licensed seed photos bundled with the app
 * (design/seed-photos/CREDITS.md, the same files DEV-01 shows) and a real car, always badged "Beispiel". Focal points come from
 * the seed manifest, the blurhashes were computed once from these files (features/gallery/data.ts).
 */
import type { PhotoFields } from '@/ui';

export const EMPTY_HERO: PhotoFields = {
  source: require('@/assets/gallery/bmw-e46-01.jpg') as number,
  blurhash: 'LVEeGM-UE2V@}mxYR-jZ-QoJWXoL',
  focal: { x: 0.49, y: 0.59 },
};

export const SAMPLE_CARD_PHOTO: PhotoFields = {
  source: require('@/assets/gallery/nissan-r34-01.jpg') as number,
  blurhash: 'LoGlekxvjYof_Nt7ayj]M{j@ofWB',
  focal: { x: 0.54, y: 0.66 },
};
