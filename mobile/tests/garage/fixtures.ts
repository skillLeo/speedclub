/** Garage resources as the API sends them for the flagship R34 and a draft (docs/api/openapi.json). */
import type { ModCategoryField } from '@/api/queries/catalog';
import type { GarageVehicle } from '@/api/queries/garage';
import type { OwnerMod } from '@/api/queries/mods';
import type { VehicleCardData } from '@/api/queries/profile';

export const VEHICLE_ID = '01m6f7zv1vs5e2xw9a96cbqzyp';
export const SLUG = 'nissan-skyline-gt-r-r34-5tf974vj';

export function media(id: string, overrides: Partial<GarageVehicle['photos'][number]> = {}): GarageVehicle['photos'][number] {
  return {
    id,
    status: 'ready',
    category: 'exterior',
    width: 1600,
    height: 1200,
    blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    thumbhash: null,
    focal_x: null,
    focal_y: null,
    alt: null,
    sort: 0,
    variants: [{ width: 640, height: 480, url: `https://speedclub.test/media/${id}-640.webp` }],
    created_at: '2026-10-01T10:00:00+02:00',
    ...overrides,
  };
}

export function card(overrides: Partial<VehicleCardData> = {}): VehicleCardData {
  return {
    id: VEHICLE_ID,
    public_id: '5tf974vj',
    slug: SLUG,
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
    color: 'Bayside Blue',
    model_year: 2002,
    subline_parts: ['2002', '2,6 l R6 Biturbo (RB26DETT)', 'Bayside Blue'],
    spec_strip: [
      { key: 'power', value: '500', unit: 'PS', label: 'PS' },
      { key: 'torque', value: '540', unit: 'Nm', label: 'Nm' },
      { key: 'model_year', value: '2002', unit: null, label: 'Baujahr' },
      { key: 'drivetrain', value: 'AWD', unit: null, label: 'Antrieb' },
    ],
    cover: media('01cover'),
    photo_count: 3,
    mod_count: 14,
    updates_count: null,
    published_at: '2026-10-01T10:00:00+02:00',
    updated_at: '2026-11-01T10:00:00+01:00',
    wizard: null,
    completeness: { percent: 70, is_complete: false, line: 'Build zu 70 % vollständig', hint: 'Noch 3 Angaben bis zum vollständigen Build', missing: [] },
    qr: { code: '8TR0Q3MC', url: 'https://speedclub.test/C/8TR0Q3MC' },
    ...overrides,
  };
}

export function draftCard(overrides: Partial<VehicleCardData> = {}): VehicleCardData {
  return card({
    id: '01draft',
    public_id: 'ab12cd34',
    slug: 'bmw-m3-e46-ab12cd34',
    status: 'draft',
    is_main: false,
    is_sample: false,
    make: 'BMW',
    model: 'M3',
    generation: 'E46',
    title: 'M3 E46',
    full_title: 'BMW M3 E46',
    cover: null,
    published_at: null,
    wizard: { step: 2, total_steps: 4 },
    qr: null,
    ...overrides,
  });
}

export function vehicle(overrides: Partial<GarageVehicle> = {}): GarageVehicle {
  return {
    ...card(),
    make_id: 34,
    model_id: 254,
    generation_id: 120,
    make_text: null,
    model_text: null,
    description: 'Seit 2015 in meiner Garage.',
    cover_media_id: null,
    hu_au_due: null,
    photos: [media('01cover'), media('01side', { sort: 1 })],
    failed_photos: [],
    specs: {
      engine_code: 'RB26DETT',
      engine_text: '2,6 l R6 Biturbo',
      displacement_cc: 2568,
      fuel: 'petrol',
      aspiration: 'biturbo',
      power_value: 368.5,
      power_unit: 'kw',
      power_source: 'measured',
      power_ps: 501,
      torque_nm: 540,
      torque_source: 'claimed',
      drivetrain: 'all',
      gearbox: 'manual',
    },
    share_card_url: null,
    ...overrides,
  };
}

function field(key: string, overrides: Partial<ModCategoryField> = {}): ModCategoryField {
  return { key, label: key, type: 'text', unit: null, min: null, max: null, step: null, options: null, pattern: null, example: null, required: false, searchable: false, facet: false, archived: false, ...overrides };
}

