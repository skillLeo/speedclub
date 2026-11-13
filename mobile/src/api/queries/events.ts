/**
 * M4.12 Events and meets in the app (09 §8.7, §7.10, ADR-437, ADR-439): EVT-01 list and map pins, EVT-02 detail, EVT-03 the
 * organiser's create/edit (POST draft → cover → submit; PATCH), EVT-04 attendees, EVT-05 my events, EVT-06 organiser updates,
 * cancel and attendee removal, and the server-side geocoder of the place step.
 *
 * Privacy the hooks keep (ADR-437 c): the exact place of an after_rsvp event only ever comes from the detail endpoint, for the
 * organiser and going members; lists and pins carry the area point. Counts are real or null (samples, 09 §8.19).
 *
 * RSVP is optimistic: the detail and every list copy of the event change at once and go back when the call fails. A pending
 * event is frozen (409 `event_in_review`, ADR-439): writes refused that way surface as `isInReview(error)`.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';

import { api, apiData, ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { retryUnlessAnswered } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

export type EventCard = components['schemas']['EventCardResource'];
export type EventDetail = components['schemas']['EventResource'];
export type EventPin = components['schemas']['EventPinResource'];
export type EventRef = components['schemas']['EventRefResource'];
export type EventType = components['schemas']['EventType'];
export type EventStatus = components['schemas']['EventStatus'];
export type EventRule = components['schemas']['EventRule'];
export type EventVisibility = components['schemas']['EventVisibility'];
export type EventLocationVisibility = components['schemas']['EventLocationVisibility'];
export type RsvpStatus = components['schemas']['RsvpStatus'];
export type RsvpAnswer = components['schemas']['RsvpRequest']['status'];
export type RsvpState = components['schemas']['EventRsvpStateResource'];
export type EventAttendee = components['schemas']['EventAttendeeResource'];
export type EventUpdate = components['schemas']['EventUpdateResource'];
export type GeocodeResult = components['schemas']['GeocodeResultResource'];
export type StoreEventBody = components['schemas']['StoreEventRequest'];
export type UpdateEventBody = components['schemas']['UpdateEventRequest'];
export type EventMedia = components['schemas']['MediaResource'];
export type EventLocation = EventCard['location'];

/** 09 §8.18: the module flag and the organiser flag (`events.create`, off until the client signs off the rules). */
export const EVENTS_FLAG = 'events';
export const EVENTS_CREATE_FLAG = 'events.create';

export const EVENT_TYPES: readonly EventType[] = ['meet', 'cruise', 'track_day', 'show'];
/** The EVT-03 checklist (EventRule), legal_only first: it is required on every event. */
export const EVENT_RULES: readonly EventRule[] = ['legal_only', 'no_racing', 'respect_residents', 'no_litter', 'permits_arranged'];
export const EVENT_WHEN = ['upcoming', 'today', 'weekend', 'month'] as const;
export type EventWhen = (typeof EVENT_WHEN)[number];
export const MY_EVENT_TABS = ['going', 'interested', 'organised', 'past'] as const;
export type MyEventsTab = (typeof MY_EVENT_TABS)[number];

/** config/speedclub.php `events.*`: the form's limits match the server's. */
export const EVENT_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  descriptionMax: 5000,
  rulesMax: 2000,
  updateMin: 2,
  updateMax: 1000,
  reasonMax: 500,
  capacityMax: 10000,
  venueMax: 120,
  streetMax: 160,
  cityMax: 80,
  maxDurationHours: 96,
  maxDaysAhead: 400,
  nearDefaultKm: 50,
  nearMaxKm: 300,
  pinsMax: 300,
} as const;

export const LIST_PAGE_SIZE = 30;
/** HOME-01 "Treffen in deiner Nähe": two cards (09 §7.3); the request asks one more so "Alle Treffen" knows there is more. */
export const HOME_EVENTS = 3;
export const ATTENDEES_PAGE_SIZE = 40;

export const EVENT_IN_REVIEW = 'event_in_review';
export const EVENT_CLOSED = 'event_closed';
export const ORGANISER_NOT_ELIGIBLE = 'organiser_not_eligible';
export const EMAIL_NOT_VERIFIED = 'email_not_verified';
export const LIMIT_REACHED = 'limit_reached';
export const GEOCODE_UNAVAILABLE = 'geocode_unavailable';

/** What EVT-01 asks: the time window, the kind, and a point with a radius ("Entfernung"). */
export type EventFilters = {
  when: EventWhen;
  type: EventType | null;
  near: { lat: number; lng: number; radiusKm: number } | null;
};

