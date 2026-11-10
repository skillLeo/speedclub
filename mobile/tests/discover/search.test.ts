import AsyncStorage from '@react-native-async-storage/async-storage';

import { countLabel, mergeResults, normalizeQuery, SEARCH_MAX_LENGTH } from '@/api/queries/search';
import { searchPath } from '@/features/discover/navigation';
import {
  addTerm,
  clearRecentSearches,
  GUEST_OWNER,
  loadRecentSearches,
  mayShow,
  mergeTerms,
  parseStored,
  parseTerms,
  RECENT_SEARCHES_KEY,
  RECENT_SEARCHES_MAX,
  rememberSearch,
  resetRecentSearchesForTests,
  useRecentSearchStore,
} from '@/features/discover/recentSearches';
import { setGuest, setMember, useSessionStore } from '@/state/session';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

describe('the query', () => {
  it('is trimmed, runs of space become one, and it stops at the 100 characters the API takes', () => {
    expect(normalizeQuery('  bmw   e46 ')).toBe('bmw e46');
    expect(normalizeQuery(undefined)).toBe('');
    expect(normalizeQuery('a'.repeat(140))).toHaveLength(SEARCH_MAX_LENGTH);
    expect(normalizeQuery(`${'a'.repeat(99)} b`)).toBe('a'.repeat(99));
  });

  it('goes into the URL of DISC-02', () => {
    expect(searchPath(' GT-R ')).toEqual({ pathname: '/discover/search', params: { q: 'GT-R' } });
    expect(searchPath('   ')).toBe('/discover/search');
  });

  it('shows the tab count as the server counted it, "1000+" when it stopped counting', () => {
    const format = (value: number) => value.toLocaleString('de-DE');
    expect(countLabel(124, false, format)).toBe('124');
    expect(countLabel(1000, true, format)).toBe('1.000+');
  });

  it('continues the first items with the loaded pages, each item once', () => {
    const merged = mergeResults(['a', 'b'], [{ data: ['b', 'c'] }, { data: ['d'] }], (item) => item);
    expect(merged).toEqual(['a', 'b', 'c', 'd']);
    expect(mergeResults(['a'], undefined, (item) => item)).toEqual(['a']);
  });
});

const settle = async () => {
  await loadRecentSearches();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const stored = async () => parseStored(await AsyncStorage.getItem(RECENT_SEARCHES_KEY));
const MEMBER_A = { id: 'member-a', username: 'lukas.sc', displayName: null, avatarUrl: null };
const MEMBER_B = { id: 'member-b', username: 'kenji.r34', displayName: null, avatarUrl: null };

describe('recent searches (on the device only, §3.7)', () => {
  beforeEach(async () => {
    setGuest();
    resetRecentSearchesForTests();
    await AsyncStorage.clear();
  });

  it('keeps the newest first, each term once whatever its case, at most eight', () => {
    let terms: string[] = [];
    for (const term of ['m4', 'R34', 'e46', 'r34']) terms = addTerm(terms, term);
    expect(terms).toEqual(['r34', 'e46', 'm4']);
    for (let index = 0; index < 12; index++) terms = addTerm(terms, `golf ${index}`);
    expect(terms).toHaveLength(RECENT_SEARCHES_MAX);
    expect(addTerm(['m4'], '   ')).toEqual(['m4']);
  });

  it('reads anything that is not a list of strings as an empty list', () => {
    expect(parseTerms(null)).toEqual([]);
    expect(parseTerms('{"a":1}')).toEqual([]);
    expect(parseTerms('not json')).toEqual([]);
    expect(parseTerms('["m4", 3, "  e46 "]')).toEqual(['m4', 'e46']);
    expect(mergeTerms(['M4'], ['m4', 'e46'])).toEqual(['M4', 'e46']);
  });

  it('stores the list on the device and clears it with "Löschen"', async () => {
    rememberSearch('gtr');
    rememberSearch('e46');
    await settle();
    expect(await stored()).toEqual({ owner: GUEST_OWNER, terms: ['e46', 'gtr'] });
    clearRecentSearches();
    await settle();
    expect(await AsyncStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
    expect(useRecentSearchStore.getState().terms).toEqual([]);
  });

  it('keeps a term remembered before the stored list was read in front', async () => {
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify({ owner: GUEST_OWNER, terms: ['m4', 'e46'] }));
    rememberSearch('E46');
    await settle();
    expect(await stored()).toEqual({ owner: GUEST_OWNER, terms: ['E46', 'm4'] });
    expect(useRecentSearchStore.getState().terms).toEqual(['E46', 'm4']);
  });

  it('reads the owner with the list; a list without one is nobody’s', () => {
    expect(parseStored(JSON.stringify({ owner: 'member-a', terms: ['m4', 3] }))).toEqual({ owner: 'member-a', terms: ['m4'] });
    expect(parseStored(JSON.stringify(['m4']))).toEqual({ owner: null, terms: [] });
    expect(parseStored('not json')).toEqual({ owner: null, terms: [] });
    expect(mayShow('member-a', 'member-a')).toBe(true);
    expect(mayShow(GUEST_OWNER, 'member-a')).toBe(true);
    expect(mayShow('member-a', GUEST_OWNER)).toBe(false);
    expect(mayShow('member-a', 'member-b')).toBe(false);
    expect(mayShow(null, GUEST_OWNER)).toBe(false);
  });

  it('forgets a member’s searches on sign-out, on the screen and on the device', async () => {
    setMember(MEMBER_A);
    rememberSearch('r34');
    await settle();
    expect(await stored()).toEqual({ owner: 'member-a', terms: ['r34'] });

    setGuest();
    await settle();
    expect(useRecentSearchStore.getState().terms).toEqual([]);
    expect(await AsyncStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });

  it('forgets them when another account signs in, too', async () => {
    setMember(MEMBER_A);
    rememberSearch('r34');
    await settle();
    setMember(MEMBER_B);
    await settle();
    expect(useRecentSearchStore.getState().terms).toEqual([]);
    expect(await AsyncStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });

  it('never shows another member’s stored list after a restart, and deletes it', async () => {
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify({ owner: 'member-a', terms: ['r34'] }));
    await settle();
    expect(useRecentSearchStore.getState().terms).toEqual([]);
    expect(await AsyncStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });

  it('shows the own stored list after a restart, and waits for the session restore to know whose it is', async () => {
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify({ owner: 'member-a', terms: ['r34'] }));
    useSessionStore.setState({ status: 'loading', member: null });
    resetRecentSearchesForTests();
    const read = loadRecentSearches();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useRecentSearchStore.getState().loaded).toBe(false);
    setMember(MEMBER_A);
    await read;
    expect(useRecentSearchStore.getState().terms).toEqual(['r34']);
  });

  it('keeps a guest’s searches when that guest signs in, from then on as the member’s', async () => {
    rememberSearch('e46');
    await settle();
    setMember(MEMBER_A);
    await settle();
    expect(useRecentSearchStore.getState().terms).toEqual(['e46']);
    expect(await stored()).toEqual({ owner: 'member-a', terms: ['e46'] });
  });
});
