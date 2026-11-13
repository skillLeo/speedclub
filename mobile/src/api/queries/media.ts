/**
 * Photo uploads of the garage (GAR-03 step 3, GAR-07, GAR-10): one multipart POST per photo through XMLHttpRequest, which
 * alone reports upload progress on native and in the browser, and which can be aborted for "Abbrechen". The credentials are
 * those of the API client (profile.ts uploadHeaders). The queue in src/state/uploads.ts decides when to send and retry.
 */
import { apiOrigin, networkError, sendsSessionCookie, toApiError } from '@/api/client';
import { uploadHeaders } from '@/api/queries/profile';
import type { components } from '@/api/schema';
import { isWeb } from '@/lib/platform';

export type UploadedMedia = components['schemas']['MediaResource'];

export type UploadTarget =
  | { kind: 'vehicle'; vehicleId: string }
  | { kind: 'mod'; vehicleId: string; modId: string }
  /** M4.11: a build update's own photos (ADR-436 d), sent after the post exists. */
  | { kind: 'update'; vehicleId: string; updateId: string };

type Answer = { status: number; body: unknown; retryAfter: string | null };

export function uploadUrl(target: UploadTarget): string {
  const base = `${apiOrigin()}/api/v1`;
  if (target.kind === 'update') return `${base}/build-updates/${target.updateId}/media`;
  return target.kind === 'vehicle' ? `${base}/vehicles/${target.vehicleId}/media` : `${base}/mods/${target.modId}/media`;
}

/** Rejects with the network ApiError when no answer came, or an AbortError when it was cancelled. */
function send(
  url: string,
  form: FormData,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const cancelled = () => {
      const error = new Error('Upload cancelled');
      error.name = 'AbortError';
      return error;
    };
    if (signal.aborted) {
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
      signal.removeEventListener('abort', abort);
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
    request.onabort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    request.send(form);
  });
}

function mediaOf(body: unknown): UploadedMedia | null {
  if (typeof body !== 'object' || body === null || !('data' in body)) return null;
  const data = (body as { data: unknown }).data;
  return typeof data === 'object' && data !== null && 'id' in data && 'variants' in data ? (data as UploadedMedia) : null;
}

function headersOf(answer: Answer): Headers {
  const headers = new Headers();
  if (answer.retryAfter) headers.set('Retry-After', answer.retryAfter);
  return headers;
}

/**
 * Sends one prepared photo. The idempotency key belongs to the queue item, so a retry after a lost answer returns the first
 * upload instead of a second photo. A stale XSRF token on web gets one more try with a fresh cookie.
 */
export async function uploadPhoto(
  target: UploadTarget,
  form: FormData,
  idempotencyKey: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<UploadedMedia> {
  const url = uploadUrl(target);
  const attempt = async (freshCsrf: boolean) =>
    send(url, form, { ...(await uploadHeaders(freshCsrf)), 'Idempotency-Key': idempotencyKey }, onProgress, signal);
  let answer = await attempt(false);
  if (answer.status === 419 && isWeb) answer = await attempt(true);
  if (answer.status >= 200 && answer.status < 300) {
    const media = mediaOf(answer.body);
    if (media) return media;
  }
  const status = answer.status >= 200 && answer.status < 300 ? 500 : answer.status;
  throw toApiError({ status, headers: headersOf(answer) }, answer.body);
}
