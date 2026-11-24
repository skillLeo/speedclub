/**
 * The sample spot (09 §5 "never empty"): a real car on the licensed seed photo the garage's empty state uses
 * (design/seed-photos/CREDITS.md), always badged "Beispiel" where a member sees it (DEX-02 on the web). No counts, no owner:
 * nothing on it claims to be somebody's real data. The non-production `qaDex` override shows DEX-03 with it, so the visual matrix
 * can capture the reveal before the server has spots.
 */
import type { SpotResponse, SpottedCard } from '@/api/queries/dex';
import { SAMPLE_CARD_PHOTO } from '@/features/garage/sample';
import type { QaDex } from '@/lib/qa';

export const SAMPLE_SPOT_ID = 'sample';
export const SAMPLE_PHOTO = SAMPLE_CARD_PHOTO;

export const SAMPLE_SPOT: SpottedCard = {
  spot_id: SAMPLE_SPOT_ID,
  spotted_at: '2026-10-30T16:30:00+01:00',
  spotted: true,
  vehicle: {
    id: 'sample',
    slug: 'sample',
    name: 'Nissan Skyline GT-R R34', // i18n-ignore: a car name
    make: 'Nissan', // i18n-ignore
    make_slug: 'nissan', // i18n-ignore
    model: 'Skyline GT-R', // i18n-ignore
    generation: 'R34', // i18n-ignore
    generation_slug: 'r34', // i18n-ignore
    dex_number: null,
    rarity: 'rare',
    ghost: false,
    cover: null,
    top_mods: [
      { name: 'Variant 3', brand: 'KW' }, // i18n-ignore
      { name: 'TE37 SL', brand: 'Volk Racing' }, // i18n-ignore
      { name: 'Hi-Power Spec-L II', brand: 'HKS' }, // i18n-ignore
    ],
    owner: null,
  },
  first_spotter: false,
  cities_count_label: null,
};

const QA_DEX_NUMBER = 34;

/** DEX-03 under `qaDex` (non-production only): the reveal in each of its variants. */
export function qaSpotResponse(variant: QaDex): SpotResponse {
  const ghost = variant === 'ghost';
  const first = variant === 'first';
  return {
    data: {
      ...SAMPLE_SPOT,
      first_spotter: first,
      // The number shows where a real card prints it; the cells are QA pictures, never seen by a member.
      vehicle: { ...SAMPLE_SPOT.vehicle, dex_number: QA_DEX_NUMBER, ghost, rarity: ghost ? 'ghost' : 'rare' },
    },
    meta: {
      new_in_dex: variant !== 'duplicate',
      duplicate: variant === 'duplicate',
      first_spotter: first,
      counted: variant !== 'young',
      reason: variant === 'young' ? 'account_too_new' : null,
      set_progress: [],
    },
  };
}
