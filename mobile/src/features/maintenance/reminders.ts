/**
 * Local backup notifications of maintenance reminders (09 §8.8, ADR-441 dedupe contract). The server is the source of truth: its
 * daily 09:00 run pushes each reminder stage once. The app keeps a local notification per planned date stage as a backup for a
 * push that never arrives, and makes sure the member never gets both:
 *
 * - its identifier is the stage's deterministic `key` ("mnt:{item}:d{due}:{lead}"), so scheduling it again replaces it;
 * - it fires about two hours after the server's `fire_at`, so the push comes first;
 * - it is cancelled as soon as a push carrying the same `reminder_key` arrives, or the plan says `sent` / `skipped`;
 * - km stages have no date: only the server sends them.
 *
 * Native only; the web has no local notifications (web push comes with M4.15).
 */
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { useEffect } from 'react';

import { beforeSignOut } from '@/api/queries/auth';
import { useReminderPlan, type ReminderStage } from '@/api/queries/maintenance';
import { PUSH_CHANNEL_ID, readPushPermission } from '@/features/auth/push';
import i18n from '@/i18n';
import { isNative } from '@/lib/platform';
import { useSessionStore } from '@/state/session';

import { MAINTENANCE_TYPES } from './model';

/** Every local backup's identifier starts with this: the server's key format. */
export const REMINDER_PREFIX = 'mnt:';
/** The backup fires this long after the server's push time. */
export const BACKUP_DELAY_MS = 2 * 60 * 60 * 1000;
/** iOS keeps at most 64 pending local notifications per app; the backups never take more than this share. */
export const MAX_BACKUPS = 32;

export type PlannedBackup = { key: string; at: number; stage: ReminderStage };

/** The planned date stages whose backup time is still ahead, nearest first, at most MAX_BACKUPS. */
export function planBackups(stages: readonly ReminderStage[], now: number): PlannedBackup[] {
  return stages
    .filter((stage) => stage.kind === 'date' && stage.status === 'planned' && stage.fire_at !== null)
    .map((stage) => ({ key: stage.key, at: Date.parse(stage.fire_at ?? '') + BACKUP_DELAY_MS, stage }))
    .filter((entry) => Number.isFinite(entry.at) && entry.at > now)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_BACKUPS);
}

export type ReminderScheduler = {
  scheduled: () => Promise<{ identifier: string; at: number | null }[]>;
  schedule: (backup: PlannedBackup) => Promise<void>;
  cancel: (identifier: string) => Promise<void>;
};

/**
 * Brings the scheduled backups in line with the plan: cancels those the plan no longer lists as planned (sent, skipped, deleted,
 * moved), schedules the missing ones and moves those whose time changed. Returns what it did, for tests and logs.
 */
export async function reconcileBackups(
  stages: readonly ReminderStage[],
  scheduler: ReminderScheduler,
  now: number,
): Promise<{ scheduled: string[]; cancelled: string[] }> {
  const wanted = new Map(planBackups(stages, now).map((backup) => [backup.key, backup]));
  const existing = (await scheduler.scheduled()).filter((entry) => entry.identifier.startsWith(REMINDER_PREFIX));
  const cancelled: string[] = [];
  const scheduled: string[] = [];
  for (const entry of existing) {
    const backup = wanted.get(entry.identifier);
    if (!backup) {
      await scheduler.cancel(entry.identifier);
      cancelled.push(entry.identifier);
    } else if (entry.at !== null && entry.at === backup.at) {
      wanted.delete(entry.identifier);
    }
  }
  for (const backup of wanted.values()) {
    await scheduler.schedule(backup);
    scheduled.push(backup.key);
  }
  return { scheduled, cancelled };
}

function typeKey(type: string): string {
  return (MAINTENANCE_TYPES as readonly string[]).includes(type) ? type : 'custom';
}

/** The text of a backup: the same words as the server's push, in the app's language. */
export function backupContent(stage: ReminderStage): Notifications.NotificationContentInput {
  const t = i18n.getFixedT(null, 'garage');
  const what = t(`maintenance.type.${typeKey(stage.type)}`);
  const lead = stage.lead_days ?? 0;
  return {
    title: t('maintenance.notification.title', { what }),
    body: lead === 0 ? t('maintenance.notification.today', { what }) : t('maintenance.notification.body', { what, count: lead }),
    data: { path: `/garage/${stage.vehicle_id}/maintenance`, reminder_key: stage.key, type: 'maintenance_due' },
  };
}

function triggerDate(request: Notifications.NotificationRequest): number | null {
  const trigger = request.trigger as { type?: string; value?: number; date?: number } | null;
  if (!trigger) return null;
  if (typeof trigger.value === 'number') return trigger.value;
  if (typeof trigger.date === 'number') return trigger.date;
  return null;
}

export const nativeScheduler: ReminderScheduler = {
  scheduled: async () =>
    (await Notifications.getAllScheduledNotificationsAsync()).map((request) => ({ identifier: request.identifier, at: triggerDate(request) })),
  schedule: async (backup) => {
    await Notifications.scheduleNotificationAsync({
      identifier: backup.key,
      content: backupContent(backup.stage),
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: backup.at, channelId: PUSH_CHANNEL_ID },
    });
  },
  cancel: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
};

/** The `reminder_key` a received push carries (maintenance_due), if any. */
export function reminderKeyOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const key = (data as { reminder_key?: unknown }).reminder_key;
  return typeof key === 'string' && key.startsWith(REMINDER_PREFIX) ? key : null;
}

/** Cancels every backup, for sign-out (the next account never gets this member's reminders). */
export async function cancelAllBackups(scheduler: ReminderScheduler = nativeScheduler): Promise<void> {
  if (!isNative) return;
  for (const entry of await scheduler.scheduled()) {
    if (entry.identifier.startsWith(REMINDER_PREFIX)) await scheduler.cancel(entry.identifier);
  }
}

// The backups name this member's cars: they never stay for the next account on this device.
beforeSignOut(() => cancelAllBackups().catch(() => undefined));

/**
 * Mount once while a member is signed in (native): reconciles the backups with every fresh reminder plan, and cancels a backup
 * the moment the server's push with the same key arrives. Schedules nothing without notification permission.
 */
export function useLocalReminderBackups(): void {
  const member = useSessionStore((state) => state.status === 'member');
  const plan = useReminderPlan(isNative && member);
  const stages = plan.data?.stages;

  useEffect(() => {
    if (!isNative || !stages) return;
    let cancelled = false;
    void (async () => {
      try {
        if ((await readPushPermission()) !== 'granted' || cancelled) return;
        await reconcileBackups(stages, nativeScheduler, Date.now());
      } catch (error) {
        console.warn('Could not schedule the maintenance reminders', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stages]);

  useEffect(() => {
    if (!isNative) return undefined;
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const key = reminderKeyOf(notification.request.content.data);
      // The server's push arrived: its backup must not fire as well. A received backup (same key, local) is harmless to cancel.
      if (key && notification.request.identifier !== key) void nativeScheduler.cancel(key).catch(() => undefined);
    });
    return () => subscription?.remove?.();
  }, []);
}
