import type { MaintenanceUpcoming } from '@/api/queries/maintenance';
import type { MediaData, VehicleCardData } from '@/api/queries/profile';
import type { WidgetSnapshot } from '@/features/widget/snapshot';

import { item } from '../maintenance/fixtures';

export const R34 = '01m7549g2v8m4q1g1g8xjg1zqp';
export const S15 = '01m7549ga5d8jc4agaagkcxzeb';

export function media(overrides: Partial<MediaData> = {}): MediaData {
  return {
    id: 'm1',
    status: 'ready',
    category: 'exterior',
    width: 1440,
    height: 1920,
    blurhash: null,
    thumbhash: null,
    focal_x: 0.54,
    focal_y: 0.66,
    alt: null,
    sort: 1,
    variants: [
      { width: 320, height: 427, url: 'https://cdn/320.webp' },
      { width: 640, height: 853, url: 'https://cdn/640.webp' },
      { width: 1080, height: 1440, url: 'https://cdn/1080.webp' },
      { width: 1440, height: 1920, url: 'https://cdn/1440.webp' },
    ],
    created_at: null,
    ...overrides,
  };
}

export function vehicle(overrides: Partial<VehicleCardData> = {}): VehicleCardData {
  return {
    id: R34,
    public_id: '5TF974VJ',
    slug: 'nissan-skyline-gt-r-r34-5tf974vj',
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
    subline_parts: ['2002'],
    spec_strip: [],
    cover: media(),
    photo_count: 3,
    mod_count: 14,
    updates_count: null,
    published_at: '2026-03-14T18:30:00+00:00',
    updated_at: null,
    wizard: null,
    completeness: null,
    qr: null,
    ...overrides,
  };
}

export function upcoming(overrides: Partial<MaintenanceUpcoming> = {}): MaintenanceUpcoming {
  return {
    ...item({ days_left: 43, state: 'ok' }),
    vehicle: { id: R34, slug: 'nissan-skyline-gt-r-r34-5tf974vj', full_title: 'Nissan Skyline GT-R R34', cover: null, is_sample: false },
    ...overrides,
  };
}

export function snapshot(overrides: Partial<WidgetSnapshot> = {}): WidgetSnapshot {
  return {
    v: 1,
    member: 'member-1',
    locale: 'de',
    unit: 'km',
    day: '2026-11-13',
    car: {
      id: R34,
      name: 'Skyline GT-R R34',
      eyebrow: 'NISSAN',
      photo: { uri: 'file:///docs/widget/car-m1-1080.jpg', mediaId: 'm1', source: 'https://cdn/1080.webp', width: 480, height: 600 },
      due: { title: 'HU/AU', days: 43, km: null, state: 'ok' },
      dueKnown: true,
    },
    ...overrides,
  };
}
