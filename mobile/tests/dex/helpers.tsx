/**
 * STREET DEX tests: the answers as the server sends them (shapes taken from the live M5.9b API, 2026-11-15: `spotted`, `make_slug`,
 * `generation_slug`, cover with `blurhash`, `meta.counted`/`meta.reason` always present), and the providers of the screens.
 */
import type { DexSet, SpotCard, SpotMeta, SpotResponse } from '@/api/queries/dex';

export { newQueryClient, renderScreen, signIn, signOut, stubFetch, type Answer } from '../qr/harness';

export function spotCard(overrides: Partial<SpotCard> = {}, vehicle: Partial<SpotCard['vehicle']> = {}): SpotCard {
  return {
    spot_id: '01spot0000000000000000000a',
    spotted_at: '2026-11-14T15:30:00+00:00',
    spotted: true,
    vehicle: {
      id: '01ek9000000000000000000000',
      slug: 'honda-civic-type-r-ek9-x1',
      name: 'Honda Civic Type R EK9',
      make: 'Honda',
      make_slug: 'honda',
      model: 'Civic Type R',
      generation: 'EK9',
      generation_slug: 'ek9',
      dex_number: 87,
      rarity: 'rare',
      ghost: false,
      cover: { url: 'https://speedclub.test/media/ek9-1080.webp', width: 1080, height: 1350, thumbhash: null, blurhash: 'ToGb||x]jY_Nt7ayM{j?ofIUofjs' },
      top_mods: [
        { name: 'Variant 3', brand: 'KW' },
        { name: 'TE37', brand: 'Volk Racing' },
      ],
      owner: { username: 'jonas.ek9', display_name: 'Jonas', avatar: null },
      ...vehicle,
    },
    first_spotter: false,
    cities_count_label: 'In 9 Städten gespottet',
    ...overrides,
  };
}

/** A spot answer (POST spots, GET spots/{spot}): the card always carries its spot. */
export function spotResponse(meta: Partial<SpotMeta> = {}, card: SpotCard = spotCard()): SpotResponse {
  return {
    data: { ...card, spot_id: card.spot_id ?? '01spot0000000000000000000a', spotted_at: card.spotted_at ?? '2026-11-14T15:30:00+00:00' },
    meta: { new_in_dex: true, duplicate: false, first_spotter: false, counted: true, reason: null, set_progress: [], ...meta },
  };
}

/** Distinctive digits of the test position: none of them may show up anywhere outside the location module. */
export const LAT = 51.198731;
export const LNG = 6.692517;
export const COORDINATE_TRACES = ['51.1987', '6.6925', '51,1987', '6,6925', 'latitude', 'longitude', '"lat"', '"lng"'];

export function containsCoordinates(value: unknown): boolean {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return COORDINATE_TRACES.some((trace) => text.includes(trace));
}

/** One page of GET me/dex: Laravel's cursor paginator with `found` and `total` in `meta`. */
export function dexPage(cards: SpotCard[], meta: { found?: number; total?: number; next_cursor?: string | null } = {}) {
  return {
    data: cards,
    links: { first: null, last: null, prev: null, next: null },
    meta: { path: 'http://localhost:8080/api/v1/me/dex', per_page: 30, next_cursor: null, prev_cursor: null, found: cards.length, total: 1240, ...meta },
  };
}

/** One set of GET me/dex/sets. */
export function dexSet(overrides: Partial<DexSet> = {}): DexSet {
  return {
    key: 'jdm-legends',
    name: 'JDM Legends',
    kind: 'jdm',
    progress: 1,
    target: 3,
    completed_at: null,
    window: null,
    slots: [
      { found: true, vehicle: spotCard(), silhouette: null },
      { found: false, vehicle: null, silhouette: { make: 'Mazda', generation: 'FD' } },
      { found: false, vehicle: null, silhouette: null },
    ],
    ...overrides,
  };
}
