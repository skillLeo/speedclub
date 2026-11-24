/**
 * R4-2.3 Crews (docs/11_CLIENT_ROUND_4.md, docs/reports/round-4/contract-crews.md): CREW-00 the list in Entdecken (`crews?q&bundesland&sort`,
 * never by size), CREW-01 the crew page and its members, CREW-02 found/edit with logo and cover, CREW-03 requests, invitations, roles,
 * hand-over and delete, CREW-04 "Meine Crews" with the member's open requests, CREW-05 the member's invitations, and the crew chips
 * of a member profile (`public/users/{username}/crews`).
 *
 * Every hook waits for the flag `crews` (404 feature_disabled while it is off). Member counts are facts on a card, never an order.
 */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { api, apiData, ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { retryUnlessAnswered } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

export type CrewCard = components['schemas']['CrewCardResource'];
export type Crew = components['schemas']['CrewResource'];
export type CrewMember = components['schemas']['CrewMemberResource'];
export type CrewInvite = components['schemas']['CrewInviteResource'];
export type CrewRequest = components['schemas']['CrewRequestResource'];
export type MemberCrew = components['schemas']['MemberCrewResource'];
export type CrewJoinMode = components['schemas']['CrewJoinMode'];
export type CrewRole = components['schemas']['CrewRole'];
export type CrewStatus = components['schemas']['CrewStatus'];
export type Bundesland = components['schemas']['Bundesland'];
export type StoreCrewBody = components['schemas']['StoreCrewRequest'];
export type UpdateCrewBody = components['schemas']['UpdateCrewRequest'];
export type CrewMedia = components['schemas']['MediaResource'];
export type CrewSort = 'name' | 'newest';
export type CrewMediaKind = 'logo' | 'cover';

export const CREWS_FLAG = 'crews';

export const JOIN_MODES: readonly CrewJoinMode[] = ['open', 'request', 'invite'];
export const CREW_SORTS: readonly CrewSort[] = ['name', 'newest'];
export const BUNDESLAENDER: readonly Bundesland[] = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'];

/** config/speedclub.php `crews.*` (contract §1): the form's limits match the server's. */
export const CREW_LIMITS = {
  nameMin: 3,
  nameMax: 40,
  descriptionMax: 500,
  queryMin: 2,
  queryMax: 40,
  memberships: 5,
  founded: 2,
} as const;

/** Contract §1 `reserved_names`, compared on the name key (lower case, spaces collapsed) and the slug. */
export const RESERVED_CREW_NAMES: ReadonlySet<string> = new Set([
  'speedclub', 'admin', 'staff', 'support', 'team', 'offiziell', 'official', 'moderation', 'crews', 'crew', 'neu', 'new', 'mine', 'me', 'invites', 'requests',
]);

export const CREW_CODES = {
  unavailable: 'crew_unavailable',
  limitReached: 'limit_reached',
  conflict: 'conflict',
  forbidden: 'forbidden',
  contentBlocked: 'content_blocked',
  restricted: 'account_restricted',
  emailNotVerified: 'email_not_verified',
} as const;

export const CREW_PAGE_SIZE = 30;

type Page<T> = { data: T[]; meta: { next_cursor: string | null } };
type Wrapped<T> = { data: T };

export type CrewFilters = { q: string | null; bundesland: Bundesland | null; sort: CrewSort };
export const DEFAULT_CREW_FILTERS: CrewFilters = { q: null, bundesland: null, sort: 'name' };

export const crewKeys = {
  all: ['crews'] as const,
  lists: ['crews', 'list'] as const,
  list: (filters: CrewFilters) => ['crews', 'list', filters.q ?? '', filters.bundesland ?? '', filters.sort] as const,
  detail: (slug: string) => ['crews', 'detail', slug] as const,
  members: (slug: string) => ['crews', 'members', slug] as const,
  requests: (slug: string) => ['crews', 'requests', slug] as const,
  invites: (slug: string) => ['crews', 'invites', slug] as const,
  mine: ['crews', 'mine'] as const,
  myInvites: ['crews', 'myInvites'] as const,
  myRequests: ['crews', 'myRequests'] as const,
  ofMember: (username: string) => ['crews', 'ofMember', username.toLowerCase()] as const,
};

/** The words of a search: trimmed, inner spaces collapsed; shorter than the server's minimum is no search. */
export function crewQueryOf(text: string): string | null {
  const q = text.trim().replace(/\s+/g, ' ').slice(0, CREW_LIMITS.queryMax);
  return q.length < CREW_LIMITS.queryMin ? null : q;
}

/** The crew name as the server stores it (contract §4): trimmed, inner whitespace collapsed. */
export function normaliseCrewName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function isCrewCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}

