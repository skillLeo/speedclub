/**
 * SET-25 Was ist neu (09 §7.9): the release notes, newest first. There is no release-notes endpoint yet, so the member-facing
 * notes ship with the app (written from docs/RELEASES.md and the module register in plain words; strings in `settings`
 * `whatsNew.items.*`). Only what the release really brought; nothing announced ahead.
 */
export type ReleaseNote = {
  /** The app version, as the version line shows it. */
  version: string;
  /** ISO date of the release (the build or phase end in docs/RELEASES.md). */
  date: string;
  /** Keys of `whatsNew.items.<key>` (title) and `whatsNew.items.<key>Body` (one line). */
  items: readonly string[];
};

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  { version: '2.0.0', date: '2026-11-12', items: ['look', 'signIn', 'security', 'social', 'garage', 'settings'] },
  { version: '1.0.0', date: '2026-11-10', items: ['safety', 'ai', 'stability'] },
  { version: '0.2.0', date: '2026-11-09', items: ['home', 'discover', 'messages', 'settingsV1'] },
  { version: '0.1.0', date: '2026-11-08', items: ['garageV1', 'qr', 'publicPage'] },
];
