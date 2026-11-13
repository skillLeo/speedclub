/**
 * M4.14 Business profiles in the app (09 §8.10, §7.11, ADR-414, ADR-455): BIZ-01 Betriebsprofil (`businesses/{slug}` and its portfolio),
 * the Betriebe scope of Entdecken (`businesses?q…`), BIZ-02 Bewerbung and status, BIZ-03 Betriebs-Dashboard (`me/business`, team, logo
 * and cover), BIZ-04 Anfragen (`me/business/tag-requests`) and the build owner's side of "Eingebaut von" (`mods/{id}/business-tag`,
 * `me/mod-tags`).
 *
 * Portfolio tags need both sides (double confirmation): whoever starts a tag waits for the other side; only an accepted tag reaches the
 * business page and the mod's public face. Every hook waits for the flag `businesses` (404 feature_disabled while it is off).
 */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { api, apiData, ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import type { FeedVehicle } from '@/api/queries/home';
import { modKeys } from '@/api/queries/mods';
import { retryUnlessAnswered } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

export type BusinessCardData = components['schemas']['BusinessCardResource'];
export type BusinessDetail = components['schemas']['BusinessResource'];
export type MyBusiness = components['schemas']['MyBusinessResource'];
export type BusinessKind = components['schemas']['BusinessKind'];
export type BusinessLegalForm = components['schemas']['BusinessLegalForm'];
export type BusinessStatus = components['schemas']['BusinessStatus'];
export type BusinessRole = components['schemas']['BusinessRole'];
export type ModTag = components['schemas']['ModTagResource'];
export type ModTagStatus = components['schemas']['ModTagStatus'];
export type StoreBusinessBody = components['schemas']['StoreBusinessRequest'];
export type UpdateBusinessBody = components['schemas']['UpdateBusinessRequest'];
export type BusinessMedia = components['schemas']['MediaResource'];
export type Impressum = BusinessDetail['impressum'];
export type OpeningDay = BusinessDetail['opening_hours'][number];

/** 09 §8.18: the module flag (off until the M4.14 design QA passed, ADR-455). */
export const BUSINESSES_FLAG = 'businesses';

export const BUSINESS_KINDS: readonly BusinessKind[] = ['workshop', 'tuner', 'detailing', 'wrapping', 'paint', 'dealer', 'parts_shop', 'other'];
export const LEGAL_FORMS: readonly BusinessLegalForm[] = ['sole_trader', 'ek', 'gbr', 'ohg', 'kg', 'gmbh', 'gmbh_co_kg', 'ug', 'ag', 'other'];
/** BusinessImpressum::needsRegister: every form but the sole trader, the GbR and "other" has a register entry. */
export const LEGAL_FORMS_WITHOUT_REGISTER: ReadonlySet<BusinessLegalForm> = new Set(['sole_trader', 'gbr', 'other']);
export const COUNTRIES = ['DE', 'AT', 'CH', 'LU', 'NL', 'BE', 'DK', 'PL', 'CZ', 'FR'] as const;
export type BusinessCountry = (typeof COUNTRIES)[number];

/** BusinessDetailsRules and config/speedclub.php `businesses.*`: the form's limits match the server's. */
export const BUSINESS_LIMITS = {
  nameMin: 2,
  nameMax: 120,
  legalNameMin: 2,
  legalNameMax: 160,
  representativeMin: 3,
  representativeMax: 160,
  streetMin: 3,
  streetMax: 160,
  cityMin: 2,
  cityMax: 80,
  emailMax: 160,
  websiteMax: 300,
  registerCourtMax: 120,
  registerNumberMax: 60,
  aboutMax: 2000,
  serviceMin: 2,
  serviceMax: 40,
  servicesMax: 12,
  documentNoteMax: 1000,
  staffMax: 10,
} as const;

export const BUSINESS_CODES = {
  unavailable: 'business_unavailable',
  exists: 'business_exists',
  notVerified: 'business_not_verified',
  emailNotVerified: 'email_not_verified',
  limitReached: 'limit_reached',
  conflict: 'conflict',
} as const;

export const LIST_PAGE_SIZE = 20;
export const PORTFOLIO_PAGE_SIZE = 12;
export const TAGS_PAGE_SIZE = 30;
/** The business picker of "Eingebaut von": the first matches as the member types. */
export const PICKER_SIZE = 8;

type Page<T> = { data: T[]; meta: { next_cursor: string | null } };
type Wrapped<T> = { data: T };

export type BusinessFilters = { q: string; kind: BusinessKind | null; near: { lat: number; lng: number; radiusKm: number } | null };
export const DEFAULT_BUSINESS_FILTERS: BusinessFilters = { q: '', kind: null, near: null };

export type TagDirection = 'incoming' | 'outgoing';

export const businessKeys = {
  all: ['businesses'] as const,
  lists: ['businesses', 'list'] as const,
  list: (filters: BusinessFilters) =>
    ['businesses', 'list', filters.q, filters.kind ?? '-', filters.near ? `${filters.near.lat.toFixed(2)},${filters.near.lng.toFixed(2)},${filters.near.radiusKm}` : '-'] as const,
  picker: (q: string) => ['businesses', 'picker', q] as const,
  detail: (slug: string) => ['businesses', 'detail', slug] as const,
  portfolio: (slug: string) => ['businesses', 'portfolio', slug] as const,
  mine: ['businesses', 'mine'] as const,
  tags: ['businesses', 'tags'] as const,
  tagList: (direction: TagDirection, status: ModTagStatus) => ['businesses', 'tags', direction, status] as const,
  modTags: ['businesses', 'modTags'] as const,
  modTagList: (direction: TagDirection, status: ModTagStatus) => ['businesses', 'modTags', direction, status] as const,
};

/** The plain calls, shared by the hooks and the tests. */
export const businessesApi = {
  async list(filters: BusinessFilters, cursor: string | null, perPage: number = LIST_PAGE_SIZE, signal?: AbortSignal): Promise<Page<BusinessCardData>> {
    return apiData(
      api.GET('/businesses', {
        params: {
          query: {
            per_page: perPage,
            // BusinessListRequest: q has at least 2 characters; a shorter text lists every business.
            ...(filters.q.trim().length >= 2 ? { q: filters.q.trim() } : {}),
            ...(filters.kind ? { kind: filters.kind } : {}),
            ...(filters.near ? { lat: filters.near.lat, lng: filters.near.lng, radius_km: filters.near.radiusKm } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
        signal,
      }),
    );
  },
  async detail(slug: string, signal?: AbortSignal): Promise<BusinessDetail> {
    return (await apiData(api.GET('/businesses/{slug}', { params: { path: { slug } }, signal }))).data;
  },
  async portfolio(slug: string, cursor: string | null, signal?: AbortSignal): Promise<Page<FeedVehicle>> {
    return apiData(
      api.GET('/businesses/{slug}/portfolio', {
        params: { path: { slug }, query: { per_page: PORTFOLIO_PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    );
  },
  async mine(signal?: AbortSignal): Promise<MyBusiness> {
    return (await apiData(api.GET('/me/business', { signal }))).data;
  },
  async apply(body: StoreBusinessBody, idempotencyKey: string): Promise<MyBusiness> {
    const answer = await apiData(api.POST('/me/business', { body, headers: { 'Idempotency-Key': idempotencyKey } }));
    return (answer as Wrapped<MyBusiness>).data;
  },
  async update(body: UpdateBusinessBody): Promise<MyBusiness> {
    return (await apiData(api.PATCH('/me/business', { body }))).data;
  },
  async submit(): Promise<MyBusiness> {
    const answer = await apiData(api.POST('/me/business/submit', {}));
    return (answer as Wrapped<MyBusiness>).data;
  },
  async withdraw(): Promise<void> {
    await apiData(api.DELETE('/me/business', {}));
  },
  async upload(kind: 'logo' | 'cover', form: FormData, idempotencyKey: string): Promise<BusinessMedia> {
    const options = {
      // The generated type describes the multipart field as a string; the serializer hands the FormData on as is.
      body: form as unknown as components['schemas']['BusinessMediaRequest'],
      bodySerializer: (body: unknown) => body as FormData,
      headers: { 'Idempotency-Key': idempotencyKey },
    };
    const answer = await apiData(kind === 'logo' ? api.POST('/me/business/logo', options) : api.POST('/me/business/cover', options));
    return (answer as Wrapped<BusinessMedia>).data;
  },
  async addMember(username: string, idempotencyKey: string): Promise<MyBusiness> {
    const answer = await apiData(api.POST('/me/business/members', { body: { username }, headers: { 'Idempotency-Key': idempotencyKey } }));
    return (answer as Wrapped<MyBusiness>).data;
  },
  async removeMember(username: string): Promise<void> {
    await apiData(api.DELETE('/me/business/members/{username}', { params: { path: { username } } }));
  },
  async tags(direction: TagDirection, status: ModTagStatus, cursor: string | null, signal?: AbortSignal): Promise<Page<ModTag>> {
    return apiData(
      api.GET('/me/business/tag-requests', {
        params: { query: { direction, status, per_page: TAGS_PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    );
  },
  async decideTag(tagId: string, decision: 'accepted' | 'declined'): Promise<ModTag> {
    return (await apiData(api.PATCH('/me/business/tag-requests/{tag}', { params: { path: { tag: tagId } }, body: { decision } }))).data;
  },
  async removeTag(tagId: string): Promise<void> {
    await apiData(api.DELETE('/me/business/tag-requests/{tag}', { params: { path: { tag: tagId } } }));
  },
  async proposeTag(modId: string, idempotencyKey: string): Promise<ModTag> {
    const answer = await apiData(api.POST('/me/business/tag-requests', { body: { mod_id: modId }, headers: { 'Idempotency-Key': idempotencyKey } }));
    return (answer as Wrapped<ModTag>).data;
  },
  async tagMod(modId: string, business: string): Promise<ModTag> {
    const answer = await apiData(api.PUT('/mods/{modification}/business-tag', { params: { path: { modification: modId } }, body: { business } }));
    return (answer as Wrapped<ModTag>).data;
  },
  async untagMod(modId: string): Promise<void> {
    await apiData(api.DELETE('/mods/{modification}/business-tag', { params: { path: { modification: modId } } }));
  },
  async modTags(direction: TagDirection, status: ModTagStatus, cursor: string | null, signal?: AbortSignal): Promise<Page<ModTag>> {
    return apiData(
      api.GET('/me/mod-tags', {
        params: { query: { direction, status, per_page: TAGS_PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    );
  },
  async decideModTag(tagId: string, decision: 'accepted' | 'declined'): Promise<ModTag> {
    return (await apiData(api.PATCH('/me/mod-tags/{tag}', { params: { path: { tag: tagId } }, body: { decision } }))).data;
  },
};

/** 404 `business_unavailable` (none, or one the reader may not see) and `feature_disabled`. */
export function isBusinessUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'not_found';
}

/** GET me/business answers 404 business_unavailable while the member has none: BIZ-02 then offers the application. */
export function hasNoBusiness(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === BUSINESS_CODES.unavailable;
}

export function isCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}

const nextCursor = (page: Page<unknown>) => page.meta.next_cursor ?? undefined;

export function useBusinessesOn(): boolean {
  return useFlag(BUSINESSES_FLAG);
}

/** Entdecken › Betriebe: verified businesses by name, the distance when a point is known. Guests too. */
export function useBusinessList(filters: BusinessFilters, enabled: boolean = true) {
  const on = useBusinessesOn();
  return useInfiniteQuery({
    queryKey: businessKeys.list(filters),
    queryFn: ({ pageParam, signal }) => businessesApi.list(filters, pageParam, LIST_PAGE_SIZE, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && enabled,
    retry: retryUnlessAnswered,
    placeholderData: keepPreviousData,
  });
}

/** GAR-10 "Eingebaut von": the business picker's matches for what the member types. */
export function useBusinessPicker(q: string, enabled: boolean = true) {
  const on = useBusinessesOn();
  return useQuery({
    queryKey: businessKeys.picker(q),
    queryFn: async ({ signal }) => (await businessesApi.list({ ...DEFAULT_BUSINESS_FILTERS, q }, null, PICKER_SIZE, signal)).data,
    enabled: on && enabled,
    retry: retryUnlessAnswered,
    placeholderData: keepPreviousData,
    meta: { persist: false },
  });
}

/** BIZ-01. A business that is not verified is its team's alone; for everybody else 404 business_unavailable. */
export function useBusiness(slug: string) {
  const on = useBusinessesOn();
  return useQuery({
    queryKey: businessKeys.detail(slug),
    queryFn: ({ signal }) => businessesApi.detail(slug, signal),
    enabled: on && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** BIZ-01 "Builds aus unserer Werkstatt": only builds whose tag both sides confirmed. */
export function usePortfolio(slug: string, enabled: boolean = true) {
  const on = useBusinessesOn();
  return useInfiniteQuery({
    queryKey: businessKeys.portfolio(slug),
    queryFn: ({ pageParam, signal }) => businessesApi.portfolio(slug, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && enabled && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** BIZ-02 status and BIZ-03: the member's own business (404 business_unavailable while there is none). */
export function useMyBusiness(enabled: boolean = true) {
  const on = useBusinessesOn();
  const mayRead = useSessionStore(selectMayReadOwned);
  return useQuery({
    queryKey: businessKeys.mine,
    queryFn: ({ signal }) => businessesApi.mine(signal),
    enabled: on && mayRead && enabled,
    retry: retryUnlessAnswered,
  });
}

/** BIZ-04 / BIZ-03: the business's tags of one direction and status. */
export function useBusinessTags(direction: TagDirection, status: ModTagStatus, enabled: boolean = true) {
  const on = useBusinessesOn();
  const mayRead = useSessionStore(selectMayReadOwned);
  return useInfiniteQuery({
    queryKey: businessKeys.tagList(direction, status),
    queryFn: ({ pageParam, signal }) => businessesApi.tags(direction, status, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && mayRead && enabled,
    retry: retryUnlessAnswered,
  });
}

/** Every row of the tag pages once, newest first as the API sends them. */
export function flattenTags(pages: readonly Page<ModTag>[] | undefined): ModTag[] {
  const seen = new Set<string>();
  const rows: ModTag[] = [];
  for (const page of pages ?? []) {
    for (const tag of page.data) {
      if (seen.has(tag.id)) continue;
      seen.add(tag.id);
      rows.push(tag);
    }
  }
  return rows;
}

/** A changed business replaces its copies (own, public); lists read again. */
export function storeMyBusiness(client: QueryClient, business: MyBusiness): void {
  client.setQueryData(businessKeys.mine, business);
  void client.invalidateQueries({ queryKey: businessKeys.detail(business.slug) });
  void client.invalidateQueries({ queryKey: businessKeys.lists });
}

export type SaveBusinessVariables =
  | { mode: 'apply'; body: StoreBusinessBody; idempotencyKey: string }
  | { mode: 'update'; body: UpdateBusinessBody };

/** BIZ-02: apply (POST, Idempotency-Key) or change (PATCH, only the keys sent). */
export function useSaveBusiness() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: SaveBusinessVariables) =>
      variables.mode === 'apply' ? businessesApi.apply(variables.body, variables.idempotencyKey) : businessesApi.update(variables.body),
    onSuccess: (business) => storeMyBusiness(client, business),
  });
}

/** BIZ-02 status "Erneut senden" after a rejection. */
export function useSubmitBusiness() {
  const client = useQueryClient();
  return useMutation({ mutationFn: () => businessesApi.submit(), onSuccess: (business) => storeMyBusiness(client, business) });
}

/** BIZ-02 status "Bewerbung zurückziehen" (applied or rejected only). */
export function useWithdrawBusiness() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => businessesApi.withdraw(),
    onSuccess: () => {
      client.removeQueries({ queryKey: businessKeys.mine });
      void client.invalidateQueries({ queryKey: businessKeys.all });
    },
  });
}

/** Logo (square, 56) or cover (16:9): the own copy takes the new media at once. */
export function useUploadBusinessMedia() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, form, idempotencyKey }: { kind: 'logo' | 'cover'; form: FormData; idempotencyKey: string }) =>
      businessesApi.upload(kind, form, idempotencyKey),
    onSuccess: (media, { kind }) => {
      client.setQueryData<MyBusiness>(businessKeys.mine, (business) => (business ? { ...business, [kind]: media } : business));
      void client.invalidateQueries({ queryKey: businessKeys.mine });
    },
  });
}

/** BIZ-03 Team: the owner adds @username as staff; the answer is the business with its team. */
export function useAddTeamMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ username, idempotencyKey }: { username: string; idempotencyKey: string }) => businessesApi.addMember(username, idempotencyKey),
    onSuccess: (business) => client.setQueryData(businessKeys.mine, business),
  });
}

/** BIZ-03 Team: the owner removes staff, staff leave. Optimistic: the row goes at once and comes back when the call fails. */
export function useRemoveTeamMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => businessesApi.removeMember(username),
    onMutate: async (username) => {
      await client.cancelQueries({ queryKey: businessKeys.mine });
      const before = client.getQueryData<MyBusiness>(businessKeys.mine);
      client.setQueryData<MyBusiness>(businessKeys.mine, (business) =>
        business ? { ...business, team: business.team.filter((member) => member.username?.toLowerCase() !== username.toLowerCase()) } : business,
      );
      return { before };
    },
    onError: (_error, _username, context) => {
      if (context?.before) client.setQueryData(businessKeys.mine, context.before);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: businessKeys.mine }),
  });
}

function withoutTag(data: InfiniteData<Page<ModTag>> | undefined, tagId: string): InfiniteData<Page<ModTag>> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, data: page.data.filter((tag) => tag.id !== tagId) })) };
}