/** 404 `crew_unavailable` (gone, hidden from the reader, or a block came between) and `feature_disabled`. */
export function isCrewUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'not_found';
}

const cursorOf = (cursor: string | null) => (cursor ? { cursor } : {});
const nextCursor = (page: Page<unknown>) => page.meta.next_cursor ?? undefined;
const idempotent = (key: string) => ({ headers: { 'Idempotency-Key': key } });

/** The plain calls, shared by the hooks and the tests. */
export const crewsApi = {
  async list(filters: CrewFilters, cursor: string | null, signal?: AbortSignal): Promise<Page<CrewCard>> {
    const query = {
      per_page: CREW_PAGE_SIZE,
      sort: filters.sort,
      ...(filters.q ? { q: filters.q } : {}),
      ...(filters.bundesland ? { bundesland: filters.bundesland } : {}),
      ...cursorOf(cursor),
    };
    return apiData(api.GET('/crews', { params: { query }, signal }));
  },
  async detail(slug: string, signal?: AbortSignal): Promise<Crew> {
    return (await apiData(api.GET('/crews/{slug}', { params: { path: { slug } }, signal }))).data;
  },
  async members(slug: string, cursor: string | null, signal?: AbortSignal): Promise<Page<CrewMember>> {
    return apiData(api.GET('/crews/{slug}/members', { params: { path: { slug }, query: { per_page: CREW_PAGE_SIZE, ...cursorOf(cursor) } }, signal }));
  },
  async ofMember(username: string, signal?: AbortSignal): Promise<MemberCrew[]> {
    return (await apiData(api.GET('/public/users/{username}/crews', { params: { path: { username } }, signal }))).data;
  },
  async mine(signal?: AbortSignal): Promise<Crew[]> {
    return (await apiData(api.GET('/me/crews', { signal }))).data;
  },
  async myInvites(cursor: string | null, signal?: AbortSignal): Promise<Page<CrewInvite>> {
    return apiData(api.GET('/me/crew-invites', { params: { query: { per_page: CREW_PAGE_SIZE, ...cursorOf(cursor) } }, signal }));
  },
  async myRequests(cursor: string | null, signal?: AbortSignal): Promise<Page<CrewRequest>> {
    return apiData(api.GET('/me/crew-requests', { params: { query: { per_page: CREW_PAGE_SIZE, ...cursorOf(cursor) } }, signal }));
  },
  async create(body: StoreCrewBody, idempotencyKey: string): Promise<Crew> {
    return (await apiData(api.POST('/crews', { body, ...idempotent(idempotencyKey) }))).data;
  },
  async update(slug: string, body: UpdateCrewBody): Promise<Crew> {
    return (await apiData(api.PATCH('/crews/{slug}', { params: { path: { slug } }, body }))).data;
  },
  async uploadMedia(slug: string, kind: CrewMediaKind, form: FormData, idempotencyKey: string): Promise<CrewMedia> {
    const options = {
      params: { path: { slug } },
      // The generated type describes the multipart field as a string; the serializer hands the FormData on as is.
      body: form as unknown as components['schemas']['CrewMediaRequest'],
      bodySerializer: (body: unknown) => body as FormData,
      ...idempotent(idempotencyKey),
    };
    const answer = kind === 'logo' ? await apiData(api.POST('/crews/{slug}/logo', options)) : await apiData(api.POST('/crews/{slug}/cover', options));
    return (answer as Wrapped<CrewMedia>).data;
  },
  async deleteMedia(slug: string, kind: CrewMediaKind): Promise<void> {
    const options = { params: { path: { slug } } };
    if (kind === 'logo') await apiData(api.DELETE('/crews/{slug}/logo', options));
    else await apiData(api.DELETE('/crews/{slug}/cover', options));
  },
  async remove(slug: string, confirmName: string): Promise<void> {
    await apiData(api.DELETE('/crews/{slug}', { params: { path: { slug }, query: { confirm_name: confirmName } } }));
  },
  async join(slug: string, idempotencyKey: string): Promise<Crew> {
    return (await apiData(api.POST('/crews/{slug}/join', { params: { path: { slug } }, ...idempotent(idempotencyKey) }))).data;
  },
  async withdrawRequest(slug: string): Promise<void> {
    await apiData(api.DELETE('/crews/{slug}/join-request', { params: { path: { slug } } }));
  },
  async leave(slug: string): Promise<void> {
    await apiData(api.POST('/crews/{slug}/leave', { params: { path: { slug } } }));
  },
  async requests(slug: string, cursor: string | null, signal?: AbortSignal): Promise<Page<CrewRequest>> {
    return apiData(api.GET('/crews/{slug}/requests', { params: { path: { slug }, query: { per_page: CREW_PAGE_SIZE, ...cursorOf(cursor) } }, signal }));
  },
  async approve(slug: string, requestId: string, idempotencyKey: string): Promise<CrewMember> {
    const answer = await apiData(api.POST('/crews/{slug}/requests/{id}/approve', { params: { path: { slug, id: requestId } }, ...idempotent(idempotencyKey) }));
    return (answer as Wrapped<CrewMember>).data;
  },
  async decline(slug: string, requestId: string): Promise<void> {
    await apiData(api.POST('/crews/{slug}/requests/{id}/decline', { params: { path: { slug, id: requestId } } }));
  },
  async invites(slug: string, cursor: string | null, signal?: AbortSignal): Promise<Page<CrewInvite>> {
    return apiData(api.GET('/crews/{slug}/invites', { params: { path: { slug }, query: { per_page: CREW_PAGE_SIZE, ...cursorOf(cursor) } }, signal }));
  },
  async invite(slug: string, username: string, idempotencyKey: string): Promise<CrewInvite> {
    const answer = await apiData(api.POST('/crews/{slug}/invites', { params: { path: { slug } }, body: { username }, ...idempotent(idempotencyKey) }));
    return (answer as Wrapped<CrewInvite>).data;
  },
  async withdrawInvite(slug: string, inviteId: string): Promise<void> {
    await apiData(api.DELETE('/crews/{slug}/invites/{id}', { params: { path: { slug, id: inviteId } } }));
  },
  async acceptInvite(inviteId: string, idempotencyKey: string): Promise<Crew> {
    const answer = await apiData(api.POST('/me/crew-invites/{id}/accept', { params: { path: { id: inviteId } }, ...idempotent(idempotencyKey) }));
    return (answer as Wrapped<Crew>).data;
  },
  async declineInvite(inviteId: string): Promise<void> {
    await apiData(api.DELETE('/me/crew-invites/{id}', { params: { path: { id: inviteId } } }));
  },
  async removeMember(slug: string, username: string): Promise<void> {
    await apiData(api.DELETE('/crews/{slug}/members/{username}', { params: { path: { slug, username } } }));
  },
  async changeRole(slug: string, username: string, role: 'admin' | 'member'): Promise<CrewMember> {
    const answer = await apiData(api.PATCH('/crews/{slug}/members/{username}', { params: { path: { slug, username } }, body: { role } }));
    return (answer as Wrapped<CrewMember>).data;
  },
  async handOver(slug: string, username: string): Promise<Crew> {
    const answer = await apiData(api.POST('/crews/{slug}/founder', { params: { path: { slug } }, body: { username } }));
    return (answer as Wrapped<Crew>).data;
  },
};

