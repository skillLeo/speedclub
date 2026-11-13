/**
 * M4.11 Social 2.0 in the app (09 §8.5–§8.6, ADR-436): build follow, private reactions, the Highlights rail, member
 * collections, @mention suggestions and build updates 2.0 (post, edit within 24 h, delete; photos follow the post).
 *
 * Privacy rules the hooks keep: a reaction count reaches the owner only (`reaction_summary`, the owner's reaction list); a
 * non-owner only ever knows `my_reaction`. The build's follower count is the owner's too (`social.followers_count`).
 *
 * Follow, react and the collection toggles are optimistic: every cached copy of the item changes at once (the vehicle page, its
 * Verlauf, the update detail and the Home feed), and goes back when the call fails. A post is inserted into the vehicle's
 * Verlauf as soon as the server answers; its photos then upload through the app's upload queue.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import { api, apiData, ApiError, viewAsRefusedError, withIdempotency } from '@/api/client';
import { isViewAsTab } from '@/api/clientViewAs';
import type { components } from '@/api/schema';
import {
  retryUnlessAnswered,
  usePublicViewer,
  vehicleKeys,
  type BuildUpdate,
  type PublicVehicle,
} from '@/api/queries/vehicles';
import { useSessionStore } from '@/state/session';

export type ReactionKey = components['schemas']['ReactionType'];
export type ReactionSummary = NonNullable<BuildUpdate['reaction_summary']>;
export type ReactionRow = components['schemas']['ReactionRowResource'];
export type ReactionTarget = 'vehicles' | 'build-updates';
export type Highlight = components['schemas']['HighlightResource'];
export type HighlightItemType = components['schemas']['HighlightItemType'];
export type MemberCollection = components['schemas']['MemberCollectionResource'];
export type CollectionItem = components['schemas']['MemberCollectionItemResource'];
export type CollectionItemType = components['schemas']['CollectionItemType'];
export type MentionSuggestion = components['schemas']['MemberSummaryResource'];
export type BuildUpdateAudience = components['schemas']['BuildUpdateAudience'];
export type VehicleSocial = components['schemas']['VehicleSocialResource'];

export const REACTION_KEYS: readonly ReactionKey[] = ['strong', 'clean', 'low', 'loud'];
/** 09 §8.5: up to 10 photos, ≤ 2,000 characters, ≤ 8 highlights, ≤ 20 linked mods, ≤ 5 before/after pairs. */
export const UPDATE_PHOTO_LIMIT = 10;
export const UPDATE_TEXT_MAX = 2000;
export const HIGHLIGHTS_MAX = 8;
export const UPDATE_MODS_MAX = 20;
export const UPDATE_PAIRS_MAX = 5;
export const COLLECTION_NAME_MAX = 60;
export const MENTION_QUERY_MAX = 30;
const REACTIONS_PAGE_SIZE = 30;

export const SOCIAL_FLAGS = {
  reactions: 'build_reactions',
  mentions: 'mentions',
  comments: 'build_comments',
  collections: 'collections',
  follow: 'vehicle_follow',
} as const;

export const social2Keys = {
  highlights: (vehicleId: string, viewer: string) => ['social2', viewer, 'highlights', vehicleId] as const,
  update: (updateId: string, viewer: string) => ['build-update', viewer, updateId] as const,
  reactions: (target: ReactionTarget, id: string) => ['social2', 'reactions', target, id] as const,
  collections: (contains?: { type: CollectionItemType; id: string }) =>
    contains
      ? (['me', 'collections', 'contains', contains.type, contains.id] as const)
      : (['me', 'collections'] as const),
  collectionItems: (collectionId: string) => ['me', 'collections', 'items', collectionId] as const,
  mentions: (q: string) => ['social2', 'mentions', q.toLowerCase()] as const,
};

function refuseInViewAs(): void {
  if (isViewAsTab()) throw viewAsRefusedError('view_as_read_only');
}

// -- Cache edits

type Snapshot = readonly (readonly [QueryKey, unknown])[];

