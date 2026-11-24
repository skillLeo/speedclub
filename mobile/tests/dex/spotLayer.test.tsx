/**
 * The "Spots" layer of EVT-01 Karte (M5.9b contract §6, 10 §16.2) beyond the join of spotMap.test.ts: how the circles are sized, the
 * names they carry, the layer's states (off, loading, failed, drawn, `qaDex`) and what the app hands the map controller. City
 * aggregates only: an area never carries a vehicle, a member or a spot.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { SpotMap } from '@/api/queries/dex';
import { loadCities, type CityRow } from '@/features/dex/cities';
import { QA_SPOT_MAP } from '@/features/dex/qaDex';
import { AREA_RADIUS, spotMapAreas, useSpotLayer } from '@/features/dex/spotMap';
import { mapState } from '@/features/events/map/mapConfig';
import { qa } from '@/lib/qa';
import { resolveColor, size } from '@/theme';
import { getTheme } from '@/theme/theme';

import { newQueryClient, stubFetch } from './helpers';

// A writable copy of the overrides, so one test can switch `qaDex` on.
jest.mock('@/lib/qa', () => {
  const actual = jest.requireActual<{ qa: object }>('@/lib/qa');
  return { ...actual, qa: { ...actual.qa } };
});
jest.mock('@/features/dex/cities', () => ({ ...jest.requireActual<object>('@/features/dex/cities'), loadCities: jest.fn() }));
jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: { document: '/doc' } }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const loadCitiesMock = jest.mocked(loadCities);
const mockQa = qa as { dex?: string };

/** Rows of `/geo/de-cities.json`: `[id, name, bundesland, lat, lng, population]`. */
const CITIES: CityRow[] = [
  [2950159, 'Berlin', 'BE', 52.524, 13.411, 3426354],
  [2886242, 'Köln', 'NW', 50.933, 6.95, 1024621],
  [2867714, 'München', 'BY', 48.137, 11.575, 1260391],
  [2934246, 'Düsseldorf', 'NW', 51.223, 6.779, 618685],
  [2861650, 'Nürnberg', 'BY', 49.454, 11.078, 499237],
];
const AT = '2026-11-14T06:00:00+01:00';
const city = (city_id: number, name: string, bundesland: string, count: number) => ({ city_id, name, bundesland, count });
const MAP: SpotMap = {
  generated_at: AT,
  cities: [city(2950159, 'Berlin', 'BE', 64), city(2886242, 'Köln', 'NW', 16), city(2867714, 'München', 'BY', 5)],
};
const AREA_KEYS = ['count', 'id', 'label', 'lat', 'lng', 'radius'];

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  delete mockQa.dex;
  loadCitiesMock.mockReset();
});

describe('spotMapAreas: the circles', () => {
  it('spans the small avatar to the profile avatar, from the design tokens', () => {
    expect(AREA_RADIUS).toEqual({ min: size.avatar.sm / 2, max: size.avatar.xl / 2 });
    expect(AREA_RADIUS.min).toBeLessThan(AREA_RADIUS.max);
  });

  it('sizes by the square root of the share of the busiest city, so the circle area follows the count', () => {
    const areas = spotMapAreas(MAP, CITIES);
    const radius = (count: number) => Math.round(AREA_RADIUS.min + Math.sqrt(count / 64) * (AREA_RADIUS.max - AREA_RADIUS.min));
    expect(areas.map((area) => [area.label, area.count, area.radius])).toEqual([
      ['Berlin', 64, AREA_RADIUS.max],
      ['Köln', 16, radius(16)],
      ['München', 5, radius(5)],
    ]);
    // A quarter of the spots: half the way from the smallest to the largest radius.
    expect(radius(16)).toBe(Math.round(AREA_RADIUS.min + 0.5 * (AREA_RADIUS.max - AREA_RADIUS.min)));
    for (const area of areas) {
      expect(Number.isInteger(area.radius)).toBe(true);
      expect(area.radius).toBeGreaterThanOrEqual(AREA_RADIUS.min);
      expect(area.radius).toBeLessThanOrEqual(AREA_RADIUS.max);
    }
  });

  it('never makes a circle smaller for more spots', () => {
    const counts = [5, 6, 7, 9, 12, 20, 33, 41, 80, 200, 1000];
    const map: SpotMap = { generated_at: AT, cities: counts.map((count, index) => city(CITIES[index % CITIES.length]![0], `C${index}`, 'NW', count)) };
    const radii = spotMapAreas(map, CITIES).map((area) => area.radius);
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
  });

  it('draws a single city at the largest radius, and equal counts at equal radii', () => {
    expect(spotMapAreas({ generated_at: AT, cities: [city(2867714, 'München', 'BY', 5)] }, CITIES)).toEqual([
      { id: 'city-2867714', lat: 48.137, lng: 11.575, count: 5, radius: AREA_RADIUS.max, label: 'München' },
    ]);
    const twins = spotMapAreas({ generated_at: AT, cities: [city(2886242, 'Köln', 'NW', 9), city(2934246, 'Düsseldorf', 'NW', 9)] }, CITIES);
    expect(twins.map((area) => area.radius)).toEqual([AREA_RADIUS.max, AREA_RADIUS.max]);
  });

  it('places a city at its public centroid by id and labels it with the name of the answer, else of the centroid file', () => {
    const areas = spotMapAreas({ generated_at: AT, cities: [city(2861650, '', 'BY', 7), city(2934246, 'Düsseldorf', 'NW', 7)] }, CITIES);
    expect(areas.map((area) => [area.id, area.label, area.lat, area.lng])).toEqual([
      ['city-2861650', 'Nürnberg', 49.454, 11.078],
      ['city-2934246', 'Düsseldorf', 51.223, 6.779],
    ]);
  });

  it('leaves out a city without spots and one the centroid file does not know, and draws nothing for an empty centroid list', () => {
    const map: SpotMap = { generated_at: AT, cities: [city(2950159, 'Berlin', 'BE', 0), city(9999999, 'Nirgendwo', 'NW', 12), city(2886242, 'Köln', 'NW', 6)] };
    expect(spotMapAreas(map, CITIES).map((area) => area.label)).toEqual(['Köln']);
    expect(spotMapAreas(MAP, [])).toEqual([]);
    expect(spotMapAreas(undefined, CITIES)).toEqual([]);
  });

  it('keeps only the city, its place, its number and its circle: no vehicle, member or spot of any answer', () => {
    const leaky = {
      generated_at: AT,
      cities: [{ ...city(2950159, 'Berlin', 'BE', 12), vehicle_id: '01car000000000000000000000', spotter: { username: 'mira.f18' }, spot_ids: ['01spot'] }],
    } as unknown as SpotMap;
    const areas = spotMapAreas(leaky, CITIES);
    expect(areas).toHaveLength(1);
    expect(Object.keys(areas[0]!).sort()).toEqual(AREA_KEYS);
    expect(areas[0]!.id).toBe('city-2950159');
    const text = JSON.stringify(areas);
    for (const trace of ['01car', 'mira.f18', 'spotter', 'vehicle', '01spot']) expect(text).not.toContain(trace);
  });
});

