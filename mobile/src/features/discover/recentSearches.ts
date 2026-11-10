/**
 * Recent searches, on this device only (§3.7): never sent to the API, never part of the account. AsyncStorage is
 * localStorage on web. A missing or broken value reads as an empty list.
 *
 * The list belongs to whoever searched: the member's id, or the guest. A member's searches leave with the member (sign
 * out, account deletion, another account signing in), so the next person on a shared device never sees them; a guest's
 * come along when that guest signs in. The stored list carries its owner, so this holds even when the app was closed
 * before the change was seen here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { create } from 'zustand';

import { isViewAsTab } from '@/api/clientViewAs';
import { normalizeQuery } from '@/api/queries/search';
import { useSessionStore, type SessionMember, type SessionStatus } from '@/state/session';

export const RECENT_SEARCHES_KEY = 'sc.recentSearches';
/** Chips under the search field: one or two lines on a phone. */
export const RECENT_SEARCHES_MAX = 8;

/** The owner of a guest's searches. */
export const GUEST_OWNER = 'guest';

type RecentState = { terms: readonly string[]; loaded: boolean };
type Stored = { owner: string | null; terms: string[] };

export const useRecentSearchStore = create<RecentState>(() => ({ terms: [], loaded: false }));

/** Newest first, each term once whatever its case, at most eight. */
export function addTerm(terms: readonly string[], term: string): string[] {
  const value = normalizeQuery(term);
  if (!value) return [...terms];
  const key = value.toLocaleLowerCase();
  return [value, ...terms.filter((entry) => entry.toLocaleLowerCase() !== key)].slice(0, RECENT_SEARCHES_MAX);
}

function termsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => normalizeQuery(entry))
    .filter(Boolean)
    .slice(0, RECENT_SEARCHES_MAX);
}

/** A list of terms, or an empty list for anything that is not a list of strings. */
export function parseTerms(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return termsOf(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** What storage holds: `{ owner, terms }`. Anything else, an unowned list included, has no owner and is never shown. */
export function parseStored(raw: string | null): Stored {
  if (!raw) return { owner: null, terms: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { owner: null, terms: [] };
    const { owner, terms } = value as { owner?: unknown; terms?: unknown };
    return { owner: typeof owner === 'string' && owner ? owner : null, terms: termsOf(terms) };
  } catch {
    return { owner: null, terms: [] };
  }
}

/** Whose searches these are, or null while the session is still being restored. */
export function ownerOf(session: { status: SessionStatus; member: SessionMember | null }): string | null {
  if (session.status === 'loading') return null;
  return session.status === 'member' && session.member ? session.member.id : GUEST_OWNER;
}

/** Stored terms the current owner may see: their own, or a guest's on this device. */
export function mayShow(storedOwner: string | null, owner: string): boolean {
  return storedOwner !== null && (storedOwner === owner || storedOwner === GUEST_OWNER);
}

/** Resolves once the session restore has decided between member and guest. */
function sessionDecided(): Promise<void> {
  if (ownerOf(useSessionStore.getState()) !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useSessionStore.subscribe((state) => {
      if (ownerOf(state) === null) return;
      stop();
      resolve();
    });
  });
}

/** `first` in front, then what `later` adds, each term once, at most eight. */
export function mergeTerms(first: readonly string[], later: readonly string[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const term of [...first, ...later]) {
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(term);
  }
  return list.slice(0, RECENT_SEARCHES_MAX);
}

let loading: Promise<void> | null = null;

async function persist(terms: readonly string[]): Promise<void> {
  // View-as (m3.2-contract §3): the terms staff type stay in this tab's memory; this browser's stored list is left alone.
  if (isViewAsTab()) return;
  const owner = ownerOf(useSessionStore.getState()) ?? GUEST_OWNER;
  try {
    if (terms.length === 0) await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
    else await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify({ owner, terms }));
  } catch {
    // Storage blocked (a private window): the list lives until the app closes.
  }
}

/** Reads the list once per app start, after the session restore. Another member's list is deleted, never shown. */
export function loadRecentSearches(): Promise<void> {
  loading ??= (async () => {
    await sessionDecided();
    let raw: string | null = null;
    try {
      // A view-as tab never shows what this browser stored for somebody else.
      raw = isViewAsTab() ? null : await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
    } catch {
      raw = null;
    }
    const stored = parseStored(raw);
    const owner = ownerOf(useSessionStore.getState()) ?? GUEST_OWNER;
    const kept = mayShow(stored.owner, owner) ? stored.terms : [];
    if (raw !== null && kept.length === 0) await persist([]);
    // A term remembered before the read finished stays in front.
    useRecentSearchStore.setState({ terms: mergeTerms(useRecentSearchStore.getState().terms, kept), loaded: true });
  })();
  return loading;
}

let lastOwner: string | null = ownerOf(useSessionStore.getState());

/**
 * Follows the session: a guest who signs in keeps the list, now as the member's; when a member's session ends (sign out,
 * account deletion, an expired session) or another account takes over, the list goes, from the screen and from storage.
 */
export function followSessionOwner(owner: string | null): void {
  if (owner === null || owner === lastOwner) return;
  const previous = lastOwner;
  lastOwner = owner;
  // The restore has just decided: the first read sorts out the stored list.
  if (previous === null) return;
  if (previous === GUEST_OWNER) {
    const { terms } = useRecentSearchStore.getState();
    if (terms.length > 0) void persist(terms);
    return;
  }
  useRecentSearchStore.setState({ terms: [] });
  void persist([]);
}

useSessionStore.subscribe((state) => followSessionOwner(ownerOf(state)));

/**
 * Shows the term at once and writes only after the stored list was read, so an early search cannot overwrite the terms
 * of earlier sessions.
 */
export function rememberSearch(term: string): void {
  if (!normalizeQuery(term)) return;
  useRecentSearchStore.setState({ terms: addTerm(useRecentSearchStore.getState().terms, term) });
  void loadRecentSearches().then(() => {
    const terms = addTerm(useRecentSearchStore.getState().terms, term);
    useRecentSearchStore.setState({ terms });
    return persist(terms);
  });
}

/** "Löschen": also after a read that was still running, which would otherwise bring the stored terms back. */
export function clearRecentSearches(): void {
  useRecentSearchStore.setState({ terms: [] });
  void loadRecentSearches().then(() => {
    useRecentSearchStore.setState({ terms: [] });
    return persist([]);
  });
}

/** For tests: forget what was read, and take the current session as the owner. */
export function resetRecentSearchesForTests(): void {
  loading = null;
  lastOwner = ownerOf(useSessionStore.getState());
  useRecentSearchStore.setState({ terms: [], loaded: false });
}

/** The list, read from storage on first use. */
export function useRecentSearches(): readonly string[] {
  useEffect(() => {
    void loadRecentSearches();
  }, []);
  return useRecentSearchStore((state) => state.terms);
}
