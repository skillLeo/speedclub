/**
 * M2.1 social graph (docs/reports/phase-2/m2.1-contract.md): member profiles (PROF-02), follower lists (PROF-04), follow and
 * unfollow, removing a follower, blocks (SET-08 and the block dialog) and saved builds (PROF-05, `sig.saved_builds`).
 *
 * Public reads render per viewer (follow state, blocks, language), so the viewer is part of every key, as for vehicles. A member
 * the viewer may not see answers one 404 (`member_unavailable`, or `not_found` from older servers): the screens show one calm
 * state and no reason, so a block is never revealed.
 *
 * Follow, unfollow, save and unsave are optimistic: the button changes at once, goes back when the call fails, and a toast says
 * why. A block is not: it waits for the server inside its dialog, then drops every list that could still show that member.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient, type QueryKey } from '@tanstack/react-query';

import { api, apiData, ApiError, viewAsRefusedError } from '@/api/client';
import { isViewAsTab } from '@/api/clientViewAs';
import { meKey } from '@/api/queries/auth';
import { discoverKeys } from '@/api/queries/discover';
import { homeKeys } from '@/api/queries/home';
import { searchKeys } from '@/api/queries/search';
import { publicViewerNow, retryUnlessAnswered, usePublicViewer, type PublicVehicle } from '@/api/queries/vehicles';
import { useSessionStore } from '@/state/session';

/**
 * View-as (m3.2-contract §3): a follow, save or block would be a write in the member's name. Refused before the optimistic change,
 * so nothing flips on screen and back; the error carries the reason (`auth:viewAs.readOnly`).
 */
function refuseInViewAs(): void {
  if (isViewAsTab()) throw viewAsRefusedError('view_as_read_only');
}

/** Rows per page of a follower list; the API allows 1 to 50. */
export const CONNECTIONS_PAGE_SIZE = 30;
/** The API's limit for `q` on a follower list. */
export const CONNECTIONS_QUERY_MAX = 64;
/** Rows per page of the blocked and saved lists. */
export const LIST_PAGE_SIZE = 30;

export type ConnectionsTab = 'followers' | 'following';

/** Usernames are unique without regard to case (§3.1): one member, one key. */
export function memberIdOf(username: string): string {
  return username.trim().toLowerCase();
}

export const memberKeys = {
  all: ['member'] as const,
  /** Everything of one member, for every viewer: drop this after a block. */
  of: (username: string) => ['member', memberIdOf(username)] as const,
  profile: (username: string, viewer: string) => ['member', memberIdOf(username), viewer, 'profile'] as const,
  vehicles: (username: string, viewer: string) => ['member', memberIdOf(username), viewer, 'vehicles'] as const,
  connections: (username: string, viewer: string, tab: ConnectionsTab, q: string) =>
    ['member', memberIdOf(username), viewer, 'connections', tab, q] as const,
};

export const savedKey = ['me', 'saved'] as const;
export const blocksKey = ['me', 'blocks'] as const;

// -- Reads

async function fetchMemberProfile(username: string, signal: AbortSignal) {
  return (await apiData(api.GET('/public/users/{username}', { params: { path: { username } }, signal }))).data;
}

async function fetchMemberVehicles(username: string, signal: AbortSignal) {
  return (await apiData(api.GET('/public/users/{username}/vehicles', { params: { path: { username } }, signal }))).data;
}

async function fetchConnections(username: string, tab: ConnectionsTab, q: string, cursor: string | null, signal: AbortSignal) {
  const query = { per_page: CONNECTIONS_PAGE_SIZE, ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) };
  const options = { params: { path: { username }, query }, signal };
  return tab === 'followers'
    ? apiData(api.GET('/public/users/{username}/followers', options))
    : apiData(api.GET('/public/users/{username}/following', options));
}

async function fetchBlocks(cursor: string | null, signal: AbortSignal) {
  return apiData(api.GET('/me/blocks', { params: { query: { per_page: LIST_PAGE_SIZE, ...(cursor ? { cursor } : {}) } }, signal }));
}

async function fetchSaved(cursor: string | null, signal: AbortSignal) {
  return apiData(api.GET('/me/saved', { params: { query: { per_page: LIST_PAGE_SIZE, ...(cursor ? { cursor } : {}) } }, signal }));
}

