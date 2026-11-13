/**
 * The maintenance outbox (09 §8.12, ADR-441): MNT-01/02 writes made offline wait here and go out on reconnect, each with its
 * Idempotency-Key and, for a new item or entry, the client ULID that becomes its id. A 409 edit_conflict keeps the server's copy
 * (the screen reads it again and says so), a 404 drops the write quietly (deleted elsewhere), a refusal stays in the list with
 * "Erneut versuchen".
 */
import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { beforeSignOut } from '@/api/queries/auth';
import {
  EDIT_CONFLICT,
  maintenanceApi,
  refreshMaintenance,
  type ItemInput,
  type ItemPatch,
  type LogInput,
  type LogPatch,
} from '@/api/queries/maintenance';
import { queryClient } from '@/api/queryClient';
import i18n from '@/i18n';
import { createOutbox, type Outbox, type OutboxCoalesce, type OutboxOp, type OutboxOutcome } from '@/state/outbox';
import { useSessionStore } from '@/state/session';
import { onlineNetwork } from '@/state/uploads';
import { toast } from '@/ui';

export const MAINTENANCE_OUTBOX_KEY = 'sc.outbox.maintenance';

export type MaintenanceOp =
  | { kind: 'item.create'; payload: { body: ItemInput & { id: string } } }
  | { kind: 'item.update'; payload: { body: ItemPatch } }
  | { kind: 'item.delete'; payload: Record<string, never> }
  | { kind: 'log.create'; payload: { body: LogInput & { id: string } } }
  | { kind: 'log.update'; payload: { body: LogPatch } }
  | { kind: 'log.delete'; payload: Record<string, never> }
  | { kind: 'odometer.set'; payload: { km: number } };

export type MaintenanceOutboxOp = OutboxOp & MaintenanceOp;

const CREATE_OF: Readonly<Record<string, string>> = {
  'item.update': 'item.create',
  'item.delete': 'item.create',
  'log.update': 'log.create',
  'log.delete': 'log.create',
};

const isWaiting = (op: OutboxOp) => op.status === 'queued' || op.status === 'failed';

/**
 * Folds a write into the waiting ones of the same entity: an edit of an unsent create joins the create (and its version means
 * nothing yet), two edits become one, a delete of an unsent create removes both, a delete drops the waiting edits, and the newest
 * mileage replaces an older one.
 */
export const coalesceMaintenance: OutboxCoalesce = (queue, next) => {
  const same = (op: OutboxOp) => op.target === next.target && op.scope === next.scope && isWaiting(op);
  const createKind = CREATE_OF[next.kind];
  const create = createKind ? queue.find((op) => same(op) && op.kind === createKind) : undefined;
  if (next.kind.endsWith('.update')) {
    const body = (next.payload as { body: ItemPatch | LogPatch }).body;
    if (create) {
      const { version: _version, ...rest } = body;
      return queue.map((op) =>
        op === create ? { ...op, payload: { body: { ...(op.payload as { body: object }).body, ...rest } } } : op,
      );
    }
    const update = queue.find((op) => same(op) && op.kind === next.kind);
    if (update) {
      const before = (update.payload as { body: ItemPatch }).body;
      return queue.map((op) => (op === update ? { ...op, payload: { body: { ...before, ...body, version: before.version ?? body.version } } } : op));
    }
    return [...queue, next];
  }
  if (next.kind.endsWith('.delete')) {
    const prefix = next.kind.split('.')[0];
    const others = queue.filter((op) => !(same(op) && op.kind.startsWith(`${prefix}.`)));
    return create ? others : [...others, next];
  }
  if (next.kind === 'odometer.set') return [...queue.filter((op) => !(same(op) && op.kind === 'odometer.set')), next];
  return [...queue, next];
};