export function useCrewsOn(): boolean {
  return useFlag(CREWS_FLAG);
}

/** Every row of the pages once, in the server's order. */
export function flattenPages<T>(pages: readonly Page<T>[] | undefined, keyOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages ?? []) {
    for (const row of page.data) {
      const key = keyOf(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

function withoutRow<T extends { id: string }>(data: InfiniteData<Page<T>> | undefined, id: string): InfiniteData<Page<T>> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, data: page.data.filter((row) => row.id !== id) })) };
}

function withoutMember(data: InfiniteData<Page<CrewMember>> | undefined, username: string): InfiniteData<Page<CrewMember>> | undefined {
  if (!data) return data;
  const name = username.toLowerCase();
  return { ...data, pages: data.pages.map((page) => ({ ...page, data: page.data.filter((row) => row.member.username?.toLowerCase() !== name) })) };
}

/** A crew answered by the server: its page under the slug it has now (C7: an old slug answers the new one). */
export function storeCrew(client: QueryClient, crew: Crew): void {
  client.setQueryData(crewKeys.detail(crew.slug), crew);
}

/** After a membership change: the page, its members, the own lists and every list card (its `viewer` and its count). */
function afterMembership(client: QueryClient, slug: string): void {
  void client.invalidateQueries({ queryKey: crewKeys.detail(slug) });
  void client.invalidateQueries({ queryKey: crewKeys.members(slug) });
  void client.invalidateQueries({ queryKey: crewKeys.mine });
  void client.invalidateQueries({ queryKey: crewKeys.myRequests });
  void client.invalidateQueries({ queryKey: crewKeys.lists });
  void client.invalidateQueries({ queryKey: ['crews', 'ofMember'] });
}

