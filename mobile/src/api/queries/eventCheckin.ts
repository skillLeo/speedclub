/**
 * M5.6 check-in at the event (10 §4; server contract docs/reports/phase-5/m5.6-contract.md §5), behind the flag `events.checkin`
 * (off by default). The organiser shows a rotating six-character code as a QR on their phone (EVT-06); a member scans it with the
 * camera (it is a link to EVT-07) or types it on EVT-02, and gets "War dabei" on their profile. No location is read or sent: being
 * in front of the organiser is the proof. Check-ins reach a profile only after the event has ended (never live, 10 §16).
 *
 * Typed by the generated schema (CheckinCodeResource, CheckinResource, EventCheckinCardResource, EventResource.checkin) and called
 * through the typed client.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiData, ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { EVENTS_CHECKIN_FLAG, EVENTS_FLAG, eventKeys, type EventDetail } from '@/api/queries/events';
import type { components } from '@/api/schema';
import { retryUnlessAnswered } from '@/api/queries/vehicles';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

/** The reader's own check-in (`checkin.mine`); `checked_in_at` is nullable in the generated schema, a set one is required here. */
export type CheckinState = { checked_in_at: string; profile_visible: boolean };

/**
 * EventResource.checkin (contract §5.2; absent while the flag is off, for samples and unpublished events), as the screens read it: a
 * `mine` without its time counts as no check-in.
 */
export type EventCheckinInfo = Omit<NonNullable<EventDetail['checkin']>, 'mine'> & { mine: CheckinState | null };

/** `GET events/{slug}/checkin-code` `data` (contract §5.3); `svg` is the QR of `url`, drawn by the server. */
export type CheckinCode = components['schemas']['CheckinCodeResource'];

/** An EVT-07 / EVT-02 check-in answer. */
export type CheckinAnswer = components['schemas']['CheckinResource'];

/** A row of `GET me/checkins`. */
export type EventCheckinCard = components['schemas']['EventCheckinCardResource'];

export const CHECKIN_CODE_INVALID = 'checkin_code_invalid';
export const CHECKIN_CLOSED = 'checkin_closed';
export const CHECKIN_OWN_EVENT = 'checkin_own_event';
/** The code's alphabet (contract §5.1): no 0/O/1/I/L, six characters. */
export const CHECKIN_CODE_LENGTH = 6;
const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
/** The code is asked again this long before `refresh_at` at the latest, and never more often than this. */
const MIN_REFRESH_MS = 5_000;
const MAX_REFRESH_MS = 60_000;

type Page<T> = { data: T[]; meta: { next_cursor: string | null } };

/** What a member typed or the link carried, as the server compares it: capitals, no spaces or dashes. Null when it cannot be a code. */
export function normaliseCheckinCode(input: string | null | undefined): string | null {
  const code = (input ?? '').toUpperCase().replace(/[\s-]/g, '');
  return CODE_PATTERN.test(code) ? code : null;
}

/** "ABC DEF": the code in two groups of three, as the organiser reads it out. */
export function groupCheckinCode(code: string): string {
  return code.length === CHECKIN_CODE_LENGTH ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** The detail's `checkin` (absent while the flag is off); a `mine` without its time counts as no check-in. */
export function checkinOf(event: Pick<EventDetail, 'checkin'>): EventCheckinInfo | null {
  const info = event.checkin;
  if (!info) return null;
  const at = info.mine?.checked_in_at ?? null;
  return { ...info, mine: info.mine && at ? { checked_in_at: at, profile_visible: info.mine.profile_visible } : null };
}

export function canCheckin(event: Pick<EventDetail, 'can'>): boolean {
  return event.can.checkin === true;
}

export function canShowCheckinCode(event: Pick<EventDetail, 'can'>): boolean {
  return event.can.show_checkin_code === true;
}

/** How long the organiser's code stays on screen before it is asked again (its `refresh_at`, within 5 s … 60 s). */
export function refreshDelay(code: Pick<CheckinCode, 'refresh_at'> | undefined, now: number): number {
  if (!code) return MAX_REFRESH_MS;
  const at = Date.parse(code.refresh_at);
  if (!Number.isFinite(at)) return MAX_REFRESH_MS;
  return Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, at - now));
}

export const checkinKeys = {
  code: (slug: string) => ['events', 'checkin', 'code', slug] as const,
  mine: ['events', 'checkin', 'mine'] as const,
};