export type MemberProfile = Awaited<ReturnType<typeof fetchMemberProfile>>;
export type MemberVehicle = Awaited<ReturnType<typeof fetchMemberVehicles>>[number];
export type ConnectionsPage = Awaited<ReturnType<typeof fetchConnections>>;
export type Connection = ConnectionsPage['data'][number];
export type BlocksPage = Awaited<ReturnType<typeof fetchBlocks>>;
export type BlockedMember = BlocksPage['data'][number];
export type SavedPage = Awaited<ReturnType<typeof fetchSaved>>;
export type SavedBuild = SavedPage['data'][number];

/** The member is hidden for this viewer, for whatever reason, or nobody has the name (contract §1). */
export function isMemberUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * PROF-02. Kept for offline reads like every query. `viewer.can_message` (and follow, block) can change from the other side at any
 * time, so a cached profile is shown at once but is always read again when the screen opens or the app comes back (staleTime 0):
 * a stale copy kept "Nachricht" enabled for a member who had turned messages off.
 */
export function useMemberProfile(username: string | undefined) {
  const viewer = usePublicViewer();
  const value = username ?? '';
  return useQuery({
    queryKey: memberKeys.profile(value, viewer),
    queryFn: ({ signal }) => fetchMemberProfile(value, signal),
    enabled: value !== '',
    retry: retryUnlessAnswered,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
}

/**
 * The profile as the viewer signed in now sees it, fresh when the cache is stale: for a follow a guest asked for, which runs after
 * sign-in and must not act on the guest's copy (following yourself would only fail).
 */
export function readMemberProfileNow(client: QueryClient, username: string): Promise<MemberProfile> {
  return client.fetchQuery({
    queryKey: memberKeys.profile(username, publicViewerNow()),
    queryFn: ({ signal }) => fetchMemberProfile(username, signal),
  });
}

/** The garage strip of PROF-02: public vehicles only, main vehicle first. One page holds a garage (at most 20). */
export function useMemberVehicles(username: string | undefined, enabled: boolean = true) {
  const viewer = usePublicViewer();
  const value = username ?? '';
  return useQuery({
    queryKey: memberKeys.vehicles(value, viewer),
    queryFn: ({ signal }) => fetchMemberVehicles(value, signal),
    enabled: enabled && value !== '',
    retry: retryUnlessAnswered,
  });
}

/**
 * PROF-04, newest follow first. Only the unfiltered first page is kept for an offline start: every search typed would grow
 * the stored cache.
 */
export function useConnections(username: string | undefined, tab: ConnectionsTab, q: string) {
  const viewer = usePublicViewer();
  const value = username ?? '';
  return useInfiniteQuery({
    queryKey: memberKeys.connections(value, viewer, tab, q),
    queryFn: ({ pageParam, signal }) => fetchConnections(value, tab, q, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: value !== '',
    retry: retryUnlessAnswered,
    meta: { persist: q === '' },
  });
}

/** SET-08, newest block first. */
export function useBlockedMembers() {
  const signedIn = useSessionStore((state) => state.status === 'member');
  return useInfiniteQuery({
    queryKey: blocksKey,
    queryFn: ({ pageParam, signal }) => fetchBlocks(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: signedIn,
    retry: retryUnlessAnswered,
    // SEC-P2-12: who the member blocked stays off the disk.
    meta: { persist: false },
  });
}

/** PROF-05, newest save first. Only while the flag is on: the routes answer 404 `feature_disabled` otherwise. */
export function useSavedBuilds(enabled: boolean) {
  const signedIn = useSessionStore((state) => state.status === 'member');
  return useInfiniteQuery({
    queryKey: savedKey,
    queryFn: ({ pageParam, signal }) => fetchSaved(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: enabled && signedIn,
    retry: retryUnlessAnswered,
  });
}

// -- Cache edits shared by the writes

type Snapshot = readonly (readonly [QueryKey, unknown])[];

function restore(client: QueryClient, snapshot: Snapshot | undefined): void {
  snapshot?.forEach(([key, data]) => client.setQueryData(key, data));
}

const isProfileKey = (key: QueryKey, username?: string) =>
  key[0] === 'member' && key[3] === 'profile' && (username === undefined || key[1] === memberIdOf(username));
const isConnectionsKey = (key: QueryKey, username?: string, tab?: ConnectionsTab) =>
  key[0] === 'member' &&
  key[3] === 'connections' &&
  (username === undefined || key[1] === memberIdOf(username)) &&
  (tab === undefined || key[4] === tab);
const isVehiclePageKey = (key: QueryKey) => key[0] === 'public-vehicle' && key[3] === 'page';

/** Edits every cached query the predicate picks, and returns what was there before, for a rollback. */
function edit<T>(client: QueryClient, predicate: (key: QueryKey) => boolean, change: (data: T) => T): Snapshot {
  const before = client.getQueriesData<T>({ predicate: (query) => predicate(query.queryKey) });
  before.forEach(([key, data]) => {
    if (data !== undefined) client.setQueryData<T>(key, change(data));
  });
  return before;
}

function mapRows<R>(data: InfiniteData<{ data: R[] }>, change: (row: R) => R | null): InfiniteData<{ data: R[] }> {
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, data: page.data.flatMap((row) => change(row) ?? []) })),
  };
}

/** A hidden count (null: a sample member, 09 §8.19) stays hidden; a shown count never drops below 0. */
function bump(count: number | null, by: number): number | null {
  return count === null ? null : Math.max(0, count + by);
}

function sameName(a: string | null | undefined, b: string): boolean {
  return a !== null && a !== undefined && memberIdOf(a) === memberIdOf(b);
}

/**
 * A failure the screen reports, from the mutation itself: a per-call callback of `mutate` is dropped once its component unmounts,
 * and an optimistic removal unmounts the very row that asked.
 */
export type WriteOptions = { onFailed?: (error: Error) => void };

// -- Follow

export type FollowInput = { username: string; follow: boolean };

/**
 * Follow or unfollow `username` (FS-8, PROF-04, VEH-01's owner row). One call after the other per member, so a quick double tap
 * reaches the server in the order it was made. Moves the profile's count, the rows of every follower list and the owner rows of
 * cached vehicle pages; the server's count replaces the guess when it answers.
 */
export function useFollow(username: string) {
  const client = useQueryClient();
  const own = useSessionStore((state) => state.member?.username ?? '');
  return useMutation({
    scope: { id: `follow:${memberIdOf(username)}` },
    mutationFn: async ({ username: name, follow }: FollowInput) => {
      const options = { params: { path: { username: name } } };
      return (await apiData(follow ? api.POST('/users/{username}/follow', options) : api.DELETE('/users/{username}/follow', options))).data;
    },
    onMutate: async ({ username: name, follow }) => {
      refuseInViewAs();
      // A read under way would land after the edit and put the old state back.
      await client.cancelQueries({
        predicate: (query) => isProfileKey(query.queryKey, name) || isConnectionsKey(query.queryKey) || isVehiclePageKey(query.queryKey),
      });
      const profiles = edit<MemberProfile>(client, (key) => isProfileKey(key, name), (profile) =>
        profile.is_following === follow
          ? profile
          : { ...profile, is_following: follow, stats: { ...profile.stats, followers: bump(profile.stats.followers, follow ? 1 : -1) } },
      );
      const rows = edit<InfiniteData<ConnectionsPage>>(client, (key) => isConnectionsKey(key), (data) =>
        mapRows(data, (row: Connection) => (sameName(row.username, name) ? { ...row, is_following: follow } : row)) as InfiniteData<ConnectionsPage>,
      );
      const vehicles = edit<PublicVehicle>(client, isVehiclePageKey, (vehicle) =>
        vehicle.owner && sameName(vehicle.owner.username, name) ? { ...vehicle, owner: { ...vehicle.owner, is_following: follow } } : vehicle,
      );
      return { snapshot: [...profiles, ...rows, ...vehicles] as Snapshot };
    },
    onError: (_error, _input, context) => restore(client, context?.snapshot),
    onSuccess: (state) => {
      const { followers } = state;
      if (followers !== null) {
        edit<MemberProfile>(client, (key) => isProfileKey(key, state.username), (profile) => ({
          ...profile,
          is_following: state.is_following,
          stats: { ...profile.stats, followers },
        }));
      }
    },
    onSettled: (_state, _error, { username: name }) => {
      // Your own count and your Folge ich list change with every follow, and so does the member's Follower list.
      void client.invalidateQueries({ queryKey: meKey });
      void client.invalidateQueries({
        predicate: (query) =>
          isConnectionsKey(query.queryKey, name, 'followers') ||
          (own !== '' && (isProfileKey(query.queryKey, own) || isConnectionsKey(query.queryKey, own, 'following'))),
      });
    },
  });
}

/** PROF-04, own Follower tab: the member stops following you. The row goes at once and comes back if the call fails. */
export function useRemoveFollower({ onFailed }: WriteOptions = {}) {
  const client = useQueryClient();
  const own = useSessionStore((state) => state.member?.username ?? '');
  return useMutation({
    mutationFn: async (username: string) =>
      (await apiData(api.DELETE('/me/followers/{username}', { params: { path: { username } } }))).data,
    onMutate: async (username) => {
      refuseInViewAs();
      await client.cancelQueries({ predicate: (query) => isConnectionsKey(query.queryKey, own, 'followers') });
      const rows = edit<InfiniteData<ConnectionsPage>>(client, (key) => isConnectionsKey(key, own, 'followers'), (data) =>
        mapRows(data, (row: Connection) => (sameName(row.username, username) ? null : row)) as InfiniteData<ConnectionsPage>,
      );
      const profiles = edit<MemberProfile>(client, (key) => isProfileKey(key, own), (profile) => ({
        ...profile,
        stats: { ...profile.stats, followers: bump(profile.stats.followers, -1) },
      }));
      const theirs = edit<MemberProfile>(client, (key) => isProfileKey(key, username), (profile) => ({ ...profile, follows_you: false }));
      return { snapshot: [...rows, ...profiles, ...theirs] as Snapshot };
    },
    onError: (error, _username, context) => {
      restore(client, context?.snapshot);
      onFailed?.(error);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: meKey });
    },
  });
}

