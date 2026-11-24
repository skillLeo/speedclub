import { __resetCitiesForTests, distanceKm, loadCities, nearestCity, parseCityFile, REVALIDATE_MS, type CityRow, type CityStore } from '@/features/dex/cities';

jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: {} }));

// [id, name, bundesland, lat, lng, population]: real GeoNames-like centroids.
const DUESSELDORF: CityRow = [2934246, 'Düsseldorf', 'NW', 51.222, 6.776, 620523];
const NEUSS: CityRow = [2864118, 'Neuss', 'NW', 51.198, 6.692, 152457];
const KAARST: CityRow = [2894375, 'Kaarst', 'NW', 51.229, 6.618, 43000];
const VILLAGE: CityRow = [1, 'Dorf', 'BY', 49.0, 11.0, 1200];
const TOWN: CityRow = [2, 'Kleinstadt', 'BY', 49.25, 11.0, 25000];
const SMALL_TOWN: CityRow = [3, 'Markt', 'BY', 49.3, 11.0, 15000];
const CITIES = [DUESSELDORF, NEUSS, KAARST, VILLAGE, TOWN, SMALL_TOWN];

describe('nearest city on the device', () => {
  beforeEach(__resetCitiesForTests);

  it('measures great-circle distances', () => {
    // Düsseldorf → Neuss centroids are about 6 km apart.
    expect(distanceKm(51.222, 6.776, 51.198, 6.692)).toBeGreaterThan(5);
    expect(distanceKm(51.222, 6.776, 51.198, 6.692)).toBeLessThan(7);
  });

  it('takes the nearest centroid within 15 km, as id and Bundesland only', () => {
    const city = nearestCity(CITIES, 51.2, 6.7);
    expect(city).toEqual({ city_id: NEUSS[0], bundesland: 'NW' });
    expect(Object.keys(city ?? {}).sort()).toEqual(['bundesland', 'city_id']);
  });

  it('falls back to the nearest place of at least 20,000 within 40 km', () => {
    // 20 km south of the village's centroid stand-in: nothing within 15 km, the 25,000 town is 31 km, the 15,000 one is too small.
    const city = nearestCity([TOWN, SMALL_TOWN], 48.97, 11.0);
    expect(city).toEqual({ city_id: TOWN[0], bundesland: 'BY' });
  });

  it('has no city when nothing qualifies', () => {
    expect(nearestCity([SMALL_TOWN], 48.97, 11.0)).toBeNull();
    expect(nearestCity(CITIES, 53.55, 9.99)).toBeNull();
    expect(nearestCity(CITIES, Number.NaN, 6.7)).toBeNull();
  });

  it('never answers with an unknown Bundesland', () => {
    expect(nearestCity([[9, 'Nirgendwo', 'XX', 51.2, 6.7, 1000]], 51.2, 6.7)).toBeNull();
  });

  it('parses the contract file and drops malformed rows', () => {
    const file = parseCityFile(JSON.stringify({ v: 3, cities: [DUESSELDORF, ['bad'], [1, 'x', 'NW', '51', 6, 1]] }));
    expect(file?.cities).toEqual([DUESSELDORF]);
    expect(parseCityFile('not json')).toBeNull();
  });
});

describe('the city file: downloaded once, revalidated by ETag', () => {
  const body = JSON.stringify({ v: 1, cities: CITIES });

  function memoryStore(initial: { text: string; meta: { etag: string | null; checkedAt: number } } | null = null) {
    let saved = initial;
    const store: CityStore = {
      read: jest.fn(async () => saved),
      write: jest.fn(async (text, meta) => {
        saved = { text, meta };
      }),
      touch: jest.fn(async (meta) => {
        if (saved) saved = { ...saved, meta };
      }),
    };
    return { store, saved: () => saved };
  }

  const response = (status: number, text = '', etag: string | null = null) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(etag ? { ETag: etag } : {}),
    text: async () => text,
  });

  beforeEach(__resetCitiesForTests);

  it('downloads the file once and keeps it with its ETag', async () => {
    const { store, saved } = memoryStore();
    const fetcher = jest.fn(async () => response(200, body, '"v1"'));
    expect(await loadCities({ store, fetcher, now: () => 1000, url: 'https://x/geo/de-cities.json' })).toHaveLength(CITIES.length);
    expect(saved()?.meta).toEqual({ etag: '"v1"', checkedAt: 1000 });
    // Memory answers the next scan without a request.
    expect(await loadCities({ store, fetcher })).toHaveLength(CITIES.length);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses a fresh stored copy without asking the server', async () => {
    const { store } = memoryStore({ text: body, meta: { etag: '"v1"', checkedAt: 1000 } });
    const fetcher = jest.fn();
    expect(await loadCities({ store, fetcher, now: () => 1000 + REVALIDATE_MS - 1 })).toHaveLength(CITIES.length);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('revalidates an old copy with If-None-Match and keeps it on 304', async () => {
    const { store, saved } = memoryStore({ text: body, meta: { etag: '"v1"', checkedAt: 0 } });
    const fetcher = jest.fn(async (_url: string, _init: { headers: Record<string, string> }) => response(304));
    expect(await loadCities({ store, fetcher, now: () => REVALIDATE_MS + 5 })).toHaveLength(CITIES.length);
    expect(fetcher.mock.calls[0]?.[1].headers['If-None-Match']).toBe('"v1"');
    expect(saved()?.meta.checkedAt).toBe(REVALIDATE_MS + 5);
  });

  it('keeps an old copy when offline, and has none without one', async () => {
    const { store } = memoryStore({ text: body, meta: { etag: '"v1"', checkedAt: 0 } });
    const offline = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    expect(await loadCities({ store, fetcher: offline, now: () => REVALIDATE_MS * 2 })).toHaveLength(CITIES.length);
    __resetCitiesForTests();
    expect(await loadCities({ store: memoryStore().store, fetcher: offline })).toBeNull();
  });
});
