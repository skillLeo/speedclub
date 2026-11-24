/**
 * M5.9b STREET DEX (contract docs/reports/phase-5/m5.9b-contract.md, API handover m5.9b-api-handover.md): the spot write of DEX-02,
 * the Dex reads (DEX-01, -03, -04, -05), the owner's numbers (DEX-06) and the public spot map. Privacy (contract §0, ADR-508): a spot
 * carries a city id and a Bundesland only. Nothing here takes, keeps or sends a coordinate; the device picks the city
 * (features/dex/cities.ts) and hands over the id alone.
 *
 * Types and calls come from the generated schema (`src/api/schema.d.ts`), the owner's switches on `PATCH vehicles/{vehicle}` included
 * (`UpdateVehicleRequest` since M5.9c).
 */
import { onlineManager, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api, apiData, ApiError, newIdempotencyKey, withIdempotency } from '@/api/client';
import type { MemberSettings } from '@/api/queries/auth';
import type { GarageVehicle } from '@/api/queries/garage';
import type { components, operations } from '@/api/schema';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

type Schemas = components['schemas'];

/** Contract §1 `Rarity`; `ghost` overrides the computed tier (§5). */
export type Rarity = Schemas['Rarity'];
export const RARITIES = ['street', 'tuned', 'rare', 'legend', 'ghost'] as const satisfies readonly Rarity[];

/** Contract §1 `Bundesland`: the 16 codes. */
export type Bundesland = Schemas['Bundesland'];
export const BUNDESLAENDER = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'] as const satisfies readonly Bundesland[];

/**
 * Every Dex read's card. `spotted: false` is DEX-04's "noch nicht gespottet" preview: `spot_id`/`spotted_at` null, no foil, no
 * cities line. `vehicle.owner` is null when the owner is not shown on the sticker page.
 */
export type SpotCard = Schemas['SpotCardResource'];
export type SpotVehicle = SpotCard['vehicle'];
export type SpotOwner = NonNullable<SpotVehicle['owner']>;
export type SpotImage = NonNullable<SpotVehicle['cover']>;

/** A card the member spotted: the answer of a spot write and of `GET spots/{spot}`, always with its spot. */
export type SpottedCard = SpotCard & { spot_id: string; spotted_at: string };

/** Contract §2 `meta`; `counted: false` with `reason: 'account_too_new'` is the 201 of an account younger than 24 h. */
export type SpotMeta = operations['v1.spots.store']['responses'][201]['content']['application/json']['meta'];
export type SetProgress = SpotMeta['set_progress'][number];
export type SpotResponse = { data: SpottedCard; meta: SpotMeta };

/**
 * The request body: the code and, when the device found one, the city id with its Bundesland. Narrower than the generated
 * `StoreSpotRequest` on purpose: the app never sends the free-text `city`, and nothing else (the server answers any other key with 422).
 */
export type SpotBody = Pick<Schemas['StoreSpotRequest'], 'code'> & { city_id?: number; bundesland?: Bundesland };

/** What the device picked for a scan, or nothing. Never a coordinate. */
export type SpotCity = { city_id: number; bundesland: Bundesland };

/** A malformed answer: shown as the error state, never as a half-filled screen. */
const invalidAnswer = () => new ApiError({ kind: 'server', status: 500, code: 'invalid_answer', message: '' });

export const dexKeys = {
  all: ['dex'] as const,
  /** One spot card. The key holds the spot id only: never a place. */
  spot: (spotId: string) => ['dex', 'spot', spotId] as const,
  /** DEX-01: the member's cards under one filter (`filterParam`). */
  mine: (filter: string) => ['dex', 'mine', filter] as const,
  sets: ['dex', 'sets'] as const,
  /** DEX-04: one car's card as this member sees it. */
  card: (vehicleId: string) => ['dex', 'card', vehicleId] as const,
  rarityRules: ['dex', 'rarity-rules'] as const,
  /** DEX-06: the owner's numbers of one car. */
  spotStats: (vehicleId: string) => ['dex', 'spot-stats', vehicleId] as const,
  spotMap: ['dex', 'spot-map'] as const,
};

/** Only the two allowed fields, whatever the caller held: the body is built here, never spread from elsewhere. */
export function spotBody(code: string, city: SpotCity | null): SpotBody {
  return city ? { code, city_id: city.city_id, bundesland: city.bundesland } : { code };
}