// -- Blocks

/**
 * Everything that could show a member who was just blocked or unblocked: their profile and lists, every follower list, feeds,
 * Discover, search, vehicle pages and the saved builds. A block also ends follows both ways, so your own counts change.
 */
async function refreshAfterBlockChange(client: QueryClient, username: string, blocked: boolean): Promise<void> {
  const target = memberIdOf(username);
  // The page on screen is left right after a block: it is not asked again, so it cannot flash the unavailable state on the way
  // out. Every other copy of the member goes.
  if (blocked) client.removeQueries({ queryKey: memberKeys.of(username), type: 'inactive' });
  await Promise.all([
    client.invalidateQueries({ queryKey: memberKeys.of(username), refetchType: blocked ? 'none' : 'active' }),
    client.invalidateQueries({ predicate: (query) => query.queryKey[0] === memberKeys.all[0] && query.queryKey[1] !== target }),
    client.invalidateQueries({ queryKey: homeKeys.all }),
    client.invalidateQueries({ queryKey: discoverKeys.all }),
    client.invalidateQueries({ queryKey: searchKeys.all }),
    client.invalidateQueries({ queryKey: ['public-vehicle'] }),
    client.invalidateQueries({ queryKey: savedKey }),
    client.invalidateQueries({ queryKey: blocksKey }),
    client.invalidateQueries({ queryKey: meKey }),
  ]);
}

