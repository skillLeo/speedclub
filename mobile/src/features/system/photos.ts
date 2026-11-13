/**
 * The photographs of the system states (09 §7.14: photo-backed brand states where appropriate): licensed seed photos bundled with
 * the app (design/seed-photos/CREDITS.md, the files DEV-01 and the empty garage use), so a gate shows them with no network. Focal
 * points from the seed manifest; blurhashes computed once from these files (features/gallery/data.ts).
 */
import type { PhotoFields } from '@/ui';

/** SYS-01 update: a wheel and caliper in the garage, the car waiting for its next part. */
export const UPDATE_PHOTO: PhotoFields = {
  source: require('@/assets/gallery/generic-wheels-01.jpg') as number,
  blurhash: 'LAAJ=-~p9]?cxvMxITogyX-;whI[',
  focal: { x: 0.35, y: 0.5 },
};

/** SYS-02 maintenance: an interior at night, the car parked while we work. */
export const MAINTENANCE_PHOTO: PhotoFields = {
  source: require('@/assets/gallery/generic-interior-01.jpg') as number,
  blurhash: 'LPBM_PIUxut7~qM{oft7_3Rjofj[',
  focal: { x: 0.55, y: 0.5 },
};

/**
 * SYS-03 not found, revoked, private (DQ-1088): a dark RS3 alone on a crossing at night, the way on unclear. Its own photo, not the
 * E46 of the GAR-03 fallback or the sample events' covers; plate blurred in the seed set. Focal point and thumbhash from the manifest.
 */
export const NOT_FOUND_PHOTO: PhotoFields = {
  source: require('@/assets/gallery/audi-rs3-8y-01.jpg') as number,
  thumbhash: 'zvcJFQSVl4R4eGj3d5mHqKmCnxr4',
  focal: { x: 0.5, y: 0.53 },
};