function restore(client: QueryClient, snapshot: Snapshot | undefined): void {
  snapshot?.forEach(([key, data]) => client.setQueryData(key, data));
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * Maps every plain object inside `value` that `match` picks, keeping the references of untouched branches (so only the screens
 * that show the item render again). Exported for the tests.
 */
export function deepEdit(
  value: unknown,
  match: (node: Record<string, unknown>) => boolean,
  change: (node: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const mapped = deepEdit(entry, match, change);
      if (mapped !== entry) changed = true;
      return mapped;
    });
    return changed ? next : value;
  }
  if (!isPlainObject(value)) return value;
  const base = match(value) ? change(value) : value;
  let changed = base !== value;
  const next: Record<string, unknown> = { ...base };
  for (const [key, entry] of Object.entries(base)) {
    const mapped = deepEdit(entry, match, change);
    if (mapped !== entry) {
      next[key] = mapped;
      changed = true;
    }
  }
  return changed ? next : value;
}

/** The queries that can hold a build or an update: the vehicle pages, update details, Home and the collections. */
const SOCIAL_ROOTS = new Set(['public-vehicle', 'build-update', 'home', 'social2', 'me', 'garage']);

function editEverywhere(
  client: QueryClient,
  match: (node: Record<string, unknown>) => boolean,
  change: (node: Record<string, unknown>) => Record<string, unknown>,
): Snapshot {
  const before = client.getQueriesData({ predicate: (query) => SOCIAL_ROOTS.has(String(query.queryKey[0])) });
  const snapshot: (readonly [QueryKey, unknown])[] = [];
  before.forEach(([key, data]) => {
    if (data === undefined) return;
    const next = deepEdit(data, match, change);
    if (next !== data) {
      snapshot.push([key, data]);
      client.setQueryData(key, next);
    }
  });
  return snapshot;
}

/** A build update as the API sends it, wherever it is nested. */
const isUpdateNode = (id: string) => (node: Record<string, unknown>) =>
  node.id === id && 'photo_pairs' in node && 'my_reaction' in node;
/** The vehicle page or a feed vehicle that carries its `social` block. */
const isVehicleNode = (id: string) => (node: Record<string, unknown>) =>
  node.id === id && isPlainObject(node.social);

// -- Build follow (09 §8.6)

/**
 * Follow a build without following its owner. Optimistic on the page's `social.is_following`; the owner's private count is not
 * guessed (the owner cannot follow their own build).
 */
export function useVehicleFollow(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    scope: { id: `vehicle-follow:${vehicleId}` },
    mutationFn: async (follow: boolean) => {
      const options = { params: { path: { vehicle: vehicleId } } };
      return (
        await apiData(
          follow
            ? api.PUT('/vehicles/{vehicle}/follow', options)
            : api.DELETE('/vehicles/{vehicle}/follow', options),
        )
      ).data;
    },
    onMutate: async (follow) => {
      refuseInViewAs();
      await client.cancelQueries({ queryKey: ['public-vehicle'] });
      const snapshot = editEverywhere(client, isVehicleNode(vehicleId), (node) => ({
        ...node,
        social: { ...(node.social as VehicleSocial), is_following: follow },
      }));
      return { snapshot };
    },
    onError: (_error, _follow, context) => restore(client, context?.snapshot),
    onSuccess: (state) => {
      editEverywhere(client, isVehicleNode(vehicleId), (node) => ({
        ...node,
        social: { ...(node.social as VehicleSocial), is_following: state.is_following },
      }));
      // "Folge ich" on Home now has (or no longer has) this build's updates.
      void client.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'home' && query.queryKey[3] === 'following',
      });
    },
  });
}

// -- Reactions (09 §8.5)

/**
 * The viewer's own reaction on a build or an update: `null` takes it back. Changes `my_reaction` in every cached copy at once.
 * Never touches a count: those exist for the owner only, who cannot react.
 */
