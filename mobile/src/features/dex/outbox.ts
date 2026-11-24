/**
 * DEX-02 offline queue (contract §8, 09 §8.12, ADR-441): a scan without a connection is saved here ("Gespeichert – wird gesendet,
 * sobald du online bist") and goes out once the device is online, with the idempotency key of the scan, so a lost answer never
 * makes a second spot. A queued op holds the code and, when the device found one, the city id and Bundesland: never a position.
 *
 * Outcomes: sent → the card waits in the cache and a toast opens it; refused (404/409/422…) → the reason as a toast, the op leaves
 * the queue (scanning again would get the same answer); 429 or no answer → it stays for the next reconnect.
 */
import { router } from 'expo-router';
import { useStore } from 'zustand';

import { ApiError } from '@/api/client';
import { beforeSignOut } from '@/api/queries/auth';
import { postSpot, refusalOf, rememberSpot, waitsForNetwork, type SpotBody } from '@/api/queries/dex';
import { queryClient } from '@/api/queryClient';
import i18n from '@/i18n';
import { createOutbox, type Outbox, type OutboxOp, type OutboxOutcome } from '@/state/outbox';
import { useSessionStore } from '@/state/session';
import { onlineNetwork } from '@/state/uploads';
import { toast } from '@/ui/toast';

import { refusalCopy } from './copy';
import { spotRoute } from './navigation';

export const SPOT_OUTBOX_KEY = 'sc.outbox.spots';
export const SPOT_OP_KIND = 'spot.create';

export type SpotOutboxOp = OutboxOp<SpotBody>;

/** Only the contract's fields of a stored op: a queue written by an older build carries nothing else to the server. */
export function storedBody(payload: unknown): SpotBody | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { code, city_id: cityId, bundesland } = payload as Record<string, unknown>;
  if (typeof code !== 'string') return null;
  return typeof cityId === 'number' && typeof bundesland === 'string'
    ? { code, city_id: cityId, bundesland: bundesland as SpotBody['bundesland'] }
    : { code };
}

export async function sendSpotOp(op: OutboxOp): Promise<OutboxOutcome> {
  const body = storedBody(op.payload);
  if (!body) return { outcome: 'gone' };
  const t = i18n.getFixedT(null, 'dex');
  try {
    const response = await postSpot(body, op.idempotencyKey);
    rememberSpot(queryClient, response);
    toast(t('queue.sent', { name: response.data.vehicle.name }), {
      action: { label: t('queue.open'), onPress: () => router.push(spotRoute(response.data.spot_id)) },
      testID: 'DEX-02.queueSent',
    });
    return { outcome: 'done' };
  } catch (error) {
    if (waitsForNetwork(error)) return { outcome: 'retry' };
    if (error instanceof ApiError && error.kind === 'rate_limited') return { outcome: 'retry' };
    // The idempotency key is still held by a running copy of this request: later.
    if (error instanceof ApiError && error.kind === 'conflict' && error.retryAfter !== null) return { outcome: 'retry' };
    const refusal = refusalOf(error);
    toast(refusalCopy(t, refusal.reason).title, { haptic: 'warning', testID: 'DEX-02.queueRefused' });
    return { outcome: 'gone' };
  }
}

function currentMember(): string | null {
  const session = useSessionStore.getState();
  return session.status === 'member' ? (session.member?.id ?? null) : null;
}

let outbox: Outbox | null = null;

/** The app's spot outbox, made on first use. */
export function spotOutbox(): Outbox {
  outbox ??= createOutbox({
    send: sendSpotOp,
    storageKey: SPOT_OUTBOX_KEY,
    owner: currentMember,
    network: onlineNetwork,
  });
  return outbox;
}

/** Test seam. */
export function __resetSpotOutboxForTests(): void {
  outbox = null;
}

// The queue holds the member's own scans: it never reaches the next account.
beforeSignOut(async () => {
  await spotOutbox().reset();
});

/** Saves a scan for later, under the key the scan already had. */
export function queueSpot(body: SpotBody, idempotencyKey: string): void {
  const box = spotOutbox();
  box.enqueue({ id: idempotencyKey, idempotencyKey, kind: SPOT_OP_KIND, scope: 'spots', target: body.code, payload: body });
  void box.flush();
}

/** How many scans wait, for DEX-02's line under the frame. */
export function useQueuedSpotCount(): number {
  return useStore(spotOutbox().store, (state) => state.ops.length);
}
