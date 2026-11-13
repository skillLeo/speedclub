/**
 * SET-26 settings search (09 §7.9): a static index of every setting, its page and the words people use for it, in the language
 * shown. Pure: SET-01 hands it the translations and the visitor (member, web, flags) and gets the matches in order. A result is
 * visible exactly when its page is (navigation.ts), so the search never leads to a row SET-01 hides.
 */
import { SETTINGS_GROUPS, SETTINGS_PATHS, type SettingsFlags, type SettingsKey, type SettingsRowDef } from './navigation';

export type SearchEntry = {
  /** `search.items.<id>` holds the title of a sub-setting; a page entry uses its row title `rows.<key>`. */
  id: string;
  /** The page whose visibility the entry follows. */
  key: SettingsKey;
  path: string;
  /** A sub-setting (a switch or a group inside a page): its title comes from `search.items.<id>`. */
  item?: boolean;
};

/** Visibility of SET-22, which is no row of SET-01 (it lives on SET-10). */
const APP_ICON_ROW: SettingsRowDef = { key: 'appIcon', path: SETTINGS_PATHS.appIcon, icon: 'circle-half', member: false, native: true, flag: 'app_icons' };

const page = (key: SettingsKey): SearchEntry => ({ id: key, key, path: SETTINGS_PATHS[key] });
const item = (id: string, key: SettingsKey, path: string = SETTINGS_PATHS[key]): SearchEntry => ({ id, key, path, item: true });

/** Every page of the settings, then the settings inside them that people look for by name. */
export const SEARCH_INDEX: readonly SearchEntry[] = [
  page('account'),
  item('email', 'account', '/settings/account/email'),
  item('username', 'account'),
  page('signIn'),
  item('passkeys', 'signIn'),
  page('appLock'),
  page('sessions'),
  page('activity'),
  page('twoFactor'),
  page('password'),
  page('privacy'),
  item('whoCanMessage', 'privacy'),
  item('mentions', 'privacy'),
  item('readReceipts', 'privacy'),
  item('searchEngines', 'privacy'),
  page('blocked'),
  page('notifications'),
  item('quietHours', 'notifications'),
  item('messagePreviews', 'notifications'),
  page('appearance'),
  item('haptics', 'appearance'),
  item('reduceMotion', 'appearance'),
  page('appIcon'),
  page('language'),
  item('units', 'language'),
  page('reminders'),
  page('business'),
  page('membership'),
  page('export'),
  page('delete'),
  page('help'),
  page('contact'),
  page('reports'),
  page('legal'),
  page('whatsNew'),
];

/** Lower case, without diacritics, ß as ss: "Größe" finds "groesse" and "grosse", "Erwähnungen" finds "erwahn". */
export function normaliseSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9@]+/g, ' ')
    .trim();
}

/** Both spellings of an umlaut, so "erwahnung" and "erwaehnung" find the same entry. */
function variants(text: string): string {
  const plain = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9@]+/g, ' ')
    .trim();
  return `${normaliseSearch(text)} ${plain}`;
}

function rowOf(key: SettingsKey): SettingsRowDef | undefined {
  if (key === 'appIcon') return APP_ICON_ROW;
  for (const group of SETTINGS_GROUPS) {
    const found = group.rows.find((entry) => entry.key === key);
    if (found) return found;
  }
  return undefined;
}

export type SearchVisitor = { member: boolean; web: boolean; flags: SettingsFlags };

export function entryVisible(entry: SearchEntry, { member, web, flags }: SearchVisitor): boolean {
  const def = rowOf(entry.key);
  if (!def) return false;
  return (member || !def.member) && !(web && def.native) && (def.flag === undefined || flags[def.flag] === true);
}

/** A translation of the `settings` namespace. */
type Translate = (key: string) => string;

export type SearchResult = {
  id: string;
  title: string;
  /** The page it is on, for a sub-setting; the section for a page. */
  detail: string;
  path: string;
};

/** The section a page sits in, as SET-01 names it. */
const SECTION_OF: Readonly<Partial<Record<SettingsKey, string>>> = {
  account: 'search.sections.account',
  signIn: 'groups.security',
  appLock: 'groups.security',
  sessions: 'groups.security',
  activity: 'groups.security',
  twoFactor: 'groups.security',
  password: 'groups.security',
  privacy: 'groups.privacy',
  blocked: 'groups.privacy',
  appIcon: 'rows.appearance',
  export: 'groups.data',
  delete: 'groups.data',
  help: 'groups.help',
  contact: 'groups.help',
  reports: 'groups.help',
  legal: 'groups.legal',
  whatsNew: 'groups.about',
};

/**
 * The matches for a query, best first: every word of the query must start a word of the title, the synonyms or the section.
 * A title that starts with the query ranks above a title that contains it, which ranks above a synonym match. Empty query: none.
 */
export function searchSettings(query: string, t: Translate, visitor: SearchVisitor, limit = 12): SearchResult[] {
  const words = normaliseSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const scored: { result: SearchResult; score: number; order: number }[] = [];
  SEARCH_INDEX.forEach((entry, order) => {
    if (!entryVisible(entry, visitor)) return;
    const title = t(entry.item ? `search.items.${entry.id}` : `rows.${entry.key}`);
    const detailKey = entry.item ? `rows.${entry.key}` : (SECTION_OF[entry.key] ?? 'title');
    const detail = t(detailKey);
    const synonyms = t(`search.synonyms.${entry.id}`);
    const titleWords = variants(title).split(' ');
    const allWords = variants(`${title} ${synonyms} ${detail}`).split(' ');
    if (!words.every((word) => allWords.some((candidate) => candidate.startsWith(word)))) return;
    const inTitle = words.every((word) => titleWords.some((candidate) => candidate.startsWith(word)));
    const titleStarts = variants(title).startsWith(words[0] ?? '');
    const score = (titleStarts ? 0 : inTitle ? 1 : 2) + (entry.item ? 0.5 : 0);
    scored.push({ result: { id: entry.id, title, detail, path: entry.path }, score, order });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map(({ result }) => result);
}

/** SET-26: the `?q=` of the address on the web (a deep link into the search, the phone page and the desktop pane alike); native starts empty. */
export function initialSearchQuery(): string {
  if (typeof window === 'undefined' || typeof window.location?.search !== 'string') return '';
  try {
    return new URLSearchParams(window.location.search).get('q') ?? '';
  } catch {
    return '';
  }
}