/** A spot answer's card always names its spot; anything else is not an answer this screen can show. */
function spottedResponse(body: { data: SpotCard; meta: SpotMeta }): SpotResponse {
  const { data, meta } = body;
  if (data.spot_id === null || data.spotted_at === null) throw invalidAnswer();
  return { data: { ...data, spot_id: data.spot_id, spotted_at: data.spotted_at }, meta };
}

/** `POST /api/v1/spots` with the intent's idempotency key (contract §2): 201 a new spot, 200 the same car within 24 h. */
export async function postSpot(body: SpotBody, idempotencyKey: string): Promise<SpotResponse> {
  return spottedResponse(await apiData(api.POST('/spots', { body, ...withIdempotency(idempotencyKey) })));
}

/** `GET /api/v1/spots/{spot}` (the spotter only): DEX-03 from a link or after a restart; `duplicate` false, `set_progress` empty. */
export async function getSpot(spotId: string, signal?: AbortSignal): Promise<SpotResponse> {
  return spottedResponse(await apiData(api.GET('/spots/{spot}', { params: { path: { spot: spotId } }, signal })));
}

/** A 4xx is an answer: asking again cannot change it. */
const retryUnlessAnswered = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2;

/** DEX-03's card: the answer of the spot write when it is in the cache, otherwise the spot as the server has it. */
export function useSpot(spotId: string | null) {
  const signedIn = useSessionStore(selectMayReadOwned);
  return useQuery({
    queryKey: dexKeys.spot(spotId ?? ''),
    queryFn: ({ signal }) => getSpot(spotId ?? '', signal),
    enabled: signedIn && spotId !== null && spotId !== '',
    retry: retryUnlessAnswered,
    // The reveal plays once per write; a refetch must not change what it showed ("NEU" turns into "Schon in deinem Dex").
    staleTime: Infinity,
    meta: { persist: false },
  });
}

/** Puts a fresh answer where DEX-03 reads it, so the reveal opens without a request. */
/**
 * The roots of `levelKeys.all` and `badgeKeys.all` (tests/dex/submit.test.tsx keeps them equal). Named here instead of imported:
 * those modules reach the app's query client and its NetInfo listener, which the Dex modules must not load.
 */
export const SPOT_REFRESH_ROOTS = [['level'], ['badges']] as const;

export function rememberSpot(client: QueryClient, response: SpotResponse): void {
  client.setQueryData(dexKeys.spot(response.data.spot_id), response);
  // CR-P5G-02: a new card changes the member's Dex, sets, the car's card, XP and maybe badges. Read them again (also after an
  // outbox send); the spot just written stays as it is.
  void client.invalidateQueries({ queryKey: dexKeys.all, predicate: (query) => query.queryKey[1] !== 'spot' });
  for (const root of SPOT_REFRESH_ROOTS) void client.invalidateQueries({ queryKey: [...root] });
}

// -- Outcomes of one spot write

/** Contract §2 refusals and the cases DEX-02 answers in its own words. */
export type SpotRefusal = 'not_found' | 'own_car' | 'paused' | 'unavailable' | 'rate_limited' | 'restricted' | 'unverified' | 'failed';

export type SpotResult =
  | { kind: 'spotted'; response: SpotResponse }
  /** No answer: the outbox keeps the write and sends it once the device is online. */
  | { kind: 'queued' }
  | { kind: 'refused'; reason: SpotRefusal; message: string; retryAfter: number | null };

/** The 409 codes of `POST spots` (handover "Error codes"). */
const CONFLICT_REASON: Readonly<Record<string, SpotRefusal>> = {
  spot_own_car: 'own_car',
  spotting_paused: 'paused',
  spot_unavailable: 'unavailable',
};

/** Whether a write must wait for the network rather than be answered now. */
export function waitsForNetwork(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.kind === 'network' || error.kind === 'server' || error.kind === 'maintenance';
}

/** How a refused write reads on DEX-02. Every 4xx is final for this scan; the scanner offers the next one. */
export function refusalOf(error: unknown): Extract<SpotResult, { kind: 'refused' }> {
  const fallback = { kind: 'refused' as const, reason: 'failed' as const, message: '', retryAfter: null };
  if (!(error instanceof ApiError)) return fallback;
  const base = { kind: 'refused' as const, message: error.message, retryAfter: error.retryAfter };
  if (error.kind === 'not_found') return { ...base, reason: 'not_found' };
  if (error.kind === 'conflict') return { ...base, reason: CONFLICT_REASON[error.code] ?? 'unavailable' };
  if (error.kind === 'rate_limited') return { ...base, reason: 'rate_limited' };
  if (error.kind === 'restricted') return { ...base, reason: 'restricted' };
  if (error.kind === 'forbidden' && error.code === 'email_not_verified') return { ...base, reason: 'unverified' };
  return { ...base, reason: 'failed' };
}

