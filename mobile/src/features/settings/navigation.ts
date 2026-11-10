/**
 * FS-12: the groups of SET-01 and their rows, in order. One map for the list on a phone and the 280 side pane on desktop, so
 * the two can never disagree. Rows a guest cannot use are left out for guests, never shown dead.
 */
import type { IconName } from '@/ui';

export type SettingsKey =
  | 'account'
  | 'password'
  | 'twoFactor'
  | 'sessions'
  | 'privacy'
  | 'blocked'
  | 'reports'
  | 'notifications'
  | 'appearance'
  | 'language'
  | 'export'
  | 'delete'
  | 'help'
  | 'contact'
  | 'legal';

export type SettingsGroupKey = 'account' | 'security' | 'privacy' | 'app' | 'data' | 'help' | 'legal';

export type SettingsRowDef = {
  key: SettingsKey;
  path: string;
  icon: IconName;
  /** Needs a signed-in member. */
  member: boolean;
};

export type SettingsGroupDef = { key: SettingsGroupKey; rows: readonly SettingsRowDef[] };

export const SETTINGS_PATHS: Readonly<Record<SettingsKey, string>> = {
  account: '/settings/account',
  password: '/settings/security/password',
  twoFactor: '/settings/security/two-factor',
  sessions: '/settings/security/sessions',
  privacy: '/settings/privacy',
  blocked: '/settings/privacy/blocked',
  reports: '/settings/reports',
  notifications: '/settings/notifications',
  appearance: '/settings/appearance',
  language: '/settings/language',
  export: '/settings/data/export',
  delete: '/settings/data/delete',
  help: '/settings/help',
  contact: '/settings/help/contact',
  legal: '/settings/legal',
};

const row = (key: SettingsKey, icon: IconName, member: boolean): SettingsRowDef => ({ key, path: SETTINGS_PATHS[key], icon, member });

/** Konto · Sicherheit · Privatsphäre · App · Daten · Hilfe · Rechtliches; "Über die App" and "Abmelden" follow in the list. */
export const SETTINGS_GROUPS: readonly SettingsGroupDef[] = [
  { key: 'account', rows: [row('account', 'user', true)] },
  {
    key: 'security',
    rows: [row('password', 'lock-simple', true), row('twoFactor', 'shield-check', true), row('sessions', 'device-mobile', true)],
  },
  { key: 'privacy', rows: [row('privacy', 'eye-slash', true), row('blocked', 'prohibit', true), row('reports', 'flag', true)] },
  {
    key: 'app',
    rows: [row('notifications', 'bell', true), row('appearance', 'circle-half', false), row('language', 'translate', false)],
  },
  { key: 'data', rows: [row('export', 'download-simple', true), row('delete', 'trash', true)] },
  { key: 'help', rows: [row('help', 'question', false), row('contact', 'chat-circle', true)] },
  { key: 'legal', rows: [row('legal', 'scales', false)] },
];

/**
 * DQ-434: whether a group prints its label. "Konto" holds the single row "Konto", so its label would only repeat the row; the
 * first group stands without one, as iOS Settings starts with the account card.
 */
export function groupHasTitle(key: SettingsGroupKey): boolean {
  return key !== 'account';
}

/** The rows of SET-01 with a subtitle (its key in `settings`), which makes them the 72 row; all others are 56 (§8 list row). */
export const ROW_SUBTITLES: Readonly<Partial<Record<SettingsKey, string>>> = { legal: 'rows.legalHint' };

/** The groups a visitor sees: a guest gets only rows that work without an account. */
export function visibleGroups(member: boolean): readonly SettingsGroupDef[] {
  return SETTINGS_GROUPS.map((group) => ({ ...group, rows: group.rows.filter((entry) => member || !entry.member) })).filter(
    (group) => group.rows.length > 0,
  );
}

/** Which row a settings path belongs to, for the selection in the side pane: the longest matching path wins. */
export function settingsKeyOf(pathname: string): SettingsKey | null {
  let best: SettingsKey | null = null;
  let bestLength = 0;
  for (const [key, path] of Object.entries(SETTINGS_PATHS) as [SettingsKey, string][]) {
    if ((pathname === path || pathname.startsWith(`${path}/`)) && path.length > bestLength) {
      best = key;
      bestLength = path.length;
    }
  }
  return best;
}