describe('useSpotLayer: the layer states', () => {
  it('off: reads nothing and draws nothing', async () => {
    const { fetchMock } = stubFetch({});
    const { result } = await renderHook(() => useSpotLayer(false), { wrapper: wrapper(newQueryClient()) });
    expect(result.current).toEqual({ areas: [], failed: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loadCitiesMock).not.toHaveBeenCalled();
  });

  it('on: GET spot-map joined with the centroid file, never failed', async () => {
    const { calls } = stubFetch({ '/spot-map': { body: { data: MAP } } });
    loadCitiesMock.mockResolvedValue(CITIES);
    const { result } = await renderHook(() => useSpotLayer(true), { wrapper: wrapper(newQueryClient()) });
    await waitFor(() => expect(result.current.areas).toHaveLength(3));
    expect(result.current.failed).toBe(false);
    expect(result.current.areas.map((area) => area.label)).toEqual(['Berlin', 'Köln', 'München']);
    expect(calls.map((request) => new URL(request.url).pathname)).toEqual(['/api/v1/spot-map']);
  });

  it('failed when the spot map cannot be read', async () => {
    stubFetch({ '/spot-map': { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } } });
    loadCitiesMock.mockResolvedValue(CITIES);
    const { result } = await renderHook(() => useSpotLayer(true), { wrapper: wrapper(newQueryClient()) });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.areas).toEqual([]);
  });

  it('failed when there is no centroid file to place the cities', async () => {
    stubFetch({ '/spot-map': { body: { data: MAP } } });
    loadCitiesMock.mockResolvedValue(null);
    const { result } = await renderHook(() => useSpotLayer(true), { wrapper: wrapper(newQueryClient()) });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.areas).toEqual([]);
  });

  it('turning it off again clears the circles', async () => {
    stubFetch({ '/spot-map': { body: { data: MAP } } });
    loadCitiesMock.mockResolvedValue(CITIES);
    const { result, rerender } = await renderHook(({ on }: { on: boolean }) => useSpotLayer(on), {
      wrapper: wrapper(newQueryClient()),
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.areas).toHaveLength(3));
    await rerender({ on: false });
    expect(result.current).toEqual({ areas: [], failed: false });
  });

  it('under qaDex: the bundled QA map, with no request to the server', async () => {
    mockQa.dex = 'sample';
    const { fetchMock } = stubFetch({});
    loadCitiesMock.mockResolvedValue(CITIES);
    const { result } = await renderHook(() => useSpotLayer(true), { wrapper: wrapper(newQueryClient()) });
    await waitFor(() => expect(result.current.areas.length).toBeGreaterThan(0));
    const known = new Set(CITIES.map((row) => row[0]));
    expect(result.current.areas.map((area) => area.label)).toEqual(QA_SPOT_MAP.cities.filter((entry) => known.has(entry.city_id)).map((entry) => entry.name));
    expect(result.current.failed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('what the map controller receives (mapConfig.mapState)', () => {
  it('hands the areas through unchanged in pins mode, with the selected tone as the fill and the hairline as the ring', () => {
    const areas = spotMapAreas(MAP, CITIES);
    for (const name of ['carbon', 'black', 'light'] as const) {
      const theme = getTheme(name);
      const state = mapState({ mode: 'pins', center: null, areas, attribution: '© OpenStreetMap' }, theme, true);
      expect(state.areas).toBe(areas);
      expect(state.colors.area).toBe(resolveColor(theme, 'state.selected'));
      expect(state.colors.primary).toBe(resolveColor(theme, 'text.primary'));
      expect(state.sizes.hairline).toBe(size.border.control);
    }
  });

  it('has no areas unless the layer gave some', () => {
    expect(mapState({ mode: 'pins', center: null, attribution: '' }, getTheme('carbon'), false).areas).toEqual([]);
  });
});