/** The block dialog's confirm. Not optimistic: the dialog shows the call under way, and closes when the server has answered. */
export function useBlockMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (username: string) =>
      (await apiData(api.POST('/users/{username}/block', { params: { path: { username } } }))).data,
    // The dialog closes as soon as the server has answered; the lists catch up behind it.
    onSuccess: (_answer, username) => {
      void refreshAfterBlockChange(client, username, true);
    },
  });
}

/**
 * After a block, once the member's page has been left: every copy of the member and of their vehicle pages goes, so neither a later
 * visit nor an offline start shows them from the cache. The vehicles are found by the owner on their cached pages.
 */
export function forgetBlockedMember(client: QueryClient, username: string): void {
  client.removeQueries({ queryKey: memberKeys.of(username) });
  const vehicles = new Set<string>();
  client.getQueriesData<PublicVehicle>({ predicate: (query) => isVehiclePageKey(query.queryKey) }).forEach(([key, vehicle]) => {
    if (vehicle?.owner && sameName(vehicle.owner.username, username) && typeof key[1] === 'string') vehicles.add(key[1]);
  });
  vehicles.forEach((publicId) => client.removeQueries({ queryKey: ['public-vehicle', publicId] }));
}

/** SET-08 "Freigeben": the row goes at once and comes back if the call fails. */
export function useUnblockMember({ onFailed }: WriteOptions = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (username: string) =>
      (await apiData(api.DELETE('/users/{username}/block', { params: { path: { username } } }))).data,
    onMutate: async (username) => {
      refuseInViewAs();
      await client.cancelQueries({ queryKey: blocksKey });
      const rows = edit<InfiniteData<BlocksPage>>(client, (key) => key[0] === blocksKey[0] && key[1] === blocksKey[1], (data) =>
        mapRows(data, (row: BlockedMember) => (sameName(row.username, username) ? null : row)) as InfiniteData<BlocksPage>,
      );
      return { snapshot: rows };
    },
    onError: (error, _username, context) => {
      restore(client, context?.snapshot);
      onFailed?.(error);
    },
    onSuccess: (_answer, username) => {
      void refreshAfterBlockChange(client, username, false);
    },
  });
}