// -- Reads

/** CREW-00: active crews, A–Z or newest; real crews before samples (C2). Guests too. */
export function useCrewList(filters: CrewFilters, enabled: boolean = true) {
  const on = useCrewsOn();
  return useInfiniteQuery({
    queryKey: crewKeys.list(filters),
    queryFn: ({ pageParam, signal }) => crewsApi.list(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && enabled,
    retry: retryUnlessAnswered,
    placeholderData: keepPreviousData,
  });
}

/** CREW-01. A hidden/removed crew is its members' alone; for everybody else 404 crew_unavailable. */
export function useCrew(slug: string) {
  const on = useCrewsOn();
  return useQuery({
    queryKey: crewKeys.detail(slug),
    queryFn: ({ signal }) => crewsApi.detail(slug, signal),
    enabled: on && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** CREW-01 members: founder → admins → members, each by joined_at. */
export function useCrewMembers(slug: string, enabled: boolean = true) {
  const on = useCrewsOn();
  return useInfiniteQuery({
    queryKey: crewKeys.members(slug),
    queryFn: ({ pageParam, signal }) => crewsApi.members(slug, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && enabled && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** PROF-02: the member's crews (≤ 5, A–Z) with their role, for the chips. */
export function useMemberCrews(username: string | null | undefined) {
  const on = useCrewsOn();
  return useQuery({
    queryKey: crewKeys.ofMember(username ?? ''),
    queryFn: ({ signal }) => crewsApi.ofMember(username ?? '', signal),
    enabled: on && Boolean(username),
    retry: retryUnlessAnswered,
  });
}

/** CREW-04: every own crew, also hidden/removed ones, A–Z. */
export function useMyCrews(enabled: boolean = true) {
  const on = useCrewsOn();
  const mayRead = useSessionStore(selectMayReadOwned);
  return useQuery({
    queryKey: crewKeys.mine,
    queryFn: ({ signal }) => crewsApi.mine(signal),
    enabled: on && mayRead && enabled,
    retry: retryUnlessAnswered,
  });
}

/** CREW-05: the invitations waiting for the member, newest first. */
export function useMyCrewInvites(enabled: boolean = true) {
  const on = useCrewsOn();
  const mayRead = useSessionStore(selectMayReadOwned);
  return useInfiniteQuery({
    queryKey: crewKeys.myInvites,
    queryFn: ({ pageParam, signal }) => crewsApi.myInvites(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && mayRead && enabled,
    retry: retryUnlessAnswered,
  });
}

/** CREW-04: the member's own open requests. */
export function useMyCrewRequests(enabled: boolean = true) {
  const on = useCrewsOn();
  const mayRead = useSessionStore(selectMayReadOwned);
  return useInfiniteQuery({
    queryKey: crewKeys.myRequests,
    queryFn: ({ pageParam, signal }) => crewsApi.myRequests(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && mayRead && enabled,
    retry: retryUnlessAnswered,
  });
}

/** CREW-03 Anfragen (founder and admins), oldest first. */
export function useCrewRequests(slug: string, enabled: boolean = true) {
  const on = useCrewsOn();
  return useInfiniteQuery({
    queryKey: crewKeys.requests(slug),
    queryFn: ({ pageParam, signal }) => crewsApi.requests(slug, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && enabled && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** CREW-03 Einladungen (founder and admins), newest first. */
export function useCrewInvites(slug: string, enabled: boolean = true) {
  const on = useCrewsOn();
  return useInfiniteQuery({
    queryKey: crewKeys.invites(slug),
    queryFn: ({ pageParam, signal }) => crewsApi.invites(slug, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && enabled && slug !== '',
    retry: retryUnlessAnswered,
  });
}

// -- Writes

/** CREW-02 "Crew gründen" (Idempotency-Key): the member becomes the founder. */
export function useCreateCrew() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: StoreCrewBody; idempotencyKey: string }) => crewsApi.create(body, idempotencyKey),
    onSuccess: (crew) => {
      storeCrew(client, crew);
      void client.invalidateQueries({ queryKey: crewKeys.mine });
      void client.invalidateQueries({ queryKey: crewKeys.lists });
    },
  });
}

/** CREW-02 "Speichern": only the keys sent change. A rename answers the new slug. */
export function useUpdateCrew() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: UpdateCrewBody }) => crewsApi.update(slug, body),
    onSuccess: (crew, { slug }) => {
      storeCrew(client, crew);
      if (crew.slug !== slug) client.setQueryData(crewKeys.detail(slug), crew);
      void client.invalidateQueries({ queryKey: crewKeys.mine });
      void client.invalidateQueries({ queryKey: crewKeys.lists });
    },
  });
}

export function useUploadCrewMedia() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, kind, form, idempotencyKey }: { slug: string; kind: CrewMediaKind; form: FormData; idempotencyKey: string }) =>
      crewsApi.uploadMedia(slug, kind, form, idempotencyKey),
    onSuccess: (media, { slug, kind }) => {
      client.setQueryData<Crew>(crewKeys.detail(slug), (crew) => (crew ? { ...crew, [kind]: media } : crew));
      void client.invalidateQueries({ queryKey: crewKeys.detail(slug) });
      void client.invalidateQueries({ queryKey: crewKeys.lists });
      void client.invalidateQueries({ queryKey: crewKeys.mine });
    },
  });
}

