import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useFlag } from '@/api/queries/appConfig';
import { useSimilarBuilds } from '@/api/queries/discover';
import type { FeedVehicle } from '@/api/queries/home';
import { SimilarBuildsList } from '@/features/discover/components/SimilarBuildsList';
import { railSpec } from '@/features/home/components/NewInGarageRail';

/** DQ-1063: at most this many sample builds ("Beispiel") in the rail, so samples never read as a stack of filler. */
export const SIMILAR_SAMPLE_MAX = 2;

/**
 * What makes two rail cards look the same: exactly what the card prints, the name and its spec line (railSpec: the first two
 * values). DQ-1063 r2: comparing the whole strip let sample R34s through that differ only in a value the card never shows (the
 * weight), so three "Nissan Skyline GT-R R34 · 280 PS · 392 Nm" stood side by side.
 */
function lookOf(vehicle: FeedVehicle): string {
  return `${vehicle.full_title}|${railSpec(vehicle) ?? ''}`;
}

/**
 * DQ-1063 (09 §14.3 "no identical-card stack", §8.19 samples): real builds first, in the API's order; sample builds only when they
 * look different from every card already kept, and at most `SIMILAR_SAMPLE_MAX` of them.
 */
export function distinctSimilar(vehicles: readonly FeedVehicle[]): FeedVehicle[] {
  const real = vehicles.filter((vehicle) => !vehicle.is_sample);
  const seen = new Set(real.map(lookOf));
  const samples: FeedVehicle[] = [];
  for (const vehicle of vehicles) {
    if (!vehicle.is_sample || samples.length >= SIMILAR_SAMPLE_MAX) continue;
    const look = lookOf(vehicle);
    if (seen.has(look)) continue;
    seen.add(look);
    samples.push(vehicle);
  }
  return [...real, ...samples];
}

export type SimilarBuildsProps = {
  vehicleId: string;
  /** The base build's name, for the rail's accessible name. */
  title: string;
  bleed: number;
  testID: string;
};

/**
 * VEH-01 [SIG `sig.similar_builds`] "Ähnliche Builds": the discover rail with distinct cards only (DQ-1063). Nothing is drawn
 * while it loads, when it fails, when it is empty or the flag is off.
 */
export function SimilarBuilds({ vehicleId, title, bleed, testID }: SimilarBuildsProps) {
  const { t } = useTranslation('discover');
  const router = useRouter();
  const enabled = useFlag('sig.similar_builds');
  const similar = useSimilarBuilds(vehicleId, enabled);
  const open = useCallback((vehicle: FeedVehicle) => router.push(`/v/${vehicle.slug}`), [router]);
  const vehicles = distinctSimilar(similar.data ?? []);
  if (!enabled || vehicles.length === 0) return null;
  return <SimilarBuildsList title={t('similar.title')} label={t('similar.label', { title })} vehicles={vehicles} onOpen={open} bleed={bleed} testID={testID} />;
}
