/**
 * Entdecken › Treffen, layer "Spots" (contract §6, 10 §16.2): the public `spot-map` (cities with spots of at least 5 different cars,
 * each older than 24 h; SEC-P5G-03) joined on the device with the public centroid file `/geo/de-cities.json`, the same file and cache the scanner uses
 * (cities.ts). City circles only: the layer never holds a vehicle, a member or a spot.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useSpotMap, type SpotMap } from '@/api/queries/dex';
import type { MapArea } from '@/features/events/map/mapConfig';
import { size } from '@/theme';

import { loadCities, type CityRow } from './cities';
import { QA_SPOT_MAP, qaDexActive } from './qaDex';

/** The smallest and the largest circle: the small avatar's and the profile avatar's radius. */
export const AREA_RADIUS = { min: size.avatar.sm / 2, max: size.avatar.xl / 2 } as const;

/**
 * The layer's circles: each city of the map at its centroid, the area growing with the count (radius by square root, so the area
 * is proportional). A city the centroid file does not know is left out. Only id, place, count, radius and name are kept.
 */
export function spotMapAreas(map: SpotMap | null | undefined, cities: readonly CityRow[] | null | undefined): MapArea[] {
  if (!map || !cities || map.cities.length === 0) return [];
  const byId = new Map(cities.map((row) => [row[0], row]));
  const max = Math.max(...map.cities.map((city) => city.count));
  return map.cities.flatMap((city): MapArea[] => {
    const row = byId.get(city.city_id);
    if (!row || city.count <= 0) return [];
    const share = max > 0 ? Math.sqrt(city.count / max) : 0;
    return [
      {
        id: `city-${city.city_id}`,
        lat: row[3],
        lng: row[4],
        count: city.count,
        radius: Math.round(AREA_RADIUS.min + share * (AREA_RADIUS.max - AREA_RADIUS.min)),
        label: city.name || row[1],
      },
    ];
  });
}

/** The centroid file, once per session (stored on the device by cities.ts; the browser's cache on the web). Never persisted here. */
export function useCityCentroids(enabled: boolean) {
  return useQuery({
    queryKey: ['geo', 'de-cities'],
    queryFn: () => loadCities(),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    meta: { persist: false },
  });
}

/** The layer's state: off, loading, failed or its circles. Under `qaDex` the bundled QA map. */
export function useSpotLayer(on: boolean) {
  const sample = qaDexActive();
  const spotMap = useSpotMap(on && !sample);
  const centroids = useCityCentroids(on);
  const map = sample ? QA_SPOT_MAP : spotMap.data;
  const areas = useMemo(() => (on ? spotMapAreas(map, centroids.data) : []), [centroids.data, map, on]);
  const failed = on && ((!sample && spotMap.isError) || (centroids.isFetched && !centroids.data));
  return { areas, failed };
}
