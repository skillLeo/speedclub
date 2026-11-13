import type { ActiveMember, BuildUpdateRowData, FeaturedBuild, FeedItem, FeedSuggestion, FeedVehicle, HomeModules, PopularMod } from '@/api/queries/home';
import type { AppNotification } from '@/api/queries/notifications';
import type { MakeTile } from '@/api/queries/discover';
import type { SearchMember, SearchOverview } from '@/api/queries/search';

/** The shapes of docs/reports/phase-1/m1.8-api-handover.md, with the demo data's R34 of kenji.r34. */
export function feedVehicle(overrides: Partial<FeedVehicle> = {}): FeedVehicle {
  return {
    id: '01m6f8041fr34',
    public_id: 'xmeypf41',
    slug: 'nissan-skyline-gt-r-r34-xmeypf41',
    status: 'published',
    visibility: 'public',
    is_main: true,
    is_sample: false,
    eyebrow: 'NISSAN',
    make: 'Nissan',
    model: 'Skyline GT-R',
    generation: 'R34',
    title: 'Skyline GT-R R34',
    full_title: 'Nissan Skyline GT-R R34',
    nickname: null,
    color: 'Athlete Silver',
    model_year: 2001,
    subline_parts: ['2001', '2,6 l R6 Biturbo (RB26DETT)', 'Athlete Silver'],
    spec_strip: [
      { key: 'power', value: '280', unit: 'PS', label: 'PS' },
      { key: 'torque', value: '392', unit: 'Nm', label: 'Nm' },
      { key: 'model_year', value: '2001', unit: null, label: 'Baujahr' },
      { key: 'drivetrain', value: 'AWD', unit: null, label: 'Antrieb' },
    ],
    cover: {
      id: 'media-r34',
      status: 'ready',
      category: 'exterior',
      width: 1600,
      height: 1200,
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      thumbhash: null,
      focal_x: 0.5,
      focal_y: 0.6,
      alt: null,
      sort: 0,
      variants: [{ width: 800, height: 600, url: 'https://speedclub.test/media/r34-800.webp' }],
      created_at: '2026-04-01T10:00:00+00:00',
    },
    photo_count: 6,
    mod_count: 9,
    updates_count: null,
    viewer: null,
    published_at: '2026-03-01T10:00:00+00:00',
    updated_at: '2026-11-04T09:00:00+00:00',
    wizard: null,
    completeness: null,
    qr: null,
    owner: { username: 'kenji.r34', display_name: 'Kenji Tanaka', city: 'Düsseldorf', avatar: null, is_sample: false, is_editorial: false },
    latest_update: {
      id: 'update-1',
      type_label: 'Modifikation hinzugefügt',
      summary: 'Räder: Serie 18″ → Volk Racing TE37 SL 18″ × 9,5J',
      created_at: '2026-11-04T09:00:00+00:00',
    },
    ...overrides,
  };
}

export const R34 = feedVehicle();
export const M4 = feedVehicle({
  id: '01m6f8041fm4',
  public_id: 'm4g82abc',
  slug: 'bmw-m4-g82-m4g82abc',
  eyebrow: 'BMW',
  make: 'BMW',
  model: 'M4',
  generation: 'G82',
  title: 'M4 G82',
  full_title: 'BMW M4 G82',
  subline_parts: ['2022', '3,0 l R6 Biturbo (S58)'],
  owner: null,
  latest_update: null,
});

/** A second build of kenji.r34, so the featured build is not one of the feed's cards. */
export const GTI = feedVehicle({
  id: '01m6f8041fgti',
  public_id: 'gti8cd01',
  slug: 'volkswagen-golf-gti-gti8cd01',
  eyebrow: 'VOLKSWAGEN',
  make: 'Volkswagen',
  model: 'Golf GTI',
  generation: null,
  title: 'Golf GTI',
  full_title: 'Volkswagen Golf GTI',
  subline_parts: ['2021', '2,0 l R4 Turbo (EA888)'],
  latest_update: null,
});

export const FEATURED: FeaturedBuild[] = [{ source: 'editorial', vehicle: GTI, quote: null }];

export const MAKES: MakeTile[] = [
  { id: 1, name: 'BMW', slug: 'bmw', vehicle_count: 12 },
  { id: 2, name: 'Nissan', slug: 'nissan', vehicle_count: 1 },
];

export const KENJI: SearchMember = {
  username: 'kenji.r34',
  display_name: 'Kenji Tanaka',
  city: 'Düsseldorf',
  avatar: null,
  is_sample: false,
  is_editorial: false,
  garage: { vehicles: 4, makes: ['Nissan', 'Toyota'], line: '4 Fahrzeuge · Nissan, Toyota' },
  is_self: false,
  is_following: false,
  can_message: true,
  cannot_message_reason: null,
};

export function page<T>(data: T[], next: string | null = null) {
  return { data, links: { first: null, last: null, prev: null, next: null }, meta: { path: null, per_page: 20, next_cursor: next, prev_cursor: null } };
}

export function overview(overrides: Partial<SearchOverview> = {}): SearchOverview {
  return {
    query: 'r34',
    vehicles: { count: 1, count_capped: false, items: [R34], next_cursor: null },
    members: { count: 1, count_capped: false, items: [KENJI], next_cursor: null },
    ...overrides,
  };
}

// -- M2.2 (docs/reports/phase-2/m2.2-contract.md, as built)

export function buildUpdate(overrides: Partial<BuildUpdateRowData> = {}): BuildUpdateRowData {
  return {
    id: 'update-kw',
    vehicle: M4,
    type: 'mod_changed',
    type_label: 'Fahrwerk geändert',
    summary: 'Serie → KW V3 · −35 mm',
    created_at: '2026-11-07T18:00:00+00:00',
    media: [],
    viewer: null,
    ...overrides,
  };
}

export function activeMember(overrides: Partial<ActiveMember> = {}): ActiveMember {
  return { username: 'jann.ptrs', display_name: 'Jann Peters', city: 'Hamburg', avatar: null, is_sample: false, is_editorial: false, car_line: 'BMW M4 Competition', car_short: null, is_following: false, ...overrides };
}

export const MODS: PopularMod[] = [
  { label: 'KW V3', category_key: 'suspension', query: 'KW V3' },
  { label: 'BBS', category_key: 'wheels', query: 'BBS' },
];

export function modules(overrides: Partial<HomeModules> = {}): HomeModules {
  return {
    build_of_week: null,
    nearby_events: [],
    brands_in_focus: [],
    build_updates: [buildUpdate()],
    active_members: [activeMember()],
    popular_mods: MODS,
    ...overrides,
  };
}

export const vehicleItem = (vehicle: FeedVehicle): FeedItem => ({ type: 'vehicle', key: `v.${vehicle.id}`, vehicle, update: null });
export const updateItem = (update: BuildUpdateRowData): FeedItem => ({ type: 'update', key: `u.${update.id}`, vehicle: null, update });

export function feedPage(data: FeedItem[], next: string | null = null, suggestions: FeedSuggestion[] | null = null) {
  return { data, meta: { next_cursor: next, per_page: 20, suggestions } };
}

export function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n-1',
    type: 'new_follower',
    group_key: 'new_follower:2026-11-08',
    actors: [{ username: 'lukas.sc', display_name: 'Lukas Scholz', city: 'Stuttgart', avatar: null, is_sample: false, is_editorial: false, main_vehicle_cover: null }],
    actor_count: 1,
    vehicle: null,
    event: null,
    details: {},
    read_at: null,
    created_at: '2026-11-08T09:00:00+00:00',
    ...overrides,
  };
}
