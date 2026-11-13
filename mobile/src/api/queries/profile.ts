/**
 * The own profile (PROF-01, PROF-03): the garage strip, the profile fields and the two profile images.
 *
 * Images go up through XMLHttpRequest instead of fetch, because only XHR reports upload progress, on native and in the
 * browser alike. It sends the same credentials as the API client, under the same rules: the Bearer token on native, the session
 * cookie and the XSRF header on web, never for a guest, and never for a member another tab has replaced (SEC-S-02). An upload
 * belongs to the session it started in, and ends with it (SEC-S-01).
 */
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api, apiData, apiOrigin, guardMemberWrite, networkError, readCookie, sendsSessionCookie, toApiError } from '@/api/client';
import { meKey, refreshMe, type Me } from '@/api/queries/auth';
import { publicIdOf, retryUnlessAnswered, usePublicViewer, type BuildUpdate } from '@/api/queries/vehicles';
import { queryClient } from '@/api/queryClient';
import type { components } from '@/api/schema';
import i18n from '@/i18n';
import { isWeb } from '@/lib/platform';
import { getSecure } from '@/lib/secure';
import { sessionSignal, useSessionStore } from '@/state/session';

export type VehicleCardData = components['schemas']['VehicleCardResource'];
export type MediaData = components['schemas']['MediaResource'];
export type ProfilePatch = components['schemas']['UpdateProfileRequest'];
export type ProfileImageSlot = 'avatar' | 'cover';
export type ProfileEvent = components['schemas']['EventCardResource'];

export const myVehiclesKey = ['me', 'vehicles'] as const;

/**
 * The member's garage, main vehicle first. One page holds all of it: a member has at most 20 vehicles and the server
 * sends 30 per page.
 */
export function useMyVehicles() {
  const signedIn = useSessionStore((state) => state.status === 'member');
  return useQuery({
    queryKey: myVehiclesKey,
    queryFn: async ({ signal }) => (await apiData(api.GET('/me/vehicles', { signal }))).data,
    enabled: signedIn,
  });
}

/** PROF-01 Treffen: the events the member said yes to (EVT-05 "Zugesagt", waitlist included), soonest first. */
export function useMyEvents(enabled: boolean = true) {
  const signedIn = useSessionStore((state) => state.status === 'member');
  return useQuery({
    queryKey: ['me', 'events', 'going'] as const,
    queryFn: async ({ signal }) =>
      (await apiData(api.GET('/me/events', { params: { query: { tab: 'going', per_page: PROFILE_EVENTS } }, signal }))).data,
    enabled: enabled && signedIn,
    retry: retryUnlessAnswered,
  });
}

/** How many events and updates the profile tabs show; the rest lives on the event list and the vehicle pages. */
export const PROFILE_EVENTS = 10;
export const PROFILE_UPDATES = 20;
/** Updates are read from this many published builds at most (main vehicle first). */
export const PROFILE_UPDATE_SOURCES = 6;

/** An update with the build it belongs to, for the profile's Updates tab. */
export type ProfileUpdate = { update: BuildUpdate; vehicle: Pick<VehicleCardData, 'id' | 'slug' | 'full_title' | 'cover'> };

/** Newest first across builds, at most `limit`. Exported for the tests. */
export function mergeProfileUpdates(lists: readonly (readonly ProfileUpdate[])[], limit: number = PROFILE_UPDATES): ProfileUpdate[] {
  const time = (entry: ProfileUpdate) => Date.parse(entry.update.created_at ?? '') || 0;
  return lists
    .flat()
    .filter((entry) => !entry.update.hidden)
    .sort((a, b) => time(b) - time(a))
    .slice(0, limit);
}

/**
 * PROF-01/02 Updates: the latest build updates of the member's published builds, newest first. There is no per-member route
 * (API gap, reported to lane B): the first page of each build's Verlauf is read, for at most PROFILE_UPDATE_SOURCES builds.
 */
export function useProfileUpdates(vehicles: readonly VehicleCardData[], enabled: boolean = true) {
  const viewer = usePublicViewer();
  const sources = vehicles.slice(0, PROFILE_UPDATE_SOURCES);
  return useQueries({
    queries: sources.map((vehicle) => ({
      queryKey: ['public-vehicle', publicIdOf(vehicle.slug), viewer, 'profile-updates'] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        (
          await apiData(
            api.GET('/public/vehicles/{slug}/updates', {
              params: { path: { slug: vehicle.slug }, query: { per_page: PROFILE_UPDATES } },
              signal,
            }),
          )
        ).data.map((update) => ({ update, vehicle }) satisfies ProfileUpdate),
      enabled,
      retry: retryUnlessAnswered,
      meta: { persist: false },
    })),
    combine: (results) => ({
      data: results.every((result) => result.data !== undefined) ? mergeProfileUpdates(results.map((result) => result.data ?? [])) : undefined,
      isPending: results.some((result) => result.isPending && result.fetchStatus !== 'idle'),
      isError: results.some((result) => result.isError),
      isPaused: results.some((result) => result.fetchStatus === 'paused'),
      isFetching: results.some((result) => result.isFetching),
      refetch: () => Promise.all(results.map((result) => result.refetch())),
    }),
  });
}

