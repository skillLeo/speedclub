// Code review M3.3-app MF-A: a draft preview tab (ADM-34, `/app/?preview=<token>`) shares the browser's storage with normal tabs, so it
// must neither restore nor write the query cache, and must keep announcement dismissals in memory: otherwise an unpublished draft
// (home curation, announcements) shows as live in the next normal tab, and a draft dismissed in the preview stays hidden after publish.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { setPreviewTokenForTests } from '@/api/preview';
import { persistOptions, removePersistedCache } from '@/api/queryClient';
import {
  DISMISSALS_STORAGE_KEY,
  dismissAnnouncement,
  hydrateDismissals,
  resetDismissalsForTests,
  useDismissalStore,
} from '@/features/announcements/dismissals';
import { setGuest, useSessionStore } from '@/state/session';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const KEY = 'sc.queryCache';
const clientState = { mutations: [], queries: [] };
const TOKEN = 'eyJkcmFmdCI6dHJ1ZX0AAAA.c2lnbmF0dXJlc2lnbmF0dXJl';

async function storedGuestCache() {
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({ buster: persistOptions.buster, timestamp: Date.now(), clientState, owner: null }),
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useSessionStore.setState({ status: 'loading', member: null, expiredFrom: null });
  resetDismissalsForTests();
  setPreviewTokenForTests(TOKEN);
});

afterEach(() => setPreviewTokenForTests(null));

describe('a draft preview tab', () => {
  it('does not restore the stored cache of this browser', async () => {
    await storedGuestCache();
    setGuest();
    await expect(persistOptions.persister.restoreClient()).resolves.toBeUndefined();
    // …and leaves it in place for the normal tabs.
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull();
  });

  it('never writes the query cache', async () => {
    setGuest();
    await persistOptions.persister.persistClient({
      buster: persistOptions.buster ?? '',
      timestamp: Date.now(),
      clientState,
    });
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('never removes the stored cache of the normal tabs', async () => {
    await storedGuestCache();
    await removePersistedCache();
    await persistOptions.persister.removeClient();
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull();
  });

  it('keeps announcement dismissals in memory only, and ignores the stored ones', async () => {
    await AsyncStorage.setItem(DISMISSALS_STORAGE_KEY, JSON.stringify(['published-earlier']));
    await hydrateDismissals();
    expect(useDismissalStore.getState().ids).toEqual([]);

    dismissAnnouncement('draft-announcement');
    expect(useDismissalStore.getState().ids).toEqual(['draft-announcement']);
    expect(JSON.parse((await AsyncStorage.getItem(DISMISSALS_STORAGE_KEY)) ?? '[]')).toEqual([
      'published-earlier',
    ]);
  });
});

describe('a normal tab (no preview token)', () => {
  beforeEach(() => setPreviewTokenForTests(null));

  it('still writes the cache and the dismissals', async () => {
    setGuest();
    await persistOptions.persister.persistClient({
      buster: persistOptions.buster ?? '',
      timestamp: Date.now(),
      clientState,
    });
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull();

    await hydrateDismissals();
    dismissAnnouncement('live-announcement');
    expect(JSON.parse((await AsyncStorage.getItem(DISMISSALS_STORAGE_KEY)) ?? '[]')).toEqual([
      'live-announcement',
    ]);
  });
});
