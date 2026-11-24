/**
 * DQ-1211: the empty stage of a build without photos, WEB-01's `stage-empty` (DQ-1168): a lit shelter on wet tarmac at night, a
 * photo no content uses (no car, no member, no meet), so it never stands in for somebody's car. Licensed seed photo
 * `design/seed-photos/cover-garage-05.jpg` (CREDITS.md), bundled at 1280 px so the state shows with no network; focal point and
 * thumbhash from the seed manifest.
 */
import type { PhotoFields } from '@/ui/Photo';

export const STAGE_EMPTY_PHOTO: PhotoFields = {
  source: require('@/assets/gallery/stage-empty.jpg') as number,
  thumbhash: 'B/gJBIA4OMV1eIlwe4lIiFDL+A==',
  focal: { x: 0.5, y: 0.55 },
};