/** After a decision the tag lists, the own business (pending badge, portfolio count) and the portfolio read again. */
function afterTagChange(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: businessKeys.tags });
  void client.invalidateQueries({ queryKey: businessKeys.mine });
  void client.invalidateQueries({ queryKey: ['businesses', 'portfolio'] });
  void client.invalidateQueries({ queryKey: ['businesses', 'detail'] });
}

/**
 * BIZ-04 "Annehmen" / "Ablehnen". The screen holds the call back for the undo toast (SM20, collections/deferred.ts); this sends it.
 * The row leaves the pending list at once, so a refetch in between cannot show it twice.
 */
export function useDecideBusinessTag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ tagId, decision }: { tagId: string; decision: 'accepted' | 'declined' }) => businessesApi.decideTag(tagId, decision),
    onMutate: ({ tagId }) => {
      client.setQueriesData<InfiniteData<Page<ModTag>>>({ queryKey: businessKeys.tags }, (data) => withoutTag(data, tagId));
    },
    onSettled: () => afterTagChange(client),
  });
}

/** BIZ-03 Portfolio "Entfernen" / a proposal withdrawn: the build leaves the portfolio. */
export function useRemoveBusinessTag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) => businessesApi.removeTag(tagId),
    onMutate: (tagId) => {
      client.setQueriesData<InfiniteData<Page<ModTag>>>({ queryKey: businessKeys.tags }, (data) => withoutTag(data, tagId));
    },
    onSettled: () => afterTagChange(client),
  });
}

