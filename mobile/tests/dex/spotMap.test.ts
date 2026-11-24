import { spotMapOf, type SpotMap } from '@/api/queries/dex';
import type { CityRow } from '@/features/dex/cities';
import { AREA_RADIUS, spotMapAreas } from '@/features/dex/spotMap';

jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: { document: '/doc' } }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const CITIES: CityRow[] = [
  [2886242, 'Köln', 'NW', 50.933, 6.95, 1024621],
  [2934246, 'Düsseldorf', 'NW', 51.223, 6.779, 618685],
  [2950159, 'Berlin', 'BE', 52.524, 13.411, 3426354],
];

describe('the spot map layer (Entdecken › Treffen › Spots)', () => {
  it('joins the cities with the public centroids and sizes them by count', () => {
    const areas = spotMapAreas(
      { generated_at: '2026-11-14T06:00:00+01:00', cities: [{ city_id: 2886242, name: 'Köln', bundesland: 'NW', count: 36 }, { city_id: 2934246, name: 'Düsseldorf', bundesland: 'NW', count: 9 }] },
      CITIES,
    );
    expect(areas).toEqual([
      { id: 'city-2886242', lat: 50.933, lng: 6.95, count: 36, radius: AREA_RADIUS.max, label: 'Köln' },
      { id: 'city-2934246', lat: 51.223, lng: 6.779, count: 9, radius: Math.round(AREA_RADIUS.min + 0.5 * (AREA_RADIUS.max - AREA_RADIUS.min)), label: 'Düsseldorf' },
    ]);
  });

  it('drops a city the centroid file does not know, and draws nothing without data', () => {
    expect(spotMapAreas({ generated_at: '2026-11-14T06:00:00+01:00', cities: [{ city_id: 1, name: 'Nirgendwo', bundesland: 'NW', count: 7 }] }, CITIES)).toEqual([]);
    expect(spotMapAreas(null, CITIES)).toEqual([]);
    expect(spotMapAreas({ generated_at: '2026-11-14T06:00:00+01:00', cities: [] }, null)).toEqual([]);
  });

  it('keeps no vehicle, member or spot in the layer, whatever the answer carried', () => {
    const map = spotMapOf({
      generated_at: '2026-11-14T06:00:00+01:00',
      cities: [
        { city_id: 2950159, name: 'Berlin', bundesland: 'BE', count: 12, vehicle_ids: ['01ek9'], vehicles: [{ id: '01ek9' }], spotter_id: 'u1' },
        { city_id: 2886242, name: 'Köln', bundesland: 'NW', count: 0 },
      ],
    } as SpotMap);
    expect(map.cities).toEqual([{ city_id: 2950159, name: 'Berlin', bundesland: 'BE', count: 12 }]);
    const areas = spotMapAreas(map, CITIES);
    const text = JSON.stringify(areas);
    expect(text).not.toContain('01ek9');
    expect(text).not.toContain('vehicle');
    expect(text).not.toContain('spotter');
    expect(Object.keys(areas[0] ?? {}).sort()).toEqual(['count', 'id', 'label', 'lat', 'lng', 'radius']);
  });
});