export function useReact(target: ReactionTarget, id: string) {
  const client = useQueryClient();
  const match = target === 'vehicles' ? isVehicleNode(id) : isUpdateNode(id);
  const apply = (reaction: ReactionKey | null) =>
    editEverywhere(client, match, (node) =>
      target === 'vehicles'
        ? { ...node, social: { ...(node.social as VehicleSocial), my_reaction: reaction } }
        : { ...node, my_reaction: reaction },
    );
  return useMutation({
    scope: { id: `react:${target}:${id}` },
    mutationFn: async (reaction: ReactionKey | null) => {
      if (target === 'vehicles') {
        const options = { params: { path: { id } } };
        return (
          await apiData(
            reaction
              ? api.PUT('/vehicles/{id}/reactions', { ...options, body: { reaction } })
              : api.DELETE('/vehicles/{id}/reactions', options),
          )
        ).data;
      }
      const options = { params: { path: { id } } };
      return (
        await apiData(
          reaction
            ? api.PUT('/build-updates/{id}/reactions', { ...options, body: { reaction } })
            : api.DELETE('/build-updates/{id}/reactions', options),
        )
      ).data;
    },
    onMutate: async (reaction) => {
      refuseInViewAs();
      return { snapshot: apply(reaction) };
    },
    onError: (_error, _reaction, context) => restore(client, context?.snapshot),
    onSuccess: (state) => {
      apply(state.my_reaction);
    },
  });
}

/** The owner's list of who reacted how (newest first). Owner only: everybody else gets 403, so the screen asks only as owner. */
export function useReactionList(target: ReactionTarget, id: string | undefined, enabled: boolean) {
  const value = id ?? '';
  return useInfiniteQuery({
    queryKey: social2Keys.reactions(target, value),
    queryFn: async ({ pageParam, signal }) => {
      const query = { per_page: REACTIONS_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) };
      return target === 'vehicles'
        ? apiData(api.GET('/vehicles/{id}/reactions', { params: { path: { id: value }, query }, signal }))
        : apiData(
            api.GET('/build-updates/{id}/reactions', { params: { path: { id: value }, query }, signal }),
          );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: enabled && value !== '',
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

// -- Highlights (09 §8.5)

/** The vehicle's Highlights rail, in the owner's order; guests read it too. */
export function useHighlights(vehicleId: string | undefined, enabled: boolean = true) {
  const viewer = usePublicViewer();
  const value = vehicleId ?? '';
  return useQuery({
    queryKey: social2Keys.highlights(value, viewer),
    queryFn: async ({ signal }) =>
      (
        await apiData(
          api.GET('/vehicles/{vehicle}/highlights', { params: { path: { vehicle: value } }, signal }),
        )
      ).data,
    enabled: enabled && value !== '',
    retry: retryUnlessAnswered,
  });
}

export type HighlightPick = { type: HighlightItemType; id: string };

/** The owner replaces the whole rail (≤ 8). The rail shows the new order at once and goes back when the call fails. */
export function useSetHighlights(vehicleId: string) {
  const client = useQueryClient();
  const viewer = usePublicViewer();
  const key = social2Keys.highlights(vehicleId, viewer);
  return useMutation({
    mutationFn: async (items: readonly HighlightPick[]) =>
      (
        await apiData(
          api.PUT('/vehicles/{vehicle}/highlights', {
            params: { path: { vehicle: vehicleId } },
            body: { items: [...items] },
          }),
        )
      ).data,
    onMutate: async (items) => {
      refuseInViewAs();
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<Highlight[]>(key);
      if (before) {
        const known = new Map(before.map((item) => [`${item.type}:${item.id}`, item]));
        const next = items.flatMap((item, position) => {
          const found = known.get(`${item.type}:${item.id}`);
          return found ? [{ ...found, position }] : [];
        });
        client.setQueryData(key, next);
      }
      return { before };
    },
    onError: (_error, _items, context) => {
      if (context?.before) client.setQueryData(key, context.before);
    },
    onSuccess: (rail) => {
      client.setQueryData(key, rail);
      void client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'social2' &&
          query.queryKey[2] === 'highlights' &&
          query.queryKey[3] === vehicleId,
      });
    },
  });
}

// -- Collections (09 §8.6)

/** The member's collections, "Gespeichert" first. With `contains`, each says whether it holds that item (the save sheet). */
export function useCollections(contains?: { type: CollectionItemType; id: string }, enabled: boolean = true) {
  const signedIn = useSessionStore((state) => state.status === 'member');
  return useQuery({
    queryKey: social2Keys.collections(contains),
    queryFn: async ({ signal }) =>
      (
        await apiData(
          api.GET('/me/collections', {
            params: { query: contains ? { contains_type: contains.type, contains_id: contains.id } : {} },
            signal,
          }),
        )
      ).data,
    enabled: enabled && signedIn,
    retry: retryUnlessAnswered,
  });
}

export function useCreateCollection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      (await apiData(api.POST('/me/collections', { body: { name }, ...withIdempotency() }))).data,
    onMutate: () => refuseInViewAs(),
    onSettled: () => client.invalidateQueries({ queryKey: ['me', 'collections'] }),
  });
}

