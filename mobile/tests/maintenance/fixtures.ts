import type { MaintenanceItem, MaintenanceLog, ReminderStage } from '@/api/queries/maintenance';

export const VEHICLE = '01m7549g2v8m4q1g1g8xjg1zqp';

export function item(overrides: Partial<MaintenanceItem> = {}): MaintenanceItem {
  return {
    id: '01mnt0000000000000000000hu',
    vehicle_id: VEHICLE,
    type: 'hu_au',
    title: null,
    interval: { months: 24, km: null },
    last_done: { date: null, km: null },
    next_due: { date: '2027-03-01', month: '2027-03', km: null, pinned: true, deadline: '2027-03-31' },
    season: '',
    lead_days: [30, 14, 1],
    enabled: true,
    notes: null,
    state: 'ok',
    days_left: 132,
    km_left: null,
    progress: 0.82,
    reminders: [],
    version: 1,
    updated_at: '2026-11-12T09:00:00Z',
    ...overrides,
  };
}

export function log(overrides: Partial<MaintenanceLog> = {}): MaintenanceLog {
  return {
    id: '01mlog00000000000000000001',
    vehicle_id: VEHICLE,
    item_id: null,
    type: 'oil_change',
    title: null,
    done_at: '2026-06-14',
    mileage_km: 41200,
    workshop: 'Werkstatt am Ring',
    business_id: null,
    cost: { cents: 18950, currency: 'EUR', label: '189,50 €' },
    notes: 'Castrol Edge 5W-30',
    photos: [],
    version: 1,
    created_at: '2026-06-14T10:00:00Z',
    updated_at: '2026-06-14T10:00:00Z',
    ...overrides,
  };
}

export function stage(overrides: Partial<ReminderStage> = {}): ReminderStage {
  return {
    key: 'mnt:01mnt0000000000000000000hu:d2027-03-01:30',
    kind: 'date',
    item_id: '01mnt0000000000000000000hu',
    vehicle_id: VEHICLE,
    type: 'hu_au',
    due_on: '2027-03-01',
    due_km: null,
    lead_days: 30,
    fire_on: '2027-01-30',
    fire_at: '2027-01-30T08:00:00Z',
    status: 'planned',
    ...overrides,
  };
}