export const DEFAULT_FILTERS: EventFilters = { when: 'upcoming', type: null, near: null };

/** The map's view: minLng, minLat, maxLng, maxLat. */
export type Bbox = readonly [number, number, number, number];

export const eventKeys = {
  all: ['events'] as const,
  lists: ['events', 'list'] as const,
  list: (filters: EventFilters) => ['events', 'list', filterKey(filters)] as const,
  pins: (filters: EventFilters, bbox: Bbox | null) => ['events', 'pins', filterKey(filters), bbox ? bboxParam(bbox) : 'all'] as const,
  home: ['events', 'home'] as const,
  detail: (slug: string) => ['events', 'detail', slug] as const,
  mine: (tab: MyEventsTab) => ['events', 'mine', tab] as const,
  attendees: (slug: string, status: RsvpStatus | null) => ['events', 'attendees', slug, status ?? 'going'] as const,
  updates: (slug: string) => ['events', 'updates', slug] as const,
};

function filterKey(filters: EventFilters): string {
  const near = filters.near ? `${filters.near.lat.toFixed(2)},${filters.near.lng.toFixed(2)},${filters.near.radiusKm}` : '-';
  return `${filters.when}|${filters.type ?? '-'}|${near}`;
}

/** Five decimals at most: the map's view in metres, and a stable cache key. */
export function bboxParam(bbox: Bbox): string {
  return bbox.map((value) => Number(value.toFixed(4))).join(',');
}

/** The query of `GET events` and `GET events/pins`. */
export function listQuery(filters: EventFilters, extra: { bbox?: Bbox | null; cursor?: string | null; perPage?: number } = {}) {
  return {
    when: filters.when,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.near ? { lat: filters.near.lat, lng: filters.near.lng, radius_km: filters.near.radiusKm } : {}),
    ...(extra.bbox ? { bbox: bboxParam(extra.bbox) } : {}),
    ...(extra.perPage ? { per_page: extra.perPage } : {}),
    ...(extra.cursor ? { cursor: extra.cursor } : {}),
  };
}

export function isInReview(error: unknown): boolean {
  return error instanceof ApiError && error.code === EVENT_IN_REVIEW;
}

export function isClosed(error: unknown): boolean {
  return error instanceof ApiError && error.code === EVENT_CLOSED;
}

/** 404 `event_unavailable` or `feature_disabled`: the event is not (or no longer) there for this reader. */
export function isUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'not_found';
}

type Wrapped<T> = { data: T };
type Page<T> = { data: T[]; meta: { next_cursor: string | null } };