/** The seeded schema of Räder & Reifen (ModCategorySeeder), in its order. */
export const WHEEL_FIELDS: ModCategoryField[] = [
  field('wheel_brand', { label: 'Felgenmarke', type: 'brand' }),
  field('wheel_model', { label: 'Felgenmodell' }),
  field('diameter', { label: 'Durchmesser', type: 'number', unit: 'in', min: 13, max: 24, step: 0.5 }),
  field('diameter_rear', { label: 'Durchmesser hinten', type: 'number', unit: 'in', min: 13, max: 24, step: 0.5 }),
  field('width_front', { label: 'Breite vorne', type: 'number', unit: 'in', min: 3, max: 16, step: 0.5 }),
  field('width_rear', { label: 'Breite hinten', type: 'number', unit: 'in', min: 3, max: 16, step: 0.5 }),
  field('et_front', { label: 'ET vorne', type: 'number', min: -50, max: 70 }),
  field('et_rear', { label: 'ET hinten', type: 'number', min: -50, max: 70 }),
  field('bolt_pattern', { label: 'Lochkreis', example: '5x120' }),
  field('finish', { label: 'Finish/Farbe' }),
  field('staggered', { label: 'Mischbereifung', type: 'boolean' }),
  field('tyre_brand', { label: 'Reifenmarke', type: 'brand' }),
  field('tyre_model', { label: 'Reifenmodell' }),
  field('tyre_size_front', { label: 'Reifengröße vorne', pattern: '^\\d{3}/\\d{2} R\\d{2}$', example: '255/35 R19' }),
  field('tyre_size_rear', { label: 'Reifengröße hinten', pattern: '^\\d{3}/\\d{2} R\\d{2}$', example: '255/35 R19' }),
  field('spacer_front', { label: 'Spurplatten vorne', type: 'number', unit: 'mm', min: 0, max: 60 }),
  field('spacer_rear', { label: 'Spurplatten hinten', type: 'number', unit: 'mm', min: 0, max: 60 }),
];

export const SUSPENSION_FIELDS: ModCategoryField[] = [
  field('type', {
    label: 'Art',
    type: 'select',
    options: [
      { value: 'coilover', label: 'Gewindefahrwerk' },
      { value: 'air', label: 'Luftfahrwerk' },
    ],
  }),
  field('brand', { label: 'Marke', type: 'brand' }),
  field('model', { label: 'Modell' }),
  field('lowering_front', { label: 'Tieferlegung vorne', type: 'number', unit: 'mm', min: 0, max: 200 }),
  field('lowering_rear', { label: 'Tieferlegung hinten', type: 'number', unit: 'mm', min: 0, max: 200 }),
  field('adjustable_damping', { label: 'Dämpfung einstellbar', type: 'boolean' }),
];

export function wheelMod(overrides: Partial<OwnerMod> = {}): OwnerMod {
  return {
    id: '01wheels',
    title: 'BBS LM',
    category: { key: 'wheels_tires', name: 'Räder & Reifen', icon: 'wheel' },
    brand: 'BBS',
    summary_line: 'BBS LM · 19″ × 9,5J ET35 · 255/35 R19',
    status: 'installed',
    status_label: 'Verbaut',
    installed_on: '2023-03',
    installed_label: 'März 2023',
    cost_public: false,
    cost: { cents: 240000, label: '2.400 €' },
    legal_status: null,
    legal_status_label: null,
    thumb: null,
    vehicle_id: VEHICLE_ID,
    brand_id: null,
    brand_text: 'BBS',
    part_name: 'LM',
    part_number: null,
    notes: 'Neu lackiert',
    sort: 0,
    specs: [],
    fields: { wheel_brand: 'BBS', wheel_model: 'LM', diameter: 19, width_front: 9.5, et_front: 35, tyre_size_front: '255/35 R19', staggered: false },
    legal_disclaimer: null,
    photos: [],
    failed_photos: [],
    search: { mod_category: 'wheels_tires', wheel_brand: 'bbs', wheel_diameter: 19, suspension_type: null, suspension_brand: null, exhaust_brand: null },
    ...overrides,
  };
}