export function useDeleteCrewMedia() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, kind }: { slug: string; kind: CrewMediaKind }) => crewsApi.deleteMedia(slug, kind),
    onSuccess: (_answer, { slug, kind }) => {
      client.setQueryData<Crew>(crewKeys.detail(slug), (crew) => (crew ? { ...crew, [kind]: null } : crew));
      void client.invalidateQueries({ queryKey: crewKeys.lists });
    },
  });
}

/** CREW-03 "Crew löschen" (founder; the name typed to confirm). */
export function useDeleteCrew() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, confirmName }: { slug: string; confirmName: string }) => crewsApi.remove(slug, confirmName),
    onSuccess: (_answer, { slug }) => {
      client.removeQueries({ queryKey: crewKeys.detail(slug) });
      client.removeQueries({ queryKey: crewKeys.members(slug) });
      void client.invalidateQueries({ queryKey: crewKeys.all });
    },
  });
}

/** CREW-01 "Beitreten" / "Anfrage senden" / "Einladung annehmen" (an open invite joins directly, C4). */
export function useJoinCrew() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, idempotencyKey }: { slug: string; idempotencyKey: string }) => crewsApi.join(slug, idempotencyKey),
    onSuccess: (crew, { slug }) => {
      storeCrew(client, crew);
      afterMembership(client, slug);
      void client.invalidateQueries({ queryKey: crewKeys.myInvites });
    },
  });
}