/**
 * Whether the spot did not count (contract §2: 201, `counted: false`): `reason: 'account_too_new'` for a young account, `'sample_car'`
 * for a sample car scanned by a real member (ADR-514: samples never earn).
 */
export function spotNotCounted(meta: SpotMeta): boolean {
  return !meta.counted || meta.reason === 'account_too_new';
}

export type SpotWrite = {
  code: string;
  city: SpotCity | null;
  /** Hands an unanswered write to the outbox, with the same key: a retry of the same scan, never a second spot. */
  queue: (body: SpotBody, idempotencyKey: string) => void;
};

/**
 * The spot write of DEX-02. One idempotency key per scan, kept when the write moves to the outbox. Offline (or without an
 * answer) the scan is saved and goes out later; a refusal is an answer, never an error state.
 */
export function useSubmitSpot() {
  const client = useQueryClient();
  return useMutation({
    // The write decides about the network itself: offline it queues at once. The default `online` mode would pause it instead.
    networkMode: 'always',
    mutationFn: async ({ code, city, queue }: SpotWrite): Promise<SpotResult> => {
      const body = spotBody(code, city);
      const key = newIdempotencyKey();
      if (!onlineManager.isOnline()) {
        queue(body, key);
        return { kind: 'queued' };
      }
      try {
        const response = await postSpot(body, key);
        rememberSpot(client, response);
        return { kind: 'spotted', response };
      } catch (error) {
        if (waitsForNetwork(error)) {
          queue(body, key);
          return { kind: 'queued' };
        }
        return refusalOf(error);
      }
    },
  });
}

// -- The Dex reads (contract §3), the owner side (§4)

/** A 4xx (owner only, not spotted, gone) is an answer: asking again cannot change it. */
const retryReads = retryUnlessAnswered;

const numberOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// -- DEX-01: the member's cards

/** The chips of DEX-01 (contract §3 `filter`): Alle · Rarität · Marke · Sets. */
export type DexFilter =
  | { kind: 'all' }
  | { kind: 'rarity'; tier: Rarity }
  | { kind: 'make'; slug: string; name: string }
  | { kind: 'set'; key: string; name: string };

export const ALL_FILTER: DexFilter = { kind: 'all' };

/** A make of the member's cards: the chip's name and the server's `make_slug`. */
export type DexMake = { slug: string; name: string };

/** The query value of a filter: `all`, `rarity:rare`, `make:honda`, `set:jdm-legends`. */
export function filterParam(filter: DexFilter): string {
  switch (filter.kind) {
    case 'rarity':
      return `rarity:${filter.tier}`;
    case 'make':
      return `make:${filter.slug}`;
    case 'set':
      return `set:${filter.key}`;
    default:
      return 'all';
  }
}

/** Contract §3 `meta`: "Dex 87 / 1.240" — found cars and every car there is to find (public non-ghost + ghost cars found). */
export type DexMeta = { found: number; total: number; next_cursor: string | null };
export type DexPage = { data: SpotCard[]; meta: DexMeta };

export async function getMyDex(filter: string, cursor: string | null, signal?: AbortSignal): Promise<DexPage> {
  const body = await apiData(api.GET('/me/dex', { params: { query: { filter, ...(cursor ? { cursor } : {}) } }, signal }));
  const { found, total, next_cursor } = body.meta;
  return { data: body.data, meta: { found, total, next_cursor } };
}

