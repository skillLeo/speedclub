import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useSpotStats, type SpotStats } from '@/api/queries/dex';
import { useFormat } from '@/lib/useFormat';
import { space } from '@/theme';
import { ListRow } from '@/ui/ListRow';
import { RowGroup } from '@/ui/RowGroup';

import { ownerSpotsRoute } from '../navigation';
import { qaDexActive, qaSpotStats } from '../qaDex';

/**
 * "Gespottet von 112 Leuten in 9 Städten": unique spotters and the cities of day spots (contract §0/§4); without cities (hidden, or
 * night spots only) "Gespottet von 112 Leuten". Null while nobody has spotted the car: the line never says 0.
 */
export function ownerSpotLineText(t: TFunction, stats: Pick<SpotStats, 'unique_spotters' | 'cities_count'>, number: (value: number) => string): string | null {
  if (stats.unique_spotters <= 0) return null;
  const people = t('owner.people', { count: stats.unique_spotters, formatted: number(stats.unique_spotters) });
  if (stats.cities_count <= 0) return t('owner.linePeople', { people });
  return t('owner.line', { people, cities: t('owner.cities', { count: stats.cities_count, formatted: number(stats.cities_count) }) });
}

/** The owner's spot numbers for VEH-01: `vehicleId` empty when the viewer is not the owner (nothing is asked then). */
export function useOwnerSpotLine(vehicleId: string): string | null {
  const { t } = useTranslation('dex');
  const format = useFormat();
  const sample = qaDexActive();
  const query = useSpotStats(sample ? '' : vehicleId);
  const stats = sample && vehicleId ? qaSpotStats() : query.data;
  return stats ? ownerSpotLineText(t, stats, (value) => format.number(value)) : null;
}

/** VEH-01 for the owner (contract §8): the line as a row that opens DEX-06. Only when somebody has spotted the car. */
export function OwnerSpotLine({ vehicleId, line, routeId }: { vehicleId: string; line: string; routeId: string }) {
  const { t } = useTranslation('dex');
  const router = useRouter();
  return (
    <RowGroup>
      <ListRow
        icon="qr-sticker"
        title={line}
        accessibilityTitle={t('owner.lineLabel', { line })}
        onPress={() => router.push(ownerSpotsRoute(vehicleId))}
        inset={space[16]}
        testID={`${routeId}.spotLine`}
      />
    </RowGroup>
  );
}
