/**
 * SET-01 (09 §7.9, M4.10): the groups of the settings and their rows, in order. One map for the list on a phone, the 280 side pane
 * on desktop, the settings search and the ⌘K switcher, so they can never disagree. Rows a guest cannot use are left out for guests,
 * native-only rows on the web, flagged rows while their flag is off: never shown dead (09 §7.15).
 */
import { isWeb } from '@/lib/platform';
import type { IconName } from '@/ui';

export type SettingsKey =
  /** SET-02 Konto: the identity card at the top of the list. */
  | 'account'
  /** SET-19 Anmeldung & Passkeys (M4.6). */
  | 'signIn'
  /** SET-20 App-Sperre (M4.7), native only. */
  | 'appLock'
  /** SET-21 Sicherheitsaktivität (M4.7). */
  | 'activity'
  | 'password'
  | 'twoFactor'
  | 'sessions'
  | 'privacy'
  | 'blocked'
  | 'reports'
  | 'notifications'
  | 'appearance'
  /** SET-22 App-Icon, native only, flag `app_icons`: reached from SET-10 and the search, not listed in SET-01. */
  | 'appIcon'
  | 'language'
  /** SET-23 Garage & Erinnerungen (= MNT-03), flag `maintenance`. */
  | 'reminders'
  /** BIZ-02/03 Für Betriebe, flag `businesses` (M4.14). */
  | 'business'
  /** SET-24 Mitgliedschaft, flag `membership` (M4.15). */
  | 'membership'
  | 'export'
  | 'delete'
  | 'help'
  | 'contact'
  | 'legal'
  /** SET-25 Was ist neu. */
  | 'whatsNew';

export type SettingsGroupKey =
  | 'account'
  | 'security'
  | 'privacy'
  | 'app'
  | 'more'
  | 'data'
  | 'help'
  | 'legal'
  | 'about';

export type SettingsRowDef = {
  key: SettingsKey;
  path: string;
  icon: IconName;
  /** Needs a signed-in member. */
  member: boolean;
  /** Native only (09 §7.15: platform-only items are hidden on the web, never shown disabled). */
  native?: boolean;
  /** Shown only while this app-config flag is on. */
  flag?: string;
};

export type SettingsGroupDef = { key: SettingsGroupKey; rows: readonly SettingsRowDef[] };

/** The flags SET-01 reads: a map of the ones that are on. */
export type SettingsFlags = Readonly<Partial<Record<string, boolean>>>;

export const SETTINGS_PATHS: Readonly<Record<SettingsKey, string>> = {
  account: '/settings/account',
  signIn: '/settings/security/sign-in',
  appLock: '/settings/security/app-lock',
  activity: '/settings/security/activity',
  password: '/settings/security/password',
  twoFactor: '/settings/security/two-factor',
  sessions: '/settings/security/sessions',
  privacy: '/settings/privacy',
  blocked: '/settings/privacy/blocked',
  reports: '/settings/reports',
  notifications: '/settings/notifications',
  appearance: '/settings/appearance',
  appIcon: '/settings/appearance/icon',
  language: '/settings/language',
  reminders: '/settings/reminders',
  business: '/settings/business/apply',
  membership: '/settings/membership',
  export: '/settings/data/export',
  delete: '/settings/data/delete',
  help: '/settings/help',
  contact: '/settings/help/contact',
  legal: '/settings/legal',
  whatsNew: '/settings/about/whats-new',
};

/** The flags of the rows above, so the screens know which ones to ask app-config for. */
export const SETTINGS_ROW_FLAGS = ['maintenance', 'businesses', 'membership', 'app_icons'] as const;

const row = (key: SettingsKey, icon: IconName, member: boolean, extra: Pick<SettingsRowDef, 'native' | 'flag'> = {}): SettingsRowDef => ({
  key,
  path: SETTINGS_PATHS[key],
  icon,
  member,
  ...extra,
});

/**
 * 09 §7.9 in Apple order: the identity card (SET-02) · Konto & Sicherheit · Privatsphäre · Benachrichtigungen, Darstellung,
 * Sprache & Einheiten, Garage & Erinnerungen · Für Betriebe, Mitgliedschaft · Daten & Speicher · Hilfe & Support · Rechtliches ·
 * Über SPEED CLUB. "Cache leeren", the version line and "Abmelden" follow in the list itself (they are actions, not pages).
 */
export const SETTINGS_GROUPS: readonly SettingsGroupDef[] = [
  { key: 'account', rows: [row('account', 'user', true)] },
  {
    key: 'security',
    // 09 §7.9 order: Anmeldung & Passkeys · App-Sperre · Geräte & Sitzungen · Sicherheitsaktivität · Zwei-Faktor · Passwort.
    rows: [
      row('signIn', 'key', true),
      row('appLock', 'lock-key', true, { native: true }),
      row('sessions', 'device-mobile', true),
      row('activity', 'clock', true),
      row('twoFactor', 'shield-check', true),
      row('password', 'lock-simple', true),
    ],
  },
  { key: 'privacy', rows: [row('privacy', 'eye-slash', true), row('blocked', 'prohibit', true)] },
  {
    key: 'app',
    rows: [
      row('notifications', 'bell', true),
      row('appearance', 'circle-half', false),
      row('language', 'translate', false),
      row('reminders', 'calendar-blank', true, { flag: 'maintenance' }),
    ],
  },
  {
    key: 'more',
    rows: [row('business', 'workshop', true, { flag: 'businesses' }), row('membership', 'star', true, { flag: 'membership' })],
  },
  { key: 'data', rows: [row('export', 'download-simple', true), row('delete', 'trash', true)] },
  { key: 'help', rows: [row('help', 'question', false), row('contact', 'chat-circle', true), row('reports', 'flag', true)] },
  { key: 'legal', rows: [row('legal', 'scales', false)] },
  { key: 'about', rows: [row('whatsNew', 'megaphone-simple', false)] },
];

/**
 * DQ-434: whether a group prints its label. The identity card stands without one, as iOS Settings starts with the account card;
 * the flagged pair is a plain cluster whose rows name themselves. DQ-1103: the app settings carry "App" like every other group.
 */
export function groupHasTitle(key: SettingsGroupKey): boolean {
  return key !== 'account' && key !== 'more';
}

/** The rows of SET-01 with a subtitle (its key in `settings`), which makes them the 72 row; all others are 56 (§8 list row). */
export const ROW_SUBTITLES: Readonly<Partial<Record<SettingsKey, string>>> = { legal: 'rows.legalHint' };

/**
 * The groups a visitor sees: a guest gets only rows that work without an account; the web no native-only rows; a flagged row only
 * while its flag is on. SET-22 App-Icon is never a row of SET-01 (it lives on SET-10), so it is not in the map at all.
 */
export function visibleGroups(member: boolean, web: boolean = isWeb, flags: SettingsFlags = {}): readonly SettingsGroupDef[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter(
      (entry) => (member || !entry.member) && !(web && entry.native) && (entry.flag === undefined || flags[entry.flag] === true),
    ),
  })).filter((group) => group.rows.length > 0);
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
  // SET-22 lives on SET-10: the pane keeps Darstellung selected.
  return best === 'appIcon' ? 'appearance' : best;
}
