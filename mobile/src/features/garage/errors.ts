/**
 * What a failed save says, in plain language (§8 "never raw codes"): field errors land on their fields through
 * applyServerErrors; this is the rest, shown as the form's notice.
 */
import type { TFunction } from 'i18next';

import { ApiError } from '@/api/client';
import { IDEMPOTENCY_KEY_REUSED } from '@/api/queries/garage';

const MINUTE = 60;

export function waitText(t: TFunction<'garage'>, seconds: number | null): string {
  const value = Math.max(1, Math.ceil(seconds ?? MINUTE));
  return value < MINUTE ? t('errors.seconds', { count: value }) : t('errors.minutes', { count: Math.ceil(value / MINUTE) });
}

/** The key of a creating call was used before with another body: the first attempt is stored, this one was not. */
export function isKeyReused(error: unknown): boolean {
  return error instanceof ApiError && error.code === IDEMPOTENCY_KEY_REUSED;
}

/**
 * An answer that refuses this very body: the server looked at it and stored nothing under its key, so the next attempt is a
 * new intent with a new key. Everything else says nothing about what an earlier attempt under the key may have stored: no
 * answer, the 409 for the attempt still running, a 429 or a 503 that the throttle and maintenance give before the key is
 * looked at, any other 5xx, a 401 (BH-03).
 */
export function refusesBody(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  switch (error.kind) {
    case 'validation':
    case 'forbidden':
    case 'restricted':
    case 'not_found':
      return true;
    case 'conflict':
      return isKeyReused(error);
    default:
      return false;
  }
}

/** What was sent under a key may still land, or already has: the next attempt keeps the key. */
export function mayStillLand(error: unknown): boolean {
  return !refusesBody(error);
}

/**
 * `creating`: a POST with an idempotency key. Without an answer it may well have arrived, and the same key makes trying
 * again safe, so the text does not claim the save failed.
 */
export function saveErrorMessage(t: TFunction<'garage'>, error: unknown, { creating = false }: { creating?: boolean } = {}): string {
  if (!(error instanceof ApiError)) return t('errors.save');
  switch (error.kind) {
    case 'network':
      return creating ? t('errors.networkCreating') : t('errors.network');
    case 'rate_limited':
      return t('errors.rateLimited', { wait: waitText(t, error.retryAfter) });
    case 'validation':
      // A 422 that no field could show (the limit of 20 vehicles, of 200 mods, a wrong order) names its reason under errors.
      return Object.values(error.fieldErrors)[0]?.[0] ?? error.message;
    case 'conflict':
      return isKeyReused(error) ? t('errors.keyReused') : error.message;
    case 'restricted':
    case 'forbidden':
      // The server's message is translated and names the reason.
      return error.message;
    case 'not_found':
      return t('errors.gone');
    default:
      return t('errors.save');
  }
}

export function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