/** How one attempt ended, from the error of the call. */
export function outcomeOf(error: unknown): OutboxOutcome {
  if (!(error instanceof ApiError)) return { outcome: 'retry' };
  if (error.kind === 'network' || error.kind === 'server' || error.kind === 'maintenance') return { outcome: 'retry' };
  if (error.kind === 'rate_limited') return { outcome: 'retry' };
  if (error.code === EDIT_CONFLICT) return { outcome: 'conflict' };
  // The idempotency key is still in use by a running copy of this request: try again later.
  if (error.kind === 'conflict' && error.retryAfter !== null) return { outcome: 'retry' };
  // One item per type: another device made it first. Its copy wins, as with an edit conflict.
  if (error.kind === 'conflict' && error.code === 'conflict') return { outcome: 'conflict' };
  if (error.kind === 'not_found') return { outcome: 'gone' };
  return { outcome: 'failed', message: error.message };
}

export async function sendMaintenanceOp(op: OutboxOp): Promise<OutboxOutcome> {
  const entry = op as MaintenanceOutboxOp;
  try {
    switch (entry.kind) {
      case 'item.create':
        await maintenanceApi.createItem(entry.scope, entry.payload.body, entry.idempotencyKey);
        break;
      case 'item.update':
        await maintenanceApi.updateItem(entry.scope, entry.target, entry.payload.body);
        break;
      case 'item.delete':
        await maintenanceApi.deleteItem(entry.scope, entry.target);
        break;
      case 'log.create':
        await maintenanceApi.createLog(entry.scope, entry.payload.body, entry.idempotencyKey);
        break;
      case 'log.update':
        await maintenanceApi.updateLog(entry.scope, entry.target, entry.payload.body);
        break;
      case 'log.delete':
        await maintenanceApi.deleteLog(entry.scope, entry.target);
        break;
      case 'odometer.set':
        await maintenanceApi.setOdometer(entry.scope, entry.payload.km);
        break;
      default:
        return { outcome: 'gone' };
    }
    return { outcome: 'done' };
  } catch (error) {
    return outcomeOf(error);
  }
}

function currentMember(): string | null {
  const session = useSessionStore.getState();
  return session.status === 'member' ? (session.member?.id ?? null) : null;
}

function settled(op: OutboxOp, result: OutboxOutcome) {
  refreshMaintenance(queryClient, op.scope);
  const t = i18n.getFixedT(null, 'garage');
  if (result.outcome === 'conflict') toast(t('maintenance.outbox.conflict'), { testID: 'MNT-01.outboxConflict' });
  else if (result.outcome === 'failed') toast(t('maintenance.outbox.failedToast'), { haptic: 'warning', testID: 'MNT-01.outboxFailed' });
}

let outbox: Outbox | null = null;

/** The app's maintenance outbox, made on first use. */
export function maintenanceOutbox(): Outbox {
  outbox ??= createOutbox({
    send: sendMaintenanceOp,
    coalesce: coalesceMaintenance,
    storageKey: MAINTENANCE_OUTBOX_KEY,
    owner: currentMember,
    network: onlineNetwork,
    onSettled: settled,
  });
  return outbox;
}

/** Test seam. */
export function __resetMaintenanceOutboxForTests(): void {
  outbox = null;
}

// The queue holds the member's own writes: it never reaches the next account.
beforeSignOut(async () => {
  await maintenanceOutbox().reset();
});

/** Queues a write; it goes out at once when the device is online. */
export function queueMaintenance(vehicleId: string, target: string, op: MaintenanceOp): void {
  const box = maintenanceOutbox();
  box.enqueue({ id: newIdempotencyKey(), idempotencyKey: newIdempotencyKey(), scope: vehicleId, target, ...op });
  void box.flush();
}

/** The waiting writes of a vehicle (MNT-01 shows them with "Wird gesendet…" / "Fehlgeschlagen"), and a send on open. */
export function useMaintenanceOutbox(vehicleId: string): MaintenanceOutboxOp[] {
  const box = maintenanceOutbox();
  const ops = useStore(box.store, (state) => state.ops);
  useEffect(() => {
    void box.flush();
  }, [box]);
  return useMemo(() => ops.filter((op) => op.scope === vehicleId) as MaintenanceOutboxOp[], [ops, vehicleId]);
}

/** Every waiting write, for GAR-01. */
export function useAllMaintenanceOps(): MaintenanceOutboxOp[] {
  return useStore(maintenanceOutbox().store, (state) => state.ops) as MaintenanceOutboxOp[];
}
