/**
 * The offline outbox (09 §8.12, ADR-441): writes made without a connection wait here, in order, and go out once the device is
 * online again. Every operation carries its own Idempotency-Key and, for a new entity, the client ULID that becomes its id, so a
 * retry after a lost answer never makes a second copy. What a write means is the feature's business: it hands in `send`, which
 * answers how an attempt ended.
 *
 *   done      the server has it: the op leaves the queue
 *   retry     no answer (offline, timeout): the op stays queued, the run stops, the next reconnect starts it again
 *   conflict  409 edit_conflict: the server's copy wins, the op leaves the queue (the feature reads the server's copy and says so)
 *   gone      404: the entity was deleted elsewhere, the op leaves the queue quietly
 *   failed    the server refused it (422, 403…): the op stays, marked, until the member retries or discards it
 *
 * Kept per member: a stored queue of anybody else is dropped. Persisted in AsyncStorage (localStorage on the web).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStore, type StoreApi } from 'zustand/vanilla';

export type OutboxStatus = 'queued' | 'sending' | 'failed';

export type OutboxOp<P = unknown> = {
  /** The op's own id; for a create also the new entity's id (client ULID). */
  id: string;
  idempotencyKey: string;
  /** What the op does, e.g. `item.create`. */
  kind: string;
  /** What it belongs to, e.g. a vehicle id: a screen shows the ops of its scope. */
  scope: string;
  /** The entity it changes (a create names its own id). */
  target: string;
  payload: P;
  status: OutboxStatus;
  attempts: number;
  createdAt: number;
  /** The server's message of the last refusal, shown with "Erneut versuchen". */
  error: string | null;
};

export type OutboxOutcome =
  | { outcome: 'done' }
  | { outcome: 'retry' }
  | { outcome: 'conflict' }
  | { outcome: 'gone' }
  | { outcome: 'failed'; message: string };

export type OutboxSender = (op: OutboxOp) => Promise<OutboxOutcome>;

/** Folds a new op into the waiting ones (an edit of an unsent create joins the create; a delete of it drops both). */
export type OutboxCoalesce = (queue: readonly OutboxOp[], next: OutboxOp) => OutboxOp[];

export type OutboxNetwork = {
  isOnline: () => boolean;
  subscribe: (listener: (online: boolean) => void) => () => void;
};

type OutboxState = { ops: OutboxOp[] };

export type OutboxOptions = {
  send: OutboxSender;
  coalesce?: OutboxCoalesce;
  /** Keeps the queue across restarts under this key. */
  storageKey?: string;
  owner?: () => string | null;
  network?: OutboxNetwork;
  /** After every op that ended (done, conflict, gone, failed): for the feature to read again and to tell the member. */
  onSettled?: (op: OutboxOp, outcome: OutboxOutcome) => void;
};

export type Outbox = {
  store: StoreApi<OutboxState>;
  enqueue: (op: Omit<OutboxOp, 'status' | 'attempts' | 'createdAt' | 'error'> & { createdAt?: number }) => void;
  /** Sends what waits, one op after the other. Resolves when the run ends; a second call during a run joins it. */
  flush: () => Promise<void>;
  retry: (id: string) => Promise<void>;
  discard: (id: string) => void;
  /** Sign-out: forget everything, stored copy included. */
  reset: () => Promise<void>;
  hydrated: () => Promise<void>;
};

type Stored = { owner: string | null; ops: OutboxOp[] };

const ALWAYS_ONLINE: OutboxNetwork = { isOnline: () => true, subscribe: () => () => undefined };

/** The default: ops wait side by side, nothing folds. */
const appendOnly: OutboxCoalesce = (queue, next) => [...queue, next];

/** A stored queue as the running one takes it: the owner's only, nothing still marked as sending. */
export function reviveOps(stored: Partial<Stored> | null | undefined, owner: string | null): OutboxOp[] {
  if (!stored || owner === null || stored.owner !== owner || !Array.isArray(stored.ops)) return [];
  return stored.ops.map((op) => (op.status === 'sending' ? { ...op, status: 'queued' as const } : op));
}

export function createOutbox(options: OutboxOptions): Outbox {
  const owner = options.owner ?? (() => null);
  const network = options.network ?? ALWAYS_ONLINE;
  const coalesce = options.coalesce ?? appendOnly;
  const store = createStore<OutboxState>(() => ({ ops: [] }));
  let running: Promise<void> | null = null;
  let generation = 0;

  const persist = () => {
    if (!options.storageKey) return;
    const stored: Stored = { owner: owner(), ops: store.getState().ops };
    AsyncStorage.setItem(options.storageKey, JSON.stringify(stored)).catch(() => undefined);
  };
  const setOps = (ops: OutboxOp[]) => {
    store.setState({ ops });
    persist();
  };
  const patch = (id: string, next: Partial<OutboxOp>) => setOps(store.getState().ops.map((op) => (op.id === id ? { ...op, ...next } : op)));
  const remove = (id: string) => setOps(store.getState().ops.filter((op) => op.id !== id));

  const hydration: Promise<void> = (async () => {
    if (!options.storageKey) return;
    try {
      const raw = await AsyncStorage.getItem(options.storageKey);
      const stored = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
      const revived = reviveOps(stored, owner());
      if (revived.length === 0) return;
      const known = new Set(store.getState().ops.map((op) => op.id));
      store.setState({ ops: [...revived.filter((op) => !known.has(op.id)), ...store.getState().ops] });
    } catch {
      // Unreadable storage: the queue starts empty.
    }
  })();

  async function run(): Promise<void> {
    await hydration;
    const round = generation;
    // Failed ops wait for the member; the queue goes on past them, in order.
    for (;;) {
      if (round !== generation || !network.isOnline()) return;
      const op = store.getState().ops.find((entry) => entry.status === 'queued');
      if (!op) return;
      patch(op.id, { status: 'sending', attempts: op.attempts + 1 });
      let result: OutboxOutcome;
      try {
        result = await options.send({ ...op, status: 'sending', attempts: op.attempts + 1 });
      } catch {
        result = { outcome: 'retry' };
      }
      if (round !== generation) return;
      if (result.outcome === 'retry') {
        patch(op.id, { status: 'queued' });
        return;
      }
      if (result.outcome === 'failed') patch(op.id, { status: 'failed', error: result.message });
      else remove(op.id);
      options.onSettled?.(op, result);
    }
  }

  const flush = () => {
    running ??= run().finally(() => {
      running = null;
    });
    return running;
  };

  network.subscribe((online) => {
    if (online) void flush();
  });

  return {
    store,
    enqueue: (input) => {
      const op: OutboxOp = { ...input, createdAt: input.createdAt ?? Date.now(), status: 'queued', attempts: 0, error: null };
      setOps(coalesce(store.getState().ops, op));
    },
    flush,
    retry: async (id) => {
      patch(id, { status: 'queued', error: null });
      await flush();
    },
    discard: (id) => remove(id),
    reset: async () => {
      generation += 1;
      store.setState({ ops: [] });
      if (options.storageKey) await AsyncStorage.removeItem(options.storageKey).catch(() => undefined);
    },
    hydrated: () => hydration,
  };
}