/** CREW-01 "Anfrage zurückziehen": the page shows "none" at once and goes back when the call fails. */
export function useWithdrawCrewRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => crewsApi.withdrawRequest(slug),
    onMutate: async (slug) => {
      await client.cancelQueries({ queryKey: crewKeys.detail(slug) });
      const before = client.getQueryData<Crew>(crewKeys.detail(slug));
      if (before?.viewer) {
        client.setQueryData<Crew>(crewKeys.detail(slug), {
          ...before,
          viewer: { ...before.viewer, state: 'none', request_id: null, can: { ...before.viewer.can, request: before.join_mode === 'request', join: before.join_mode === 'open' } },
        });
      }
      return { before };
    },
    onError: (_error, slug, context) => {
      if (context?.before) client.setQueryData(crewKeys.detail(slug), context.before);
    },
    onSettled: (_answer, _error, slug) => afterMembership(client, slug),
  });
}

/** CREW-01 "Verlassen" (members and admins; a founder hands over or deletes first, 409 conflict). */
export function useLeaveCrew() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => crewsApi.leave(slug),
    onSuccess: (_answer, slug) => afterMembership(client, slug),
  });
}

/** CREW-03 "Aufnehmen" (Idempotency-Key): the request leaves the list, the member joins it. */
export function useApproveCrewRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, requestId, idempotencyKey }: { slug: string; requestId: string; idempotencyKey: string }) => crewsApi.approve(slug, requestId, idempotencyKey),
    onSuccess: (_member, { slug, requestId }) => {
      client.setQueryData<InfiniteData<Page<CrewRequest>>>(crewKeys.requests(slug), (data) => withoutRow(data, requestId));
      afterMembership(client, slug);
    },
    onSettled: (_answer, _error, { slug }) => void client.invalidateQueries({ queryKey: crewKeys.requests(slug) }),
  });
}

/** CREW-03 "Ablehnen": optimistic and silent (no notification, C5). */
export function useDeclineCrewRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, requestId }: { slug: string; requestId: string }) => crewsApi.decline(slug, requestId),
    onMutate: async ({ slug, requestId }) => {
      await client.cancelQueries({ queryKey: crewKeys.requests(slug) });
      const before = client.getQueryData<InfiniteData<Page<CrewRequest>>>(crewKeys.requests(slug));
      client.setQueryData<InfiniteData<Page<CrewRequest>>>(crewKeys.requests(slug), (data) => withoutRow(data, requestId));
      return { before };
    },
    onError: (error, { slug }, context) => {
      if (context?.before && !isCrewUnavailable(error)) client.setQueryData(crewKeys.requests(slug), context.before);
    },
    onSettled: (_answer, _error, { slug }) => {
      void client.invalidateQueries({ queryKey: crewKeys.requests(slug) });
      void client.invalidateQueries({ queryKey: crewKeys.detail(slug) });
    },
  });
}

/** CREW-03 "Einladen" by username (Idempotency-Key). */
export function useInviteToCrew() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, username, idempotencyKey }: { slug: string; username: string; idempotencyKey: string }) => crewsApi.invite(slug, username, idempotencyKey),
    onSuccess: (_invite, { slug }) => {
      void client.invalidateQueries({ queryKey: crewKeys.invites(slug) });
      void client.invalidateQueries({ queryKey: crewKeys.detail(slug) });
    },
  });
}

/** CREW-03 "Zurückziehen" of an invitation: optimistic. */
export function useWithdrawCrewInvite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, inviteId }: { slug: string; inviteId: string }) => crewsApi.withdrawInvite(slug, inviteId),
    onMutate: async ({ slug, inviteId }) => {
      await client.cancelQueries({ queryKey: crewKeys.invites(slug) });
      const before = client.getQueryData<InfiniteData<Page<CrewInvite>>>(crewKeys.invites(slug));
      client.setQueryData<InfiniteData<Page<CrewInvite>>>(crewKeys.invites(slug), (data) => withoutRow(data, inviteId));
      return { before };
    },
    onError: (error, { slug }, context) => {
      if (context?.before && !isCrewUnavailable(error)) client.setQueryData(crewKeys.invites(slug), context.before);
    },
    onSettled: (_answer, _error, { slug }) => {
      void client.invalidateQueries({ queryKey: crewKeys.invites(slug) });
      void client.invalidateQueries({ queryKey: crewKeys.detail(slug) });
    },
  });
}

