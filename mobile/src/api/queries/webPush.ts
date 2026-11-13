/**
 * The member web's push subscription on the server (ADR-452, M4.15): `POST /me/push-subscriptions {endpoint, keys, user_agent?}`
 * (idempotent per endpoint, answers 204) and `DELETE /me/push-subscriptions?endpoint=` (the generated contract names it a query
 * parameter). The public VAPID key comes with app-config
 * (`web_push.vapid_public_key`, null while the server has no keys). A 404 (`feature_disabled` while the flag `web_push` is off)
 * reads as `unavailable`, never as a failure.
 */
import { api, ApiError, apiData, withIdempotency } from '@/api/client';
import type { AppConfig } from '@/api/queries/appConfig';
import type { components } from '@/api/schema';

export type PushSubscriptionBody = components['schemas']['StorePushSubscriptionRequest'];

/** What a write came to: stored, or the server does not take subscriptions (the flag is off, or a server without the module). */
export type PushSubscriptionOutcome = 'saved' | 'unavailable';

function isMissingRoute(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405);
}

export async function savePushSubscription(body: PushSubscriptionBody): Promise<PushSubscriptionOutcome> {
  try {
    await apiData(api.POST('/me/push-subscriptions', { body, ...withIdempotency() }));
    return 'saved';
  } catch (error) {
    if (isMissingRoute(error)) return 'unavailable';
    throw error;
  }
}

/** A subscription the server no longer has is gone already: a 404 is success here. */
export async function deletePushSubscription(endpoint: string): Promise<void> {
  try {
    await apiData(api.DELETE('/me/push-subscriptions', { params: { query: { endpoint } } }));
  } catch (error) {
    if (!isMissingRoute(error)) throw error;
  }
}

/** The base64url VAPID public key of app-config, or null (no keys on the server, or a config stored before M4.15). */
export function vapidPublicKey(config: AppConfig): string | null {
  const key = config.web_push?.vapid_public_key?.trim();
  // An uncompressed P-256 point is 65 bytes: 87 base64url characters.
  return key && /^[A-Za-z0-9_-]{80,100}$/.test(key) ? key : null;
}