export type CollectionToggle = {
  collectionId: string;
  isDefault: boolean;
  type: CollectionItemType;
  id: string;
  add: boolean;
};

/**
 * Adds an item to a collection or takes it out. The save sheet's row flips at once; a build in any collection counts as saved
 * (ADR-436 a), so the page's `is_saved` follows the default collection and is read again after the call.
 */
export function useToggleCollectionItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ collectionId, type, id, add }: CollectionToggle) => {
      if (add) {
        await apiData(
          api.POST('/me/collections/{collection}/items', {
            params: { path: { collection: collectionId } },
            body: { type, id },
          }),
        );
      } else {
        await apiData(
          api.DELETE('/me/collections/{collection}/items/{type}/{id}', {
            params: { path: { collection: collectionId, type, id } },
          }),
        );
      }
    },
    onMutate: async ({ collectionId, type, id, add }) => {
      refuseInViewAs();
      const key = social2Keys.collections({ type, id });
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<MemberCollection[]>(key);
      if (before) {
        client.setQueryData<MemberCollection[]>(
          key,
          before.map((collection) =>
            collection.id === collectionId
              ? {
                  ...collection,
                  contains: add,
                  items_count: Math.max(0, collection.items_count + (add ? 1 : -1)),
                }
              : collection,
          ),
        );
      }
      let pages: Snapshot = [];
      if (type === 'vehicle') {
        const after = (client.getQueryData<MemberCollection[]>(key) ?? []).some(
          (collection) => collection.contains === true,
        );
        pages = editEverywhere(
          client,
          (node) => node.id === id && 'is_saved' in node && 'slug' in node,
          (node) => ({ ...node, is_saved: after }),
        );
      }
      return { before, key, pages };
    },
    onError: (_error, _input, context) => {
      if (context?.before) client.setQueryData(context.key, context.before);
      restore(client, context?.pages);
    },
    onSettled: (_answer, _error, { collectionId, type }) => {
      void client.invalidateQueries({ queryKey: ['me', 'collections'] });
      void client.invalidateQueries({ queryKey: social2Keys.collectionItems(collectionId) });
      if (type === 'vehicle') void client.invalidateQueries({ queryKey: ['me', 'saved'] });
    },
  });
}

// -- Collections COL-01 / COL-02 (09 §7.7, §8.6)

/** One page of a collection's wall. */
export const COLLECTION_ITEMS_PAGE = 30;

type CollectionItemsPage = {
  data: CollectionItem[];
  meta: { next_cursor: string | null };
};
export type CollectionItemsData = InfiniteData<CollectionItemsPage, string | null>;

/** "vehicle:01J…": how the order route names an item (ReorderCollectionItems). */
export function collectionItemKey(item: Pick<CollectionItem, 'type' | 'id'>): string {
  return `${item.type}:${item.id}`;
}