export const checkinApi = {
  async code(slug: string, signal?: AbortSignal): Promise<CheckinCode> {
    return (await apiData(api.GET('/events/{slug}/checkin-code', { params: { path: { slug } }, signal }))).data;
  },
  async checkIn(slug: string, code: string, profileVisible: boolean, idempotencyKey: string): Promise<CheckinAnswer> {
    const answer = await apiData(
      api.POST('/events/{slug}/checkin', {
        params: { path: { slug } },
        body: { code, profile_visible: profileVisible },
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    );
    // TODO(api:types): the export types the 201 answer of `POST events/{slug}/checkin` as a bare string; the server answers
    // `{ data: CheckinResource }` (and 200 with the same body when already checked in), as the PATCH beside it is typed.
    return (answer as unknown as { data: CheckinAnswer }).data;
  },
  async visibility(slug: string, profileVisible: boolean): Promise<CheckinAnswer> {
    return (await apiData(api.PATCH('/events/{slug}/checkin', { params: { path: { slug } }, body: { profile_visible: profileVisible } }))).data;
  },
  async remove(slug: string): Promise<void> {
    await apiData(api.DELETE('/events/{slug}/checkin', { params: { path: { slug } } }));
  },
  async mine(cursor: string | null, signal?: AbortSignal): Promise<Page<EventCheckinCard>> {
    return apiData(api.GET('/me/checkins', { params: { query: { per_page: 20, ...(cursor ? { cursor } : {}) } }, signal }));
  },
};

/** Whether check-in exists for this reader: both flags on (the detail field says the rest). */
export function useCheckinEnabled(): boolean {
  const events = useFlag(EVENTS_FLAG);
  const checkin = useFlag(EVENTS_CHECKIN_FLAG);
  return events && checkin;
}

/** EVT-06 "Check-in-Code zeigen": the current code, asked again shortly before it rotates while the sheet is open. */
export function useCheckinCode(slug: string, enabled: boolean) {
  const on = useCheckinEnabled();
  return useQuery({
    queryKey: checkinKeys.code(slug),
    queryFn: ({ signal }) => checkinApi.code(slug, signal),
    enabled: on && enabled && slug !== '',
    retry: retryUnlessAnswered,
    refetchInterval: (query) => refreshDelay(query.state.data, Date.now()),
    refetchIntervalInBackground: false,
    meta: { persist: false },
  });
}

/** The detail's `checkin.mine`, set from an answer (or cleared). */
function patchMine(client: ReturnType<typeof useQueryClient>, slug: string, mine: CheckinState | null): void {
  client.setQueryData<EventDetail>(eventKeys.detail(slug), (event) => {
    if (!event) return event;
    const info = checkinOf(event);
    if (!info) return event;
    return { ...event, checkin: { ...info, mine }, can: { ...event.can, checkin: mine === null && info.open } };
  });
}

/** "Einchecken" (EVT-02 sheet, EVT-07): the answer is the state; already checked in answers 200 with the same body. */
export function useCheckIn(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ code, profileVisible, idempotencyKey }: { code: string; profileVisible: boolean; idempotencyKey: string }) =>
      checkinApi.checkIn(slug, code, profileVisible, idempotencyKey),
    onSuccess: (answer) => {
      patchMine(client, slug, { checked_in_at: answer.checked_in_at, profile_visible: answer.profile_visible });
      void client.invalidateQueries({ queryKey: checkinKeys.mine });
    },
    onSettled: () => void client.invalidateQueries({ queryKey: eventKeys.detail(slug) }),
  });
}

/** "Auf meinem Profil zeigen": optimistic, back when the call fails. */
export function useCheckinVisibility(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (profileVisible: boolean) => checkinApi.visibility(slug, profileVisible),
    onMutate: (profileVisible) => {
      const event = client.getQueryData<EventDetail>(eventKeys.detail(slug));
      const before = event ? (checkinOf(event)?.mine ?? null) : null;
      if (before) patchMine(client, slug, { ...before, profile_visible: profileVisible });
      return { before };
    },
    onError: (_error, _value, context) => {
      if (context?.before) patchMine(client, slug, context.before);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: checkinKeys.mine }),
  });
}

/** "Check-in entfernen": "War dabei" leaves the profile. */
export function useRemoveCheckin(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => checkinApi.remove(slug),
    onSuccess: () => {
      patchMine(client, slug, null);
      void client.invalidateQueries({ queryKey: checkinKeys.mine });
    },
    onSettled: () => void client.invalidateQueries({ queryKey: eventKeys.detail(slug) }),
  });
}

/** PROF-01 Treffen "War dabei": the member's own check-ins, newest first. */
export function useMyCheckins(enabled: boolean = true) {
  const on = useCheckinEnabled();
  const mayRead = useSessionStore(selectMayReadOwned);
  return useInfiniteQuery({
    queryKey: checkinKeys.mine,
    queryFn: ({ pageParam, signal }) => checkinApi.mine(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    enabled: on && mayRead && enabled,
    retry: retryUnlessAnswered,
  });
}

/** The words for a refused check-in: a wrong code goes to the field, a closed window or the organiser's own event to the notice. */
export function checkinRefusal(error: unknown): 'code' | 'closed' | 'own' | 'rateLimited' | 'other' {
  if (!(error instanceof ApiError)) return 'other';
  if (error.code === CHECKIN_CODE_INVALID || error.fieldErrors.code?.[0]) return 'code';
  if (error.code === CHECKIN_CLOSED) return 'closed';
  if (error.code === CHECKIN_OWN_EVENT) return 'own';
  if (error.kind === 'rate_limited') return 'rateLimited';
  return 'other';
}
