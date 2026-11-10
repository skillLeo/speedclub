import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useFlag } from '@/api/queries/appConfig';
import { useSimilarBuilds } from '@/api/queries/discover';
import type { FeedVehicle } from '@/api/queries/home';

import { SimilarBuildsList } from './SimilarBuildsList';

export type SimilarBuildsStripProps = {
  vehicleId: string;
  /** The base build's name, for the strip's accessible name. */
  title: string;
  /** The column's gutter, so the strip runs to the screen edge (0 where the column has none). */
  bleed: number;
  /** `<ROUTE-ID>.similar`. */
  testID: string;
};

/**
 * VEH-01 [SIG `sig.similar_builds`] "Ähnliche Builds" on the Übersicht tab (FS-3): same generation, then model, then make
 * with similar power (m2.3 handover §8). Nothing is drawn while it loads, when it fails, when it is empty or the flag is off:
 * the strip is an extra at the end of the tab, never a hole in it.
 */
export function SimilarBuildsStrip({ vehicleId, title, bleed, testID }: SimilarBuildsStripProps) {
  const { t } = useTranslation('discover');
  const router = useRouter();
  const enabled = useFlag('sig.similar_builds');
  const similar = useSimilarBuilds(vehicleId, enabled);
  const open = useCallback((vehicle: FeedVehicle) => router.push(`/v/${vehicle.slug}`), [router]);
  const vehicles = similar.data ?? [];
  if (!enabled || vehicles.length === 0) return null;
  return (
    <SimilarBuildsList
      title={t('similar.title')}
      label={t('similar.label', { title })}
      vehicles={vehicles}
      onOpen={open}
      bleed={bleed}
      testID={testID}
    />
  );
}
