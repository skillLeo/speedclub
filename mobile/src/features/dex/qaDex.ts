/**
 * The bundled Dex set of the non-production override `qaDex` (mobile/src/lib/qa.ts): DEX-01, -04, -05, -06, the VEH-01 owner line
 * and the spot map layer answer from it, so the visual matrix can capture them before the server has spots. Four real cars on the
 * licensed seed photos (design/seed-photos/CREDITS.md). Never shown to a member: `qa` has no overrides in production. The member's
 * own empty state uses `SAMPLE_TILES` from here, always badged "Beispiel" and without any count.
 */
import type { DexMeta, DexSet, RarityRules, SpotCard, SpotMap, SpotStats } from '@/api/queries/dex';
import { EMPTY_HERO, SAMPLE_CARD_PHOTO } from '@/features/garage/sample';
import { qa } from '@/lib/qa';
import type { PhotoFields } from '@/ui/Photo';

/** Whether this session answers the Dex reads from the QA set. */
export function qaDexActive(): boolean {
  return qa.dex !== undefined;
}

const PHOTOS: Readonly<Record<string, PhotoFields>> = {
  'sample-r34': SAMPLE_CARD_PHOTO,
  'sample-e46': EMPTY_HERO,
  'sample-992': {
    source: require('@/assets/gallery/porsche-992-01.jpg') as number,
    thumbhash: '0CgGBQLEqFZmmEcHmYfqVgWBKQSo',
    focal: { x: 0.5, y: 0.54 },
  },
  'sample-rs3': {
    source: require('@/assets/gallery/audi-rs3-8y-01.jpg') as number,
    thumbhash: 'zvcJFQSVl4R4eGj3d5mHqKmCnxr4',
    focal: { x: 0.5, y: 0.53 },
  },
};

/** The bundled photo of a sample car, for the tiles and DEX-04 (the sample cars have no cover URL). */
export function samplePhoto(vehicleId: string): PhotoFields | undefined {
  return PHOTOS[vehicleId];
}

type CarSeed = Pick<SpotCard['vehicle'], 'id' | 'name' | 'make' | 'model' | 'generation' | 'rarity' | 'ghost'> & {
  number: number;
  mods: SpotCard['vehicle']['top_mods'];
  first?: boolean;
};

const CARS: readonly CarSeed[] = [
  {
    id: 'sample-r34',
    name: 'Nissan Skyline GT-R R34', // i18n-ignore: a car name
    make: 'Nissan', // i18n-ignore
    model: 'Skyline GT-R', // i18n-ignore
    generation: 'R34', // i18n-ignore
    rarity: 'rare',
    ghost: false,
    number: 34,
    first: true,
    mods: [
      { name: 'Variant 3', brand: 'KW' }, // i18n-ignore
      { name: 'TE37 SL', brand: 'Volk Racing' }, // i18n-ignore
      { name: 'Hi-Power Spec-L II', brand: 'HKS' }, // i18n-ignore
    ],
  },
  {
    id: 'sample-992',
    name: 'Porsche 911 Carrera S 992', // i18n-ignore
    make: 'Porsche', // i18n-ignore
    model: '911', // i18n-ignore
    generation: '992', // i18n-ignore
    rarity: 'legend',
    ghost: false,
    number: 211,
    mods: [
      { name: 'Clubsport', brand: 'KW' }, // i18n-ignore
      { name: 'Valvetronic', brand: 'Akrapovič' }, // i18n-ignore
    ],
  },
  {
    id: 'sample-rs3',
    name: 'Audi RS 3 Sportback 8Y', // i18n-ignore
    make: 'Audi', // i18n-ignore
    model: 'RS 3', // i18n-ignore
    generation: '8Y', // i18n-ignore
    rarity: 'street',
    ghost: false,
    number: 642,
    mods: [{ name: 'Race', brand: 'Wagner Tuning' }], // i18n-ignore
  },
  {
    id: 'sample-e46',
    name: 'BMW M3 E46', // i18n-ignore
    make: 'BMW', // i18n-ignore
    model: 'M3', // i18n-ignore
    generation: 'E46', // i18n-ignore
    rarity: 'ghost',
    ghost: true,
    number: 1187,
    mods: [
      { name: 'Variant 3', brand: 'KW' }, // i18n-ignore
      { name: 'CSL-Airbox', brand: 'BMW' }, // i18n-ignore
    ],
  },
];

function cardOf(seed: CarSeed, index: number): SpotCard {
  return {
    spot_id: `sample-spot-${index + 1}`,
    // Before the matrix's qaNow (2 November 2026), so no sample is dated in the future (DQ-P5G-40).
    spotted_at: `2026-10-${String(28 - index).padStart(2, '0')}T17:30:00+01:00`,
    spotted: true,
    vehicle: {
      id: seed.id,
      slug: seed.id,
      name: seed.name,
      make: seed.make,
      make_slug: seed.make?.toLowerCase() ?? null,
      model: seed.model,
      generation: seed.generation,
      generation_slug: seed.generation?.toLowerCase() ?? null,
      dex_number: seed.number,
      rarity: seed.rarity,
      ghost: seed.ghost,
      cover: null,
      top_mods: seed.mods,
      owner: null,
    },
    first_spotter: seed.first === true,
    cities_count_label: null,
  };
}