/** The items of a collection, the member's order (highest position first), page by page. */
export function useCollectionItems(collectionId: string | undefined, enabled: boolean = true) {
  const signedIn = useSessionStore((state) => state.status === 'member');
  const id = collectionId ?? '';
  return useInfiniteQuery({
    queryKey: social2Keys.collectionItems(id),
    queryFn: async ({ pageParam, signal }) => {
      const page = await apiData(
        api.GET('/me/collections/{collection}/items', {
          params: {
            path: { collection: id },
            query: { per_page: COLLECTION_ITEMS_PAGE, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        }),
      );
      return { data: page.data, meta: { next_cursor: page.meta.next_cursor } } satisfies CollectionItemsPage;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: enabled && signedIn && id !== '',
    retry: retryUnlessAnswered,
  });
}

/** Every item shown, in order. */
export function flattenCollectionItems(data: { pages: readonly CollectionItemsPage[] } | undefined): CollectionItem[] {
  return data?.pages.flatMap((page) => page.data) ?? [];
}

/** The same pages with the items in `ordered` order; items the pages do not hold are left out. Exported for the tests. */
export function withItemOrder(data: CollectionItemsData, ordered: readonly string[]): CollectionItemsData {
  const all = flattenCollectionItems(data);
  const byKey = new Map(all.map((item) => [collectionItemKey(item), item]));
  const next = ordered.map((key) => byKey.get(key)).filter((item): item is CollectionItem => item !== undefined);
  let offset = 0;
  return {
    ...data,
    pages: data.pages.map((page) => {
      const slice = next.slice(offset, offset + page.data.length);
      offset += page.data.length;
      return { ...page, data: slice };
    }),
  };
}

/** The pages without one item. Exported for the tests. */
export function withoutItem(data: CollectionItemsData, key: string): CollectionItemsData {
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, data: page.data.filter((item) => collectionItemKey(item) !== key) })),
  };
}

/** A new name, at once in the list; back to the old one when the server refuses. */
export function useRenameCollection() {
  const client = useQueryClient();
  const key = social2Keys.collections();
  return useMutation({
    mutationFn: async ({ collectionId, name }: { collectionId: string; name: string }) =>
      (
        await apiData(
          api.PATCH('/me/collections/{collection}', { params: { path: { collection: collectionId } }, body: { name } }),
        )
      ).data,
    onMutate: async ({ collectionId, name }) => {
      refuseInViewAs();
      await client.cancelQueries({ queryKey: key, exact: true });
      const before = client.getQueryData<MemberCollection[]>(key);
      if (before) {
        client.setQueryData<MemberCollection[]>(
          key,
          before.map((collection) => (collection.id === collectionId ? { ...collection, name } : collection)),
        );
      }
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before) client.setQueryData(key, context.before);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}

/**
 * Deletes a collection for good (with its entries; "Gespeichert" cannot be deleted, 409). The screens hide it first and send
 * this only once the undo toast is gone (SM20), so Rückgängig never needs the server.
 */
export function useDeleteCollection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (collectionId: string) => {
      await apiData(api.DELETE('/me/collections/{collection}', { params: { path: { collection: collectionId } } }));
    },
    onMutate: () => refuseInViewAs(),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['me', 'collections'] });
      void client.invalidateQueries({ queryKey: ['me', 'saved'] });
    },
  });
}

/** Takes an item out of a collection (COL-02, after its undo toast is gone). */
export function useRemoveCollectionItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ collectionId, type, id }: { collectionId: string; type: CollectionItemType; id: string }) => {
      await apiData(
        api.DELETE('/me/collections/{collection}/items/{type}/{id}', {
          params: { path: { collection: collectionId, type, id } },
        }),
      );
    },
    onMutate: () => refuseInViewAs(),
    onSettled: (_answer, _error, { collectionId, type }) => {
      void client.invalidateQueries({ queryKey: social2Keys.collections(), exact: true });
      void client.invalidateQueries({ queryKey: social2Keys.collectionItems(collectionId) });
      if (type === 'vehicle') void client.invalidateQueries({ queryKey: ['me', 'saved'] });
    },
  });
}

/** COL-01 order, top first: at once in the list, back when the server refuses. */
export function useReorderCollections() {
  const client = useQueryClient();
  const key = social2Keys.collections();
  return useMutation({
    mutationFn: async (ids: readonly string[]) => {
      await apiData(api.PUT('/me/collections/order', { body: { ids: [...ids] } }));
    },
    onMutate: async (ids) => {
      refuseInViewAs();
      await client.cancelQueries({ queryKey: key, exact: true });
      const before = client.getQueryData<MemberCollection[]>(key);
      if (before) {
        const byId = new Map(before.map((collection) => [collection.id, collection]));
        client.setQueryData<MemberCollection[]>(
          key,
          ids.map((id) => byId.get(id)).filter((collection): collection is MemberCollection => collection !== undefined),
        );
      }
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before) client.setQueryData(key, context.before);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key, exact: true }),
  });
}