/** Only the fields sent change; null clears one (UpdateProfileRequest). */
export function useSaveProfile() {
  return useMutation({
    mutationFn: async (body: ProfilePatch) => (await apiData(api.PATCH('/me/profile', { body, signal: sessionSignal() }))).data,
    onSuccess: refreshMe,
  });
}

// -- Profile images

type UploadAnswer = { status: number; body: unknown; retryAfter: string | null };

const XSRF_COOKIE = 'XSRF-TOKEN';

function browserCookies(): string {
  return typeof document === 'undefined' ? '' : document.cookie;
}

async function fetchCsrfCookie(): Promise<void> {
  try {
    await globalThis.fetch(`${apiOrigin()}/sanctum/csrf-cookie`, { credentials: 'include' });
  } catch {
    throw networkError();
  }
}

/**
 * What the API client's middleware would add. `freshCsrf` asks for a new cookie first, after a 419. Throws, before anything is
 * sent, where the client would refuse a write: on web for a guest, and for a member whose cookie another tab has taken over.
 */
export async function uploadHeaders(freshCsrf: boolean = false): Promise<Record<string, string>> {
  guardMemberWrite();
  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': i18n.language };
  if (isWeb) {
    if (freshCsrf || readCookie(browserCookies(), XSRF_COOKIE) === null) await fetchCsrfCookie();
    const xsrf = readCookie(browserCookies(), XSRF_COOKIE);
    if (xsrf !== null) headers['X-XSRF-TOKEN'] = xsrf;
    return headers;
  }
  // A guest's app never sends a token left in the keychain (ADR-152(h)).
  if (useSessionStore.getState().status === 'guest') return headers;
  try {
    const token = await getSecure('sc.authToken');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    console.warn('Could not read the auth token');
  }
  return headers;
}

function cancelled(): Error {
  const error = new Error('Upload cancelled');
  error.name = 'AbortError';
  return error;
}

/**
 * One multipart POST with progress from 0 to 1. Rejects when no answer came, with the network ApiError, or with an AbortError when
 * `signal` ended it: the session it belongs to is over.
 */
export function postWithProgress(
  url: string,
  form: FormData,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadAnswer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open('POST', url);
    request.withCredentials = sendsSessionCookie();
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    request.onload = () => {
      signal?.removeEventListener('abort', abort);
      let body: unknown = null;
      try {
        body = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        body = null;
      }
      resolve({ status: request.status, body, retryAfter: request.getResponseHeader('Retry-After') });
    };
    request.onerror = () => reject(networkError());
    request.ontimeout = () => reject(networkError());
    request.onabort = () => reject(signal?.aborted ? cancelled() : networkError());
    signal?.addEventListener('abort', abort, { once: true });
    request.send(form);
  });
}

function answerHeaders(answer: UploadAnswer): Headers {
  const headers = new Headers();
  if (answer.retryAfter) headers.set('Retry-After', answer.retryAfter);
  return headers;
}

function meOf(body: unknown): Me | null {
  if (typeof body !== 'object' || body === null || !('data' in body)) return null;
  const data = (body as { data: unknown }).data;
  return typeof data === 'object' && data !== null && 'id' in data ? (data as Me) : null;
}

/**
 * Replaces the avatar or the cover. The same idempotency key makes a retry safe. A lost session or a demanded password
 * change is passed on to the session lifecycle through the next auth/me, which the API client reports.
 */
export async function uploadProfileImage(
  slot: ProfileImageSlot,
  form: FormData,
  idempotencyKey: string,
  onProgress: (fraction: number) => void,
): Promise<Me> {
  const url = `${apiOrigin()}/api/v1/me/${slot}`;
  // The session this upload starts in: its end aborts the upload, and a later session does not inherit it.
  const signal = sessionSignal();
  const send = async (freshCsrf: boolean) =>
    postWithProgress(url, form, { ...(await uploadHeaders(freshCsrf)), 'Idempotency-Key': idempotencyKey }, onProgress, signal);
  let answer = await send(false);
  // A stale XSRF token: one more try with a new cookie, as the API client does.
  if (answer.status === 419 && isWeb) answer = await send(true);
  if (answer.status >= 200 && answer.status < 300) {
    const me = meOf(answer.body);
    if (me) return me;
  }
  if (answer.status === 401 || answer.status === 403) void queryClient.invalidateQueries({ queryKey: meKey });
  throw toApiError({ status: answer.status >= 200 && answer.status < 300 ? 500 : answer.status, headers: answerHeaders(answer) }, answer.body);
}

/** An upload with its progress, null while nothing is on the way. */
export function useUploadProfileImage(slot: ProfileImageSlot) {
  const [progress, setProgress] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: async ({ form, idempotencyKey }: { form: FormData; idempotencyKey: string }) => {
      setProgress(0);
      try {
        return await uploadProfileImage(slot, form, idempotencyKey, setProgress);
      } finally {
        setProgress(null);
      }
    },
    onSuccess: refreshMe,
  });
  return { ...mutation, progress };
}