export const QA_CARDS: readonly SpotCard[] = CARS.map(cardOf);

/** The QA collection's progress line: the four cards of a Dex the matrix shows as "Dex 4 / 1.240". */
export const QA_META: DexMeta = { found: QA_CARDS.length, total: 1240, next_cursor: null };

const found = (index: number) => ({ found: true, vehicle: QA_CARDS[index] as SpotCard, silhouette: null });
const open = (make: string | null, generation: string | null) => ({ found: false, vehicle: null, silhouette: make || generation ? { make, generation } : null });

/** Four sets: JDM Legends (generations named), a brand set, the open season and the completed Saisonstart. */
export const QA_SETS: readonly DexSet[] = [
  {
    key: 'jdm-legends',
    name: 'JDM Legends', // i18n-ignore: a set name, from the server
    kind: 'jdm',
    progress: 1,
    target: 6,
    completed_at: null,
    window: null,
    slots: [
      found(0),
      open('Honda', 'EK9'), // i18n-ignore
      open('Mazda', 'FD'), // i18n-ignore
      open('Toyota', 'A80'), // i18n-ignore
      open('Mitsubishi', 'CP9A'), // i18n-ignore
      open('Subaru', 'GC8'), // i18n-ignore
    ],
  },
  {
    key: 'brand-porsche-5',
    name: 'Porsche · 5 Autos', // i18n-ignore
    kind: 'brand',
    progress: 1,
    target: 5,
    completed_at: null,
    window: null,
    slots: [found(1), open(null, null), open(null, null), open(null, null), open(null, null)],
  },
  {
    key: 'season-2026',
    name: 'Saison 2026', // i18n-ignore
    kind: 'season',
    progress: 2,
    target: 10,
    completed_at: null,
    window: { starts_on: '05-01', ends_on: '10-31' },
    slots: [found(2), found(0), ...Array.from({ length: 8 }, () => open(null, null))],
  },
  {
    key: 'season-start-2026',
    name: 'Saisonstart 2026', // i18n-ignore
    kind: 'season',
    progress: 3,
    target: 3,
    completed_at: '2026-04-12T18:00:00+02:00',
    window: { starts_on: '03-01', ends_on: '04-30' },
    slots: [found(0), found(1), found(2)],
  },
];

/** The contract's defaults (config `dex.rarity`): the sheet under `qaDex`. */
export const QA_RARITY_RULES: RarityRules = { tunedScore: 500, rareMax: 5, legendScore: 850 };

const DAY_MS = 24 * 60 * 60 * 1000;
/** Spots per day of the QA owner, oldest first: a quiet month with two meets. */
const QA_DAYS = [0, 1, 0, 0, 2, 0, 1, 0, 0, 0, 6, 3, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 9, 4, 0, 1, 0, 2, 1];

/** DEX-06 under `qaDex`: the R34's month, two named spotters and one who keeps their spots to themselves. */
export function qaSpotStats(now: Date = qa.now ?? new Date()): SpotStats {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    total: 37,
    unique_spotters: 29,
    cities_count: 6,
    cities: [
      { name: 'Köln', count: 14 }, // i18n-ignore: a city
      { name: 'Düsseldorf', count: 9 }, // i18n-ignore
      { name: 'Essen', count: 5 }, // i18n-ignore
      { name: 'Bonn', count: 3 }, // i18n-ignore
      { name: 'Aachen', count: 2 }, // i18n-ignore
      { name: 'Dortmund', count: 1 }, // i18n-ignore
    ],
    last_30_days: QA_DAYS.map((count, index) => ({
      day: new Date(today - (QA_DAYS.length - 1 - index) * DAY_MS).toISOString().slice(0, 10),
      count,
    })),
    recent_spotters: [
      { username: 'mara.fd', display_name: 'Mara', avatar: null }, // i18n-ignore
      { anonymous: true },
      { username: 'tim.e30', display_name: null, avatar: null }, // i18n-ignore
    ],
    street_famous: { tier: 10 },
  };
}

/** The spot map layer under `qaDex`: twelve cities, ids from the public GeoNames file. */
export const QA_SPOT_MAP: SpotMap = {
  generated_at: '2026-11-14T06:00:00+01:00',
  cities: [
    [2950159, 'Berlin', 'BE', 41],
    [2886242, 'Köln', 'NW', 33],
    [2867714, 'München', 'BY', 26],
    [2911298, 'Hamburg', 'HH', 18],
    [2925533, 'Frankfurt am Main', 'HE', 15],
    [2934246, 'Düsseldorf', 'NW', 12],
    [2825297, 'Stuttgart', 'BW', 9],
    [2935517, 'Dortmund', 'NW', 8],
    [2879139, 'Leipzig', 'SN', 7],
    [2861650, 'Nürnberg', 'BY', 6],
    [2910831, 'Hannover', 'NI', 5],
    [2935022, 'Dresden', 'SN', 5],
  ].map(([city_id, name, bundesland, count]) => ({ city_id: city_id as number, name: name as string, bundesland: bundesland as string, count: count as number })),
};