/**
 * COL-02 order, top first, as "type:id". The app sends what it shows; items it does not show (not loaded, or hidden from the
 * member right now) keep their order after them (ReorderCollectionItems).
 */
export function useReorderCollectionItems(collectionId: string) {
  const client = useQueryClient();
  const key = social2Keys.collectionItems(collectionId);
  return useMutation({
    mutationFn: async (ordered: readonly string[]) => {
      await apiData(
        api.PUT('/me/collections/{collection}/items/order', {
          params: { path: { collection: collectionId } },
          body: { ids: [...ordered] },
        }),
      );
    },
    onMutate: async (ordered) => {
      refuseInViewAs();
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<CollectionItemsData>(key);
      if (before) client.setQueryData<CollectionItemsData>(key, withItemOrder(before, ordered));
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before) client.setQueryData(key, context.before);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: social2Keys.collections(), exact: true });
    },
  });
}

// -- Mentions (09 §8.5)

/** Normalises what follows the "@": no leading @, at most 30 characters. */
export function mentionQuery(raw: string): string {
  return raw.replace(/^@+/, '').slice(0, MENTION_QUERY_MAX);
}

/** Up to 8 members the viewer may mention whose name starts with `q`. Asks only from one character on. */
export function useMentionSuggestions(raw: string | null, enabled: boolean) {
  const q = raw === null ? '' : mentionQuery(raw);
  return useQuery({
    queryKey: social2Keys.mentions(q),
    queryFn: async ({ signal }) =>
      (await apiData(api.GET('/mentions/suggest', { params: { query: { q } }, signal }))).data,
    enabled: enabled && raw !== null && q.length > 0,
    staleTime: 30_000,
    retry: false,
    meta: { persist: false },
  });
}

// -- Build updates 2.0 (09 §8.5, VEH-05, UPD-01)

/** VEH-05 for any update the viewer may see (a followers-only post too, which the public route does not carry). */
export function useBuildUpdate(updateId: string | undefined, initial?: BuildUpdate) {
  const viewer = usePublicViewer();
  const value = updateId ?? '';
  return useQuery({
    queryKey: social2Keys.update(value, viewer),
    queryFn: async ({ signal }) =>
      (await apiData(api.GET('/build-updates/{update}', { params: { path: { update: value } }, signal })))
        .data,
    enabled: value !== '',
    retry: retryUnlessAnswered,
    ...(initial ? { placeholderData: initial } : {}),
  });
}

export type NewBuildUpdate = {
  vehicleId: string;
  /** The vehicle's slug: the page whose Verlauf gets the post. */
  slug: string;
  text: string | null;
  mileageKm: number | null;
  happenedOn: string | null;
  audience: BuildUpdateAudience;
  modificationIds: readonly string[];
  /** One key per "Posten": a retry of the same post is answered with the first one (no double post). */
  idempotencyKey: string;
};

function insertIntoPage(vehicle: PublicVehicle, update: BuildUpdate): PublicVehicle {
  if (vehicle.updates.some((entry) => entry.id === update.id)) return vehicle;
  return { ...vehicle, updates: [update, ...vehicle.updates], updates_count: vehicle.updates_count + 1 };
}

/** "Posten": creates the post; the screen then queues its photos for `build-updates/{id}/media`. */
export function useCreateBuildUpdate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewBuildUpdate) =>
      (
        await apiData(
          api.POST('/build-updates', {
            body: {
              vehicle_id: input.vehicleId,
              text: input.text,
              mileage_km: input.mileageKm,
              happened_on: input.happenedOn,
              audience: input.audience,
              modification_ids: [...input.modificationIds],
            },
            ...withIdempotency(input.idempotencyKey),
          }),
        )
      ).data,
    onMutate: () => refuseInViewAs(),
    onSuccess: (update, input) => {
      // The owner's own page shows it at once; everybody else reads it on their next visit.
      client
        .getQueriesData<PublicVehicle>({ queryKey: vehicleKeys.of(input.slug) })
        .forEach(([key, data]) => {
          if (data && Array.isArray(data.updates)) client.setQueryData(key, insertIntoPage(data, update));
        });
      void client.invalidateQueries({ queryKey: vehicleKeys.of(input.slug) });
      void client.invalidateQueries({ queryKey: ['home'] });
      void client.invalidateQueries({ queryKey: ['garage'] });
    },
  });
}

