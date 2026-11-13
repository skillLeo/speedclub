/**
 * M4.6: the fields some error bodies add beside `message`, `errors` and `code` (attempts_left, retry_after, methods). ApiError keeps
 * only the common ones, so the calls that need more go through `apiDetailed`, which remembers the body of the error it throws.
 */
import { ApiError, apiData, networkError, toApiError } from '@/api/client';

type ApiResult<T> = { data?: T; error?: unknown; response: Response };

const bodies = new WeakMap<ApiError, Record<string, unknown>>();

/** As apiData, and the error body stays readable through `errorDetail`. */
export async function apiDetailed<T>(call: Promise<ApiResult<T>>): Promise<T> {
  let result: ApiResult<T>;
  try {
    result = await call;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if (error instanceof ApiError) throw error;
    throw networkError();
  }
  if (!result.response.ok) {
    const error = toApiError(result.response, result.error);
    if (typeof result.error === 'object' && result.error !== null) bodies.set(error, result.error as Record<string, unknown>);
    throw error;
  }
  // The success path is apiData's: one place decides what a body is.
  return apiData(Promise.resolve(result));
}

function bodyOf(error: unknown): Record<string, unknown> {
  return error instanceof ApiError ? (bodies.get(error) ?? {}) : {};
}

/** A whole number of the error body, or null. */
export function errorNumber(error: unknown, key: 'attempts_left' | 'retry_after'): number | null {
  const value = bodyOf(error)[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

export type ReauthMethod = 'passkey' | 'email_code' | 'password';
const METHODS: readonly ReauthMethod[] = ['passkey', 'email_code', 'password'];

/** `methods` of 403 reauthentication_required, in the server's order; null when the body is unknown (another client call). */
export function reauthMethodsOf(error: unknown): ReauthMethod[] | null {
  const value = bodyOf(error).methods;
  if (!Array.isArray(value)) return null;
  return value.filter((method): method is ReauthMethod => METHODS.includes(method as ReauthMethod));
}

/** For tests: an ApiError with a body, as the client builds one. */
export function withErrorBody(error: ApiError, body: Record<string, unknown>): ApiError {
  bodies.set(error, body);
  return error;
}