// -- Saves [SIGNATURE sig.saved_builds]

export type SaveInput = { vehicleId: string; save: boolean };

/** Where an unsaved card stood in the list, so "Rückgängig" puts it back there until the list is read again. */
const unsavedPlaces = new Map<string, { page: number; index: number; row: SavedBuild }>();

function placeOf(data: InfiniteData<SavedPage>, id: string): { page: number; index: number; row: SavedBuild } | null {
  for (const [page, entry] of data.pages.entries()) {
    const index = entry.data.findIndex((row) => row.id === id);
    const row = entry.data[index];
    if (row) return { page, index, row };
  }
  return null;
}

function reinsert(data: InfiniteData<SavedPage>, place: { page: number; index: number; row: SavedBuild }): InfiniteData<SavedPage> {
  if (placeOf(data, place.row.id) || !data.pages[place.page]) return data;
  return {
    ...data,
    pages: data.pages.map((entry, page) =>
      page === place.page ? { ...entry, data: [...entry.data.slice(0, place.index), place.row, ...entry.data.slice(place.index)] } : entry,
    ),
  };
}

/**
 * Save or unsave a build (VEH-01, PROF-05). One call after the other per vehicle. The vehicle page's state and the saved list
 * change at once; an unsave takes the card out of the list, a save brings the list up to date when the server has answered.
 */
export function useSaveBuild(vehicleId: string, { onFailed }: WriteOptions = {}) {
  const client = useQueryClient();
  return useMutation({
    scope: { id: `save:${vehicleId}` },
    mutationFn: async ({ vehicleId: id, save }: SaveInput) => {
      const options = { params: { path: { vehicle: id } } };
      return (await apiData(save ? api.POST('/vehicles/{vehicle}/save', options) : api.DELETE('/vehicles/{vehicle}/save', options))).data;
    },
    onMutate: async ({ vehicleId: id, save }) => {
      refuseInViewAs();
      await client.cancelQueries({ predicate: (query) => isVehiclePageKey(query.queryKey) });
      const pages = edit<PublicVehicle>(client, isVehiclePageKey, (vehicle) => (vehicle.id === id ? { ...vehicle, is_saved: save } : vehicle));
      const isSavedList = (key: QueryKey) => key[0] === savedKey[0] && key[1] === savedKey[1];
      let rows: Snapshot;
      if (save) {
        const place = unsavedPlaces.get(id);
        unsavedPlaces.delete(id);
        rows = place ? edit<InfiniteData<SavedPage>>(client, isSavedList, (data) => reinsert(data, place)) : [];
      } else {
        rows = edit<InfiniteData<SavedPage>>(client, isSavedList, (data) => {
          const place = placeOf(data, id);
          if (place) unsavedPlaces.set(id, place);
          return mapRows(data, (row: SavedBuild) => (row.id === id ? null : row)) as InfiniteData<SavedPage>;
        });
      }
      return { snapshot: [...pages, ...rows] as Snapshot };
    },
    onError: (error, _input, context) => {
      restore(client, context?.snapshot);
      onFailed?.(error);
    },
    onSettled: (_answer, _error, { save }) => {
      if (save) void client.invalidateQueries({ queryKey: savedKey });
    },
  });
}