/** DEX-01: the cards of one filter, page by page (cursor). Signed-in members only. */
export function useMyDex(filter: DexFilter, enabled = true) {
  const signedIn = useSessionStore(selectMayReadOwned);
  const param = filterParam(filter);
  return useInfiniteQuery({
    queryKey: dexKeys.mine(param),
    queryFn: ({ pageParam, signal }) => getMyDex(param, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor,
    enabled: signedIn && enabled,
    retry: retryReads,
  });
}

// -- DEX-05: sets and their slots

/**
 * One set: JDM Legends (one slot per generation, unfound slots name make and generation), a brand set per make (tiers 5 → 10 → 25,
 * `target` the next tier), Stadtkenner, and the season sets with their month-day `window`. Found slots carry the full card.
 */
export type DexSet = Schemas['DexSetResource'];
export type SetKind = DexSet['kind'];
export type DexSlot = DexSet['slots'][number];
/** An unfound slot names make and generation only when the set rule names them (JDM generations); never a ghost car. */
export type SetSilhouette = NonNullable<DexSlot['silhouette']>;
/** A season window as month-day (`03-01` … `04-30`), every year again. */
export type SetWindow = NonNullable<DexSet['window']>;
/** What a tile needs of a card: DEX-01's cards and DEX-05's found slots. */
export type SpotCardLite = Pick<SpotCard, 'first_spotter' | 'vehicle'>;

export async function getDexSets(signal?: AbortSignal): Promise<DexSet[]> {
  return (await apiData(api.GET('/me/dex/sets', { signal }))).data;
}

/** DEX-05 and DEX-01's silhouettes. */
export function useDexSets(enabled = true) {
  const signedIn = useSessionStore(selectMayReadOwned);
  return useQuery({ queryKey: dexKeys.sets, queryFn: ({ signal }) => getDexSets(signal), enabled: signedIn && enabled, retry: retryReads });
}

/** Whether `today` (local month and day) lies in a season window; a set without one is always open. Windows may wrap the year. */
export function windowOpen(window: SetWindow | null, today: Date): boolean {
  if (!window) return true;
  const now = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return window.starts_on <= window.ends_on ? now >= window.starts_on && now <= window.ends_on : now >= window.starts_on || now <= window.ends_on;
}

/** An active set: not complete and in its window. Its unfound slots are DEX-01's "???" silhouettes. */
export function setActive(set: DexSet, today: Date): boolean {
  return set.completed_at === null && set.progress < set.target && windowOpen(set.window, today);
}

// -- DEX-04: one car's card

/** DEX-04: the card of a car the viewer spotted, or the "noch nicht gespottet" preview of a public car (`spotted: false`). */
export type DexCard = { spotted: boolean; card: SpotCard };

export async function getDexCard(vehicleId: string, signal?: AbortSignal): Promise<DexCard> {
  const { data } = await apiData(api.GET('/vehicles/{vehicle}/dex-card', { params: { path: { vehicle: vehicleId } }, signal }));
  return { spotted: data.spotted, card: data };
}

/** DEX-04. `placeholder`: the card from DEX-01's list, so the page opens at once while the full card loads. */
export function useDexCard(vehicleId: string | null, placeholder?: SpotCard) {
  const signedIn = useSessionStore(selectMayReadOwned);
  return useQuery({
    queryKey: dexKeys.card(vehicleId ?? ''),
    queryFn: ({ signal }) => getDexCard(vehicleId ?? '', signal),
    enabled: signedIn && vehicleId !== null && vehicleId !== '',
    placeholderData: placeholder ? { spotted: placeholder.spotted, card: placeholder } : undefined,
    retry: retryReads,
  });
}

// -- "So entsteht die Rarität"

/** The thresholds of `config/speedclub.php` `dex.rarity` (contract §6), as the sheet reads them. */
export type RarityRules = {
  /** Tuned: Build Score at least. */
  tunedScore: number;
  /** Rare: at most this many public cars of the same generation. */
  rareMax: number;
  /** Legend: Build Score at least (or the only public car of its generation). */
  legendScore: number;
};

export function rarityRulesOf(rules: Schemas['RarityRulesResource']): RarityRules {
  return { tunedScore: rules.tuned.min_build_score, rareMax: rules.rare.max_same_generation, legendScore: rules.legend.min_build_score };
}

export async function getRarityRules(signal?: AbortSignal): Promise<RarityRules> {
  return rarityRulesOf((await apiData(api.GET('/rarity-rules', { signal }))).data);
}

/** Public; read when the sheet opens. The rules change with a config release, so a day is fresh enough. */
export function useRarityRules(enabled: boolean) {
  return useQuery({
    queryKey: dexKeys.rarityRules,
    queryFn: ({ signal }) => getRarityRules(signal),
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
    retry: retryReads,
  });
}

// -- DEX-06 and VEH-01: the owner's spot numbers

type SpotStatsResource = Schemas['SpotStatsResource'];
export type NamedSpotter = Extract<SpotStatsResource['recent_spotters'][number], { username: string }>;
/** A spotter who keeps "Meine Spots zeigen" off (or may not be named): the owner sees "jemand". */
export type AnonymousSpotter = { anonymous: true };
export type RecentSpotter = NamedSpotter | AnonymousSpotter;

export const STREET_FAMOUS_TIERS = [10, 50, 100, 500] as const;
export type StreetFamousTier = NonNullable<SpotStatsResource['street_famous']['tier']>;

/**
 * `GET vehicles/{id}/spot-stats`. `cities` holds day spots only and is empty while the owner hides the cities. The three counts are
 * numbers here: the generated `SpotStatsResource` types them as strings (Scramble JR001 on the array-backed resource, handover
 * "Tests and gates"), while the server sends integers.
 */
export type SpotStats = Omit<SpotStatsResource, 'total' | 'unique_spotters' | 'cities_count' | 'recent_spotters'> & {
  total: number;
  unique_spotters: number;
  cities_count: number;
  recent_spotters: RecentSpotter[];
};

export function isAnonymous(spotter: RecentSpotter): spotter is AnonymousSpotter {
  return 'anonymous' in spotter && spotter.anonymous === true;
}

/** The answer with its counts as numbers (see `SpotStats`); a spotter without a name reads as "jemand". */
export function spotStatsOf(stats: SpotStatsResource): SpotStats {
  const count = (value: unknown) => numberOr(value, 0);
  return {
    ...stats,
    total: count(stats.total),
    unique_spotters: count(stats.unique_spotters),
    cities_count: count(stats.cities_count),
    // A name only when the entry is a named spotter and nothing else: an entry that says `anonymous` stays "jemand", whatever it carries.
    recent_spotters: stats.recent_spotters.map((spotter): RecentSpotter =>
      'username' in spotter && !('anonymous' in spotter) ? { username: spotter.username, display_name: spotter.display_name, avatar: spotter.avatar } : { anonymous: true },
    ),
  };
}

export async function getSpotStats(vehicleId: string, signal?: AbortSignal): Promise<SpotStats> {
  return spotStatsOf((await apiData(api.GET('/vehicles/{vehicle}/spot-stats', { params: { path: { vehicle: vehicleId } }, signal }))).data);
}

/** DEX-06 and the VEH-01 owner line; owner only (`vehicleId` empty: not the owner, nothing is asked). */
export function useSpotStats(vehicleId: string) {
  const signedIn = useSessionStore(selectMayReadOwned);
  return useQuery({
    queryKey: dexKeys.spotStats(vehicleId),
    queryFn: ({ signal }) => getSpotStats(vehicleId, signal),
    enabled: signedIn && vehicleId !== '',
    retry: retryReads,
  });
}

/** The owner's switches of one car (GAR-12 "Spots"); the vehicle carries them for its owner, null for anybody else. */
export type VehicleSpotSettings = { ghost_mode: boolean; spotting_paused: boolean; hide_spot_cities: boolean };
export const SPOT_SETTING_KEYS = ['ghost_mode', 'spotting_paused', 'hide_spot_cities'] as const satisfies readonly (keyof VehicleSpotSettings)[];

/** The switches as the vehicle carries them; off where it says nothing (null: not the owner's copy). */
export function spotSettingsOf(vehicle: Partial<Pick<GarageVehicle, keyof VehicleSpotSettings>> | null | undefined): VehicleSpotSettings {
  return {
    ghost_mode: vehicle?.ghost_mode === true,
    spotting_paused: vehicle?.spotting_paused === true,
    hide_spot_cities: vehicle?.hide_spot_cities === true,
  };
}

// -- SET-07 "Meine Spots zeigen"

/** `show_my_spots` of the member's settings; on (the default) while they are not loaded. */
export function showMySpotsOf(settings: Pick<MemberSettings, 'show_my_spots'> | null | undefined): boolean {
  return settings?.show_my_spots ?? true;
}

// -- The public spot map (Entdecken › Treffen, layer "Spots")

/**
 * `GET spot-map`: cities with at least 5 counted spots between 24 h and 90 days old, most first. Never a vehicle, never a member,
 * never a coordinate (the device places a city by its id from `/geo/de-cities.json`).
 */
export type SpotMap = Schemas['SpotMapResource'];
export type SpotMapCity = SpotMap['cities'][number];

/** Only the four fields of a city reach the map, whatever else an answer carried; cities without spots are left out. */
export function spotMapOf(map: SpotMap): SpotMap {
  return {
    generated_at: map.generated_at,
    cities: map.cities.flatMap(({ city_id, name, bundesland, count }) => (count > 0 ? [{ city_id, name, bundesland, count }] : [])),
  };
}

export async function getSpotMap(signal?: AbortSignal): Promise<SpotMap> {
  return spotMapOf((await apiData(api.GET('/spot-map', { signal }))).data);
}

/** Public, cached 1 h by the server: the layer reads it once per hour at most. */
export function useSpotMap(enabled: boolean) {
  return useQuery({ queryKey: dexKeys.spotMap, queryFn: ({ signal }) => getSpotMap(signal), enabled, staleTime: 60 * 60 * 1000, retry: retryReads });
}