/** The plain calls, shared by the hooks and the tests. */
export const eventsApi = {
  async list(filters: EventFilters, cursor: string | null, perPage: number = LIST_PAGE_SIZE, signal?: AbortSignal): Promise<Page<EventCard>> {
    return apiData(api.GET('/events', { params: { query: listQuery(filters, { cursor, perPage }) }, signal }));
  },
  async pins(filters: EventFilters, bbox: Bbox | null, signal?: AbortSignal): Promise<EventPin[]> {
    return (await apiData(api.GET('/events/pins', { params: { query: listQuery(filters, { bbox }) }, signal }))).data;
  },
  async detail(slug: string, signal?: AbortSignal): Promise<EventDetail> {
    return (await apiData(api.GET('/events/{slug}', { params: { path: { slug } }, signal }))).data;
  },
  async mine(tab: MyEventsTab, cursor: string | null, signal?: AbortSignal): Promise<Page<EventCard>> {
    return apiData(api.GET('/me/events', { params: { query: { tab, per_page: LIST_PAGE_SIZE, ...(cursor ? { cursor } : {}) } }, signal }));
  },
  async attendees(slug: string, status: RsvpStatus | null, cursor: string | null, signal?: AbortSignal): Promise<Page<EventAttendee>> {
    return apiData(
      api.GET('/events/{slug}/attendees', {
        params: { path: { slug }, query: { per_page: ATTENDEES_PAGE_SIZE, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    );
  },
  async updates(slug: string, signal?: AbortSignal): Promise<EventUpdate[]> {
    return (await apiData(api.GET('/events/{slug}/updates', { params: { path: { slug } }, signal }))).data;
  },
  async create(body: StoreEventBody, idempotencyKey: string): Promise<EventDetail> {
    const answer = await apiData(api.POST('/events', { body, headers: { 'Idempotency-Key': idempotencyKey } }));
    return (answer as Wrapped<EventDetail>).data;
  },
  async update(slug: string, body: UpdateEventBody): Promise<EventDetail> {
    return (await apiData(api.PATCH('/events/{slug}', { params: { path: { slug } }, body }))).data;
  },
  async submit(slug: string): Promise<EventDetail> {
    return (await apiData(api.POST('/events/{slug}/submit', { params: { path: { slug } } }))).data;
  },
  async cancel(slug: string, reason: string): Promise<EventDetail> {
    return (await apiData(api.POST('/events/{slug}/cancel', { params: { path: { slug } }, body: { reason } }))).data;
  },
  async remove(slug: string): Promise<void> {
    await apiData(api.DELETE('/events/{slug}', { params: { path: { slug } } }));
  },
  async uploadCover(slug: string, form: FormData, idempotencyKey: string): Promise<EventMedia> {
    const answer = await apiData(
      api.POST('/events/{slug}/cover', {
        params: { path: { slug } },
        // The generated type describes the multipart field as a string; the serializer hands the FormData on as is.
        body: form as unknown as components['schemas']['StoreEventCoverRequest'],
        bodySerializer: (body) => body as unknown as FormData,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    );
    return (answer as Wrapped<EventMedia>).data;
  },
  async rsvp(slug: string, status: RsvpAnswer): Promise<RsvpState> {
    return (await apiData(api.PUT('/events/{slug}/rsvp', { params: { path: { slug } }, body: { status } }))).data;
  },
  async withdraw(slug: string): Promise<RsvpState> {
    const answer = await apiData(api.DELETE('/events/{slug}/rsvp', { params: { path: { slug } } }));
    return (answer as unknown as Wrapped<RsvpState>).data;
  },
  async postUpdate(slug: string, body: string, idempotencyKey: string): Promise<EventUpdate> {
    const answer = await apiData(
      api.POST('/events/{slug}/updates', { params: { path: { slug } }, body: { body }, headers: { 'Idempotency-Key': idempotencyKey } }),
    );
    return (answer as Wrapped<EventUpdate>).data;
  },
  async removeAttendee(slug: string, username: string): Promise<void> {
    await apiData(api.DELETE('/events/{slug}/attendees/{username}', { params: { path: { slug, username } } } as never));
  },
  async geocode(q: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
    return (await apiData(api.GET('/geocode', { params: { query: { q } }, signal }))).data;
  },
};

const nextCursor = (page: Page<unknown>) => page.meta.next_cursor ?? undefined;

/** Every card of an infinite list, de-duplicated by id (a cursor page can repeat a row that moved). */
export function flattenEvents(pages: readonly Page<EventCard>[] | undefined): EventCard[] {
  const seen = new Set<string>();
  const rows: EventCard[] = [];
  for (const page of pages ?? []) {
    for (const event of page.data) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      rows.push(event);
    }
  }
  return rows;
}

function useEventsOn(): boolean {
  return useFlag(EVENTS_FLAG);
}

/** EVT-01 Liste, DISC-01 Treffen scope. Guests too. */
export function useEventList(filters: EventFilters, enabled: boolean = true) {
  const on = useEventsOn();
  return useInfiniteQuery({
    queryKey: eventKeys.list(filters),
    queryFn: ({ pageParam, signal }) => eventsApi.list(filters, pageParam, LIST_PAGE_SIZE, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && enabled,
    retry: retryUnlessAnswered,
  });
}

/** EVT-01 Karte: the area points of the same filters inside the map's view. */
export function useEventPins(filters: EventFilters, bbox: Bbox | null, enabled: boolean = true) {
  const on = useEventsOn();
  return useQuery({
    queryKey: eventKeys.pins(filters, bbox),
    queryFn: ({ signal }) => eventsApi.pins(filters, bbox, signal),
    enabled: on && enabled,
    retry: retryUnlessAnswered,
    placeholderData: (previous) => previous,
    meta: { persist: false },
  });
}

/** HOME-01 "Treffen in deiner Nähe" (09 §7.3): the next three, near the member's region when one is known. */
export function useHomeEvents(near: EventFilters['near'] = null) {
  const on = useEventsOn();
  const filters: EventFilters = { when: 'upcoming', type: null, near };
  return useQuery({
    queryKey: [...eventKeys.home, filterKey(filters)] as const,
    queryFn: async ({ signal }) => (await eventsApi.list(filters, null, HOME_EVENTS, signal)).data,
    enabled: on,
    retry: retryUnlessAnswered,
  });
}

/** EVT-02. A draft, pending or rejected event is the organiser's alone; for everybody else 404 `event_unavailable`. */
export function useEvent(slug: string) {
  const on = useEventsOn();
  return useQuery({
    queryKey: eventKeys.detail(slug),
    queryFn: ({ signal }) => eventsApi.detail(slug, signal),
    enabled: on && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** EVT-05 Meine Treffen, one tab. */
export function useMyEvents(tab: MyEventsTab, enabled: boolean = true) {
  const on = useEventsOn();
  const mayRead = useSessionStore(selectMayReadOwned);
  return useInfiniteQuery({
    queryKey: eventKeys.mine(tab),
    queryFn: ({ pageParam, signal }) => eventsApi.mine(tab, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && mayRead && enabled,
    retry: retryUnlessAnswered,
  });
}

/** EVT-04: members only; the organiser filters by answer. */
export function useEventAttendees(slug: string, status: RsvpStatus | null, enabled: boolean = true) {
  const on = useEventsOn();
  const mayRead = useSessionStore(selectMayReadOwned);
  return useInfiniteQuery({
    queryKey: eventKeys.attendees(slug, status),
    queryFn: ({ pageParam, signal }) => eventsApi.attendees(slug, status, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && mayRead && enabled && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** EVT-02 / EVT-06 organiser updates: the organiser and members with an answer (ADR-437 e). */
export function useEventUpdates(slug: string, enabled: boolean) {
  const on = useEventsOn();
  return useQuery({
    queryKey: eventKeys.updates(slug),
    queryFn: ({ signal }) => eventsApi.updates(slug, signal),
    enabled: on && enabled && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** A changed event replaces its detail copy; the lists and my events read again. */
export function storeEvent(client: QueryClient, event: EventDetail): void {
  client.setQueryData(eventKeys.detail(event.slug), event);
  void client.invalidateQueries({ queryKey: eventKeys.lists });
  void client.invalidateQueries({ queryKey: ['events', 'pins'] });
  void client.invalidateQueries({ queryKey: eventKeys.home });
  void client.invalidateQueries({ queryKey: ['events', 'mine'] });
}

/** The fields an answer changes, in every cached copy of the event (detail, lists, Home, my events). */
type RsvpPatch = Pick<EventCard, 'my_rsvp' | 'counts' | 'spots_left'> & { waitlist_position?: number | null };

/**
 * The RSVP answer's numbers as the detail holds them: the generated type of EventRsvpStateResource reads `spots_left` as unknown and
 * `waitlist_position` as a string (Scramble's inference), while the API sends whole numbers or null.
 */
function wholeOrNull(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function patchCards(data: InfiniteData<Page<EventCard>> | undefined, id: string, patch: RsvpPatch) {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, data: page.data.map((event) => (event.id === id ? { ...event, ...withoutPosition(patch) } : event)) })),
  };
}

function withoutPosition(patch: RsvpPatch): Omit<RsvpPatch, 'waitlist_position'> {
  const { waitlist_position: _position, ...rest } = patch;
  return rest;
}

function applyRsvp(client: QueryClient, slug: string, id: string, patch: RsvpPatch): void {
  client.setQueryData<EventDetail>(eventKeys.detail(slug), (event) => (event ? { ...event, ...patch } : event));
  client.setQueriesData<InfiniteData<Page<EventCard>>>({ queryKey: eventKeys.lists }, (data) => patchCards(data, id, patch));
  client.setQueriesData<InfiniteData<Page<EventCard>>>({ queryKey: ['events', 'mine'] }, (data) => patchCards(data, id, patch));
  client.setQueriesData<EventCard[]>({ queryKey: eventKeys.home }, (rows) =>
    rows?.map((event) => (event.id === id ? { ...event, ...withoutPosition(patch) } : event)),
  );
}

/** The counts as they will be after `next`, from `before` (the optimistic guess; the server's answer replaces it). */
export function guessCounts(counts: EventCard['counts'], before: string | null, next: RsvpAnswer | null): EventCard['counts'] {
  if (!counts) return counts;
  const going = counts.going - (before === 'going' ? 1 : 0) + (next === 'going' ? 1 : 0);
  const interested = counts.interested - (before === 'interested' ? 1 : 0) + (next === 'interested' ? 1 : 0);
  return { going: Math.max(0, going), interested: Math.max(0, interested) };
}

type RsvpVariables = { event: Pick<EventDetail, 'id' | 'slug' | 'my_rsvp' | 'counts' | 'spots_left'>; status: RsvpAnswer | null };

/**
 * "Zusagen" / "Interessiert" / "Absagen" (EVT-02): optimistic in every copy; a full event puts the member on the waitlist, which only
 * the server knows, so its answer replaces the guess.
 */
export function useRsvp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ event, status }: RsvpVariables) => (status ? eventsApi.rsvp(event.slug, status) : eventsApi.withdraw(event.slug)),
    onMutate: async ({ event, status }) => {
      await client.cancelQueries({ queryKey: eventKeys.detail(event.slug) });
      const before: RsvpPatch = { my_rsvp: event.my_rsvp, counts: event.counts, spots_left: event.spots_left };
      applyRsvp(client, event.slug, event.id, { my_rsvp: status, counts: guessCounts(event.counts, event.my_rsvp, status), spots_left: event.spots_left });
      return { before };
    },
    onError: (_error, { event }, context) => {
      if (context) applyRsvp(client, event.slug, event.id, context.before);
    },
    onSuccess: (state, { event }) => {
      applyRsvp(client, event.slug, event.id, {
        my_rsvp: state.status,
        counts: state.counts,
        spots_left: wholeOrNull(state.spots_left),
        waitlist_position: wholeOrNull(state.waitlist_position),
      });
    },
    onSettled: (_data, _error, { event }) => {
      void client.invalidateQueries({ queryKey: eventKeys.detail(event.slug) });
      void client.invalidateQueries({ queryKey: ['events', 'mine'] });
      void client.invalidateQueries({ queryKey: ['events', 'attendees', event.slug] });
    },
  });
}

export type SaveEventVariables =
  | { mode: 'create'; body: StoreEventBody; idempotencyKey: string }
  | { mode: 'update'; slug: string; body: UpdateEventBody };

/** EVT-03: a new draft (with the rules accepted) or a change; the detail copy takes the answer. */
export function useSaveEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: SaveEventVariables) =>
      variables.mode === 'create' ? eventsApi.create(variables.body, variables.idempotencyKey) : eventsApi.update(variables.slug, variables.body),
    onSuccess: (event) => storeEvent(client, event),
  });
}

/** "Zur Prüfung senden" / "Veröffentlichen": the answer says which one it became (pending_review or published). */
export function useSubmitEvent() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (slug: string) => eventsApi.submit(slug), onSuccess: (event) => storeEvent(client, event) });
}

export function useUploadEventCover() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, form, idempotencyKey }: { slug: string; form: FormData; idempotencyKey: string }) => eventsApi.uploadCover(slug, form, idempotencyKey),
    onSuccess: (cover, { slug }) => {
      client.setQueryData<EventDetail>(eventKeys.detail(slug), (event) => (event ? { ...event, cover } : event));
      void client.invalidateQueries({ queryKey: eventKeys.detail(slug) });
    },
  });
}

