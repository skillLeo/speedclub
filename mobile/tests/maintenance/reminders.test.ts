import { BACKUP_DELAY_MS, backupContent, MAX_BACKUPS, planBackups, reconcileBackups, reminderKeyOf, type ReminderScheduler } from '@/features/maintenance/reminders';

import { stage, VEHICLE } from './fixtures';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid') }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const NOW = Date.parse('2026-11-12T10:00:00Z');

function fakeScheduler(initial: { identifier: string; at: number | null }[] = []) {
  const scheduled = new Map(initial.map((entry) => [entry.identifier, entry.at]));
  const scheduler: ReminderScheduler & { map: typeof scheduled } = {
    map: scheduled,
    scheduled: async () => [...scheduled].map(([identifier, at]) => ({ identifier, at })),
    schedule: async (backup) => void scheduled.set(backup.key, backup.at),
    cancel: async (identifier) => void scheduled.delete(identifier),
  };
  return scheduler;
}

describe('local reminder backups (ADR-441 dedupe contract)', () => {
  it('only planned date stages ahead, two hours after the server push, nearest first', () => {
    const plan = planBackups(
      [
        stage({ key: 'mnt:a:d2027-03-01:30', fire_at: '2027-01-30T08:00:00Z' }),
        stage({ key: 'mnt:a:d2027-03-01:14', fire_at: '2027-02-15T08:00:00Z' }),
        stage({ key: 'mnt:a:k60000', kind: 'km', fire_at: null, fire_on: null }),
        stage({ key: 'mnt:a:d2026-12-01:30', status: 'sent' }),
        stage({ key: 'mnt:a:d2026-11-01:1', fire_at: '2026-11-01T08:00:00Z' }),
      ],
      NOW,
    );
    expect(plan.map((entry) => entry.key)).toEqual(['mnt:a:d2027-03-01:30', 'mnt:a:d2027-03-01:14']);
    expect(plan[0]?.at).toBe(Date.parse('2027-01-30T08:00:00Z') + BACKUP_DELAY_MS);
  });

  it('never more than the cap', () => {
    const many = Array.from({ length: MAX_BACKUPS + 5 }, (_, index) => stage({ key: `mnt:x${index}:d2027-01-01:1`, fire_at: new Date(NOW + (index + 1) * 86_400_000).toISOString() }));
    expect(planBackups(many, NOW)).toHaveLength(MAX_BACKUPS);
  });

  it('reconciles: cancels what is sent or gone, keeps what is right, schedules what is missing, leaves other notifications alone', async () => {
    const keep = stage({ key: 'mnt:a:d2027-03-01:30' });
    const add = stage({ key: 'mnt:b:d2027-04-01:14', fire_at: '2027-03-18T08:00:00Z' });
    const scheduler = fakeScheduler([
      { identifier: keep.key, at: Date.parse(keep.fire_at ?? '') + BACKUP_DELAY_MS },
      { identifier: 'mnt:old:d2026-12-01:30', at: NOW + 1000 },
      { identifier: 'event-reminder-1', at: NOW + 1000 },
    ]);
    const result = await reconcileBackups([keep, add, stage({ key: 'mnt:old:d2026-12-01:30', status: 'sent' })], scheduler, NOW);
    expect(result).toEqual({ scheduled: [add.key], cancelled: ['mnt:old:d2026-12-01:30'] });
    expect([...scheduler.map.keys()].sort()).toEqual(['event-reminder-1', add.key, keep.key].sort());
  });

  it('a moved due date reschedules under the same id (no duplicate)', async () => {
    const moved = stage({ fire_at: '2027-02-01T08:00:00Z' });
    const scheduler = fakeScheduler([{ identifier: moved.key, at: NOW + 5 }]);
    await reconcileBackups([moved], scheduler, NOW);
    expect(scheduler.map.get(moved.key)).toBe(Date.parse('2027-02-01T08:00:00Z') + BACKUP_DELAY_MS);
    expect(scheduler.map.size).toBe(1);
  });

  it('the push carries the key; the backup speaks German and opens MNT-01', () => {
    expect(reminderKeyOf({ reminder_key: 'mnt:a:d2027-03-01:30', type: 'maintenance_due' })).toBe('mnt:a:d2027-03-01:30');
    expect(reminderKeyOf({ reminder_key: 'other' })).toBeNull();
    expect(reminderKeyOf(null)).toBeNull();
    const content = backupContent(stage());
    expect(content.title).toBe('HU/AU steht an');
    expect(content.body).toBe('HU/AU ist in 30 Tagen fällig.');
    expect(content.data).toEqual({ path: `/garage/${VEHICLE}/maintenance`, reminder_key: stage().key, type: 'maintenance_due' });
  });
});
