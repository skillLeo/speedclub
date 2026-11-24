/**
 * The spot city, chosen on the device (contract §0/§8, ADR-508, spike §3). The public GeoNames centroid file
 * `/geo/de-cities.json` (CC BY 4.0) is downloaded once, revalidated by ETag at most once a week and kept in the app's documents
 * folder. The nearest centroid wins within 15 km; otherwise the nearest place of at least 20,000 inhabitants within 40 km;
 * otherwise there is no city. Only the city's id and Bundesland leave this module — the position that chose them never does.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { apiOrigin } from '@/api/client';
import { BUNDESLAENDER, type Bundesland, type SpotCity } from '@/api/queries/dex';

/** `[id, name, bundesland, lat, lng, population]`, as the file lists them (contract §0). */
export type CityRow = readonly [number, string, string, number, number, number];
export type CityFile = { v: number | string; cities: CityRow[] };

/** The rules of contract §8 (spike §3). */
export const NEAR_KM = 15;
export const TOWN_KM = 40;
export const TOWN_POPULATION = 20_000;
const EARTH_RADIUS_KM = 6371;
const DEGREES = 180;
/** Revalidate the stored file at most this often. */
export const REVALIDATE_MS = 7 * 24 * 60 * 60 * 1000;

const radians = (degrees: number) => (degrees * Math.PI) / DEGREES;

/** Great-circle distance in km. */
export function distanceKm(latA: number, lngA: number, latB: number, lngB: number): number {
  const dLat = radians(latB - latA);
  const dLng = radians(lngB - lngA);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isBundesland(value: unknown): value is Bundesland {
  return typeof value === 'string' && (BUNDESLAENDER as readonly string[]).includes(value);
}

/**
 * The city of a position by the rules above, as id and Bundesland only. Pure: the position is an argument and is gone when this
 * returns.
 */
export function nearestCity(cities: readonly CityRow[], lat: number, lng: number): SpotCity | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let near: { row: CityRow; km: number } | null = null;
  let town: { row: CityRow; km: number } | null = null;
  for (const row of cities) {
    const km = distanceKm(lat, lng, row[3], row[4]);
    if (km <= NEAR_KM && (!near || km < near.km)) near = { row, km };
    if (km <= TOWN_KM && row[5] >= TOWN_POPULATION && (!town || km < town.km)) town = { row, km };
  }
  const chosen = near?.row ?? town?.row ?? null;
  if (!chosen || !isBundesland(chosen[2]) || !Number.isInteger(chosen[0])) return null;
  return { city_id: chosen[0], bundesland: chosen[2] };
}

/** A parsed file, or null when it is not the contract's shape. Rows that are not are dropped. */
export function parseCityFile(text: string): CityFile | null {
  try {
    const parsed = JSON.parse(text) as Partial<CityFile>;
    if (!parsed || !Array.isArray(parsed.cities)) return null;
    const cities = parsed.cities.filter(
      (row): row is CityRow =>
        Array.isArray(row) &&
        row.length >= 6 &&
        typeof row[0] === 'number' &&
        typeof row[1] === 'string' &&
        typeof row[2] === 'string' &&
        typeof row[3] === 'number' &&
        typeof row[4] === 'number' &&
        typeof row[5] === 'number',
    );
    return { v: parsed.v ?? 0, cities };
  } catch {
    return null;
  }
}

// -- The stored copy

/** What the device keeps besides the file: its ETag and when it was last checked. */
export type CityFileMeta = { etag: string | null; checkedAt: number };

export type CityStore = {
  read: () => Promise<{ text: string; meta: CityFileMeta } | null>;
  write: (text: string, meta: CityFileMeta) => Promise<void>;
  touch: (meta: CityFileMeta) => Promise<void>;
};

const GEO_DIR = 'geo';
const FILE_NAME = 'de-cities.json';
const META_NAME = 'de-cities.meta.json';

function geoDirectory(): Directory {
  const directory = new Directory(Paths.document, GEO_DIR);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/** The documents folder: the system does not purge it, so the file is downloaded once. */
export const fileCityStore: CityStore = {
  read: async () => {
    const directory = geoDirectory();
    const file = new File(directory, FILE_NAME);
    const metaFile = new File(directory, META_NAME);
    if (!file.exists) return null;
    let meta: CityFileMeta = { etag: null, checkedAt: 0 };
    if (metaFile.exists) {
      const parsed = JSON.parse(await metaFile.text()) as Partial<CityFileMeta>;
      meta = { etag: typeof parsed.etag === 'string' ? parsed.etag : null, checkedAt: Number(parsed.checkedAt) || 0 };
    }
    return { text: await file.text(), meta };
  },
  write: async (text, meta) => {
    const directory = geoDirectory();
    const temp = new File(directory, `${FILE_NAME}.tmp`);
    temp.create({ overwrite: true });
    await temp.write(text);
    await temp.move(new File(directory, FILE_NAME), { overwrite: true });
    await fileCityStore.touch(meta);
  },
  touch: async (meta) => {
    const metaFile = new File(geoDirectory(), META_NAME);
    if (!metaFile.exists) metaFile.create({ overwrite: true });
    await metaFile.write(JSON.stringify(meta));
  },
};

export function cityFileUrl(origin: string = apiOrigin()): string {
  return `${origin}/geo/de-cities.json`;
}

export type CityLoaderDeps = {
  store?: CityStore;
  fetcher?: (url: string, init: { headers: Record<string, string> }) => Promise<Pick<Response, 'status' | 'ok' | 'headers' | 'text'>>;
  now?: () => number;
  url?: string;
};

let memory: readonly CityRow[] | null = null;

/** Test seam. */
export function __resetCitiesForTests(): void {
  memory = null;
}

/**
 * The city list: from memory, else the stored file (revalidated by ETag once a week), else one download. Null when there is
 * none and none can be fetched: the spot then goes without a city. Never throws.
 */
export async function loadCities(deps: CityLoaderDeps = {}): Promise<readonly CityRow[] | null> {
  if (memory) return memory;
  const store = deps.store ?? fileCityStore;
  const fetcher = deps.fetcher ?? ((url, init) => globalThis.fetch(url, init));
  const now = (deps.now ?? Date.now)();
  let stored: Awaited<ReturnType<CityStore['read']>> = null;
  try {
    stored = await store.read();
  } catch {
    stored = null;
  }
  const storedFile = stored ? parseCityFile(stored.text) : null;
  if (stored && storedFile && now - stored.meta.checkedAt < REVALIDATE_MS) {
    memory = storedFile.cities;
    return memory;
  }
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (storedFile && stored?.meta.etag) headers['If-None-Match'] = stored.meta.etag;
    const response = await fetcher(deps.url ?? cityFileUrl(), { headers });
    if (response.status === 304 && storedFile) {
      await store.touch({ etag: stored?.meta.etag ?? null, checkedAt: now }).catch(() => undefined);
      memory = storedFile.cities;
      return memory;
    }
    if (response.ok) {
      const text = await response.text();
      const parsed = parseCityFile(text);
      if (parsed && parsed.cities.length > 0) {
        await store.write(text, { etag: response.headers.get('ETag'), checkedAt: now }).catch(() => undefined);
        memory = parsed.cities;
        return memory;
      }
    }
  } catch {
    // Offline: the stored copy, however old, still knows where the cities are.
  }
  memory = storedFile?.cities ?? null;
  return memory;
}
