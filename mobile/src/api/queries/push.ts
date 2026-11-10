/**
 * The device's Expo push token on the server (docs/reports/phase-2/m2.2-contract.md §3). One token per `device_id`, an idempotent
 * upsert; the server also drops it at logout. Native only: the web has e-mail and the in-app badges (§12).
 */
import { api, apiData } from '@/api/client';

import { deviceId } from './auth';

export type PushPlatform = 'ios' | 'android';

/** False when this install has no device id (no keychain): the server could not key the token, so nothing is sent. */
export async function sendPushToken(token: string, platform: PushPlatform, signal?: AbortSignal): Promise<boolean> {
  const id = await deviceId();
  if (!id) return false;
  await apiData(api.POST('/me/push-tokens', { body: { token, platform, device_id: id }, ...(signal ? { signal } : {}) }));
  return true;
}

export async function deletePushToken(signal?: AbortSignal): Promise<void> {
  const id = await deviceId();
  if (!id) return;
  await apiData(api.DELETE('/me/push-tokens/{deviceId}', { params: { path: { deviceId: id } }, ...(signal ? { signal } : {}) }));
}