/** CREW-05 "Annehmen" (Idempotency-Key): joined as member; the answer is the crew. */
export function useAcceptCrewInvite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ inviteId, idempotencyKey }: { inviteId: string; idempotencyKey: string; slug?: string }) => crewsApi.acceptInvite(inviteId, idempotencyKey),
    onSuccess: (crew, { inviteId }) => {
      storeCrew(client, crew);
      client.setQueryData<InfiniteData<Page<CrewInvite>>>(crewKeys.myInvites, (data) => withoutRow(data, inviteId));
      afterMembership(client, crew.slug);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: crewKeys.myInvites }),
  });
}

/** CREW-05 "Ablehnen": optimistic and silent. */
export function useDeclineCrewInvite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ inviteId }: { inviteId: string; slug?: string }) => crewsApi.declineInvite(inviteId),
    onMutate: async ({ inviteId }) => {
      await client.cancelQueries({ queryKey: crewKeys.myInvites });
      const before = client.getQueryData<InfiniteData<Page<CrewInvite>>>(crewKeys.myInvites);
      client.setQueryData<InfiniteData<Page<CrewInvite>>>(crewKeys.myInvites, (data) => withoutRow(data, inviteId));
      return { before };
    },
    onError: (error, _variables, context) => {
      if (context?.before && !isCrewUnavailable(error)) client.setQueryData(crewKeys.myInvites, context.before);
    },
    onSettled: (_answer, _error, { slug }) => {
      void client.invalidateQueries({ queryKey: crewKeys.myInvites });
      if (slug) void client.invalidateQueries({ queryKey: crewKeys.detail(slug) });
    },
  });
}

/** An invitation that is gone (404) leaves the member's list without a call. */
export function dropMyInvite(client: QueryClient, inviteId: string): void {
  client.setQueryData<InfiniteData<Page<CrewInvite>>>(crewKeys.myInvites, (data) => withoutRow(data, inviteId));
}

/** CREW-03 "Entfernen" (founder: anyone but themselves; admin: plain members). Optimistic and silent. */
export function useRemoveCrewMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, username }: { slug: string; username: string }) => crewsApi.removeMember(slug, username),
    onMutate: async ({ slug, username }) => {
      await client.cancelQueries({ queryKey: crewKeys.members(slug) });
      const before = client.getQueryData<InfiniteData<Page<CrewMember>>>(crewKeys.members(slug));
      client.setQueryData<InfiniteData<Page<CrewMember>>>(crewKeys.members(slug), (data) => withoutMember(data, username));
      return { before };
    },
    onError: (error, { slug }, context) => {
      if (context?.before && !isCrewUnavailable(error)) client.setQueryData(crewKeys.members(slug), context.before);
    },
    onSettled: (_answer, _error, { slug }) => afterMembership(client, slug),
  });
}

/** CREW-03 "Zum Admin machen" / "Admin-Rolle entziehen" (founder). */
export function useChangeCrewRole() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, username, role }: { slug: string; username: string; role: 'admin' | 'member' }) => crewsApi.changeRole(slug, username, role),
    onSettled: (_answer, _error, { slug }) => {
      void client.invalidateQueries({ queryKey: crewKeys.members(slug) });
      void client.invalidateQueries({ queryKey: crewKeys.detail(slug) });
    },
  });
}

/** CREW-03 "Gründer-Rolle übergeben" (founder): the old founder becomes admin. */
export function useHandOverCrew() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, username }: { slug: string; username: string }) => crewsApi.handOver(slug, username),
    onSuccess: (crew, { slug }) => {
      storeCrew(client, crew);
      afterMembership(client, slug);
    },
  });
}
