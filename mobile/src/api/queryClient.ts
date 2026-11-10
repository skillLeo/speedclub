/**
 * The TanStack Query client with AsyncStorage persistence for offline reads (05_ARCHITECTURE.md §16).
 * A query opts out with `meta: { persist: false }`. Logout must call clearQueryCache().
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import type {
  PersistedClient,
  Persister,
  PersistQueryClientOptions,
} from '@tanstack/react-query-persist-client';
import { AppState } from 'react-native';

import { isNative } from '@/lib/platform';
import { QUERY_CACHE_STORAGE_KEY } from '@/lib/storage';
import { useSessionStore, whenSessionSettled } from '@/state/session';

import appVersion from '../../version.json';

import { keepsNothingOnDisk } from './ephemeralTab';

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      // Must not be shorter than the persister's maxAge, or restored data is collected right away.
      gcTime: CACHE_MAX_AGE_MS,
      retry: 2,
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'offlineFirst' },
  },
});

/** Null: a guest. Missing: written by a build from before the stamp. */
type OwnedClient = PersistedClient & { owner?: string | null };

const storedCache = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: QUERY_CACHE_STORAGE_KEY,
  throttleTime: 1000,
});

/**
 * BH-28: the cache knows whose it is. One browser profile has one storage key, whichever member a tab shows, and a bare buster
 * is fixed at build time. So a restore waits until the start has decided who this is, and hands over only what that member, or
 * that guest, left behind. Anything else is dropped, on disk too. Nothing is written for a session that already ended and is
 * only held for its form (BH-30). A view-as tab (m3.2-contract §3) and a draft preview tab (ADM-34) neither restore nor write anything:
 * the member's data or a staff member's unpublished draft must not reach this browser's disk, nor replace the cache of whoever uses it.
 */
const ownedPersister: Persister = {
  persistClient: async (client) => {
    if (keepsNothingOnDisk()) return;
    const { member, expiredFrom } = useSessionStore.getState();
    if (expiredFrom !== null && !member) return;
    const owned: OwnedClient = { ...client, owner: member?.id ?? null };
    await storedCache.persistClient(owned);
  },
  restoreClient: async () => {
    await whenSessionSettled();
    if (keepsNothingOnDisk()) return undefined;
    const client: OwnedClient | undefined = await storedCache.restoreClient();
    if (!client) return undefined;
    if (client.owner === (useSessionStore.getState().member?.id ?? null)) return client;
    await storedCache.removeClient();
    return undefined;
  },
  // A view-as or preview tab leaves the stored cache of this browser alone.
  removeClient: async () => (keepsNothingOnDisk() ? undefined : storedCache.removeClient()),
};

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: ownedPersister,
  maxAge: CACHE_MAX_AGE_MS,
  // A new build can change response shapes, so it must never restore the cache of the previous build.
  buster: `${process.env.EXPO_PUBLIC_APP_ENV ?? 'local'}|${appVersion.versionName}+${appVersion.versionCode}`,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query) && query.meta?.persist !== false,
  },
};

export async function removePersistedCache(): Promise<void> {
  if (keepsNothingOnDisk()) return;
  await AsyncStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
}

export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  await removePersistedCache();
}

// Browsers report online and focus themselves; native needs NetInfo and AppState.
if (isNative) {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
  );
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (status) => setFocused(status === 'active'));
    return () => subscription.remove();
  });
}
