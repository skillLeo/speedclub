/**
 * The local reminder backups (M4.13, ADR-441) are native only: the member web schedules no local notifications, and reminders.ts's hook
 * does nothing there. This web file keeps expo-notifications' scheduler out of the member web's first scripts (M5.12a, 09 §12). The root
 * layout is its only importer; anything else from reminders.ts is native code.
 */
export function useLocalReminderBackups(): void {}