/** EVT-06 "Treffen absagen" with the reason everybody with an answer reads. */
export function useCancelEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, reason }: { slug: string; reason: string }) => eventsApi.cancel(slug, reason),
    onSuccess: (event) => storeEvent(client, event),
  });
}

export function useDeleteEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => eventsApi.remove(slug),
    onSuccess: (_answer, slug) => {
      client.removeQueries({ queryKey: eventKeys.detail(slug) });
      void client.invalidateQueries({ queryKey: eventKeys.all });
    },
  });
}

/** EVT-06 "Update an Teilnehmende": inserted at the top of the updates when the server answers. */
export function usePostEventUpdate(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: string; idempotencyKey: string }) => eventsApi.postUpdate(slug, body, idempotencyKey),
    onSuccess: (update) => {
      client.setQueryData<EventUpdate[]>(eventKeys.updates(slug), (rows) => [update, ...(rows ?? []).filter((row) => row.id !== update.id)]);
    },
  });
}

/** EVT-06: the organiser takes a member off the list (silent for them); the list reads again. */
export function useRemoveAttendee(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => eventsApi.removeAttendee(slug, username),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['events', 'attendees', slug] });
      void client.invalidateQueries({ queryKey: eventKeys.detail(slug) });
    },
  });
}

/** EVT-03 "Ort": searched on submit only (09 §8.7), so a mutation, never a query that follows the keystrokes. */
export function useGeocode() {
  return useMutation({ mutationFn: (q: string) => eventsApi.geocode(q) });
}

/** Whether the member may see "Treffen erstellen" at all (the server still decides on eligibility: 403 with `eligible_at`). */
export function useMayOrganise(): boolean {
  const create = useFlag(EVENTS_CREATE_FLAG);
  const status = useSessionStore((state) => state.status);
  return create && status !== 'guest';
}