/** BIZ-03 "Build markieren": the business names a mod it built; the owner confirms. */
export function useProposeBusinessTag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ modId, idempotencyKey }: { modId: string; idempotencyKey: string }) => businessesApi.proposeTag(modId, idempotencyKey),
    onSettled: () => afterTagChange(client),
  });
}

/** The mod's copies that carry `business_tag` (GAR-10's owner mod, VEH-02's public mod) read again after a change. */
function afterModTag(client: QueryClient, modId: string): void {
  void client.invalidateQueries({ queryKey: businessKeys.modTags });
  void client.invalidateQueries({ queryKey: modKeys.mod(modId) });
  void client.invalidateQueries({ queryKey: ['public-vehicle'] });
}

/** GAR-10 "Eingebaut von": the owner names the business (its slug); the business confirms (or it confirms a waiting proposal at once). */
export function useTagModBusiness() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ modId, business }: { modId: string; business: string }) => businessesApi.tagMod(modId, business),
    onSettled: (_data, _error, { modId }) => afterModTag(client, modId),
  });
}

/** GAR-10 / VEH-02 "Entfernen": the tag goes (also declining a pending proposal); the portfolio loses the build. */
export function useUntagModBusiness() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (modId: string) => businessesApi.untagMod(modId), onSettled: (_data, _error, modId) => afterModTag(client, modId) });
}

/** The owner's answer to a business's proposal ("Bestätigen" / "Ablehnen") on GAR-10 and VEH-02. */
export function useDecideModTag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ tagId, decision }: { tagId: string; modId: string; decision: 'accepted' | 'declined' }) => businessesApi.decideModTag(tagId, decision),
    onSettled: (_data, _error, { modId }) => {
      afterModTag(client, modId);
      void client.invalidateQueries({ queryKey: ['businesses', 'portfolio'] });
    },
  });
}

/** Whether the member may see "Für Betriebe" at all: signed in, the flag on. */
export function useMayApply(): boolean {
  const on = useBusinessesOn();
  const status = useSessionStore((state) => state.status);
  return on && status === 'member';
}