export type BuildUpdateChange = {
  text?: string | null;
  mileage_km?: number | null;
  happened_on?: string | null;
  audience?: BuildUpdateAudience | null;
  modification_ids?: string[] | null;
  photo_order?: string[];
  photo_pairs?: string[][];
};

/** The owner's edit within 24 hours (403 `edit_window_closed` afterwards); the answer replaces every cached copy. */
export function useEditBuildUpdate(updateId: string, slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: BuildUpdateChange) =>
      (
        await apiData(
          api.PATCH('/build-updates/{update}', { params: { path: { update: updateId } }, body: change }),
        )
      ).data,
    onMutate: () => refuseInViewAs(),
    onSuccess: (update) => {
      editEverywhere(client, isUpdateNode(updateId), () => update as unknown as Record<string, unknown>);
      void client.invalidateQueries({ queryKey: vehicleKeys.of(slug) });
    },
  });
}

/** Deletes the post for good (ADR-436 g): it leaves the page, the feed and every collection. */
export function useDeleteBuildUpdate(updateId: string, slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiData(api.DELETE('/build-updates/{update}', { params: { path: { update: updateId } } }));
    },
    onMutate: () => refuseInViewAs(),
    onSuccess: () => {
      client.getQueriesData<PublicVehicle>({ queryKey: vehicleKeys.of(slug) }).forEach(([key, data]) => {
        if (data && Array.isArray(data.updates)) {
          client.setQueryData(key, {
            ...data,
            updates: data.updates.filter((entry) => entry.id !== updateId),
            updates_count: Math.max(0, data.updates_count - 1),
          });
        }
      });
      client.removeQueries({
        predicate: (query) => query.queryKey[0] === 'build-update' && query.queryKey[2] === updateId,
      });
      void client.invalidateQueries({ queryKey: vehicleKeys.of(slug) });
      void client.invalidateQueries({ queryKey: ['home'] });
    },
  });
}

/** The edit window of an update, for the owner: open until `editable_until`. */
export function canEditUpdate(
  update: Pick<BuildUpdate, 'editable_until'>,
  now: number = Date.now(),
): boolean {
  if (!update.editable_until) return false;
  const until = Date.parse(update.editable_until);
  return Number.isFinite(until) && until > now;
}

/** A 403 on an edit after the 24 hours. */
export function isEditWindowClosed(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === 'edit_window_closed';
}

// -- Comments (09 §8.5, flag `build_comments`, off by default)

export type BuildComment = components['schemas']['CommentResource'];
export const COMMENT_MAX = 500;

export const commentKeys = { of: (updateId: string) => ['build-update-comments', updateId] as const };

/** Flat comments with one reply level, oldest first. Only asked for while the flag is on. */
export function useComments(updateId: string | undefined, enabled: boolean) {
  const value = updateId ?? '';
  return useInfiniteQuery({
    queryKey: commentKeys.of(value),
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        api.GET('/build-updates/{update}/comments', {
          params: {
            path: { update: value },
            query: { per_page: REACTIONS_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: enabled && value !== '',
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

export function usePostComment(updateId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: string; parentId: string | null; idempotencyKey: string }) =>
      (
        await apiData(
          api.POST('/build-updates/{update}/comments', {
            params: { path: { update: updateId } },
            body: { body: input.body, parent_id: input.parentId },
            ...withIdempotency(input.idempotencyKey),
          }),
        )
      ).data,
    onMutate: () => refuseInViewAs(),
    onSettled: () => client.invalidateQueries({ queryKey: commentKeys.of(updateId) }),
  });
}

export function useDeleteComment(updateId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      await apiData(api.DELETE('/comments/{comment}', { params: { path: { comment: commentId } } }));
    },
    onMutate: () => refuseInViewAs(),
    onSettled: () => client.invalidateQueries({ queryKey: commentKeys.of(updateId) }),
  });
}
