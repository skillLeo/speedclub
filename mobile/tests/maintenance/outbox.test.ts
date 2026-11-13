import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError } from '@/api/client';
import { coalesceMaintenance, outcomeOf, sendMaintenanceOp } from '@/features/maintenance/outbox';
import { setMember } from '@/state/session';
import { createOutbox, reviveOps, type OutboxNetwork, type OutboxOp, type OutboxOutcome } from '@/state/outbox';

import { VEHICLE } from './fixtures';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid'), getRandomBytes: (count: number) => new Uint8Array(count) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

function op(overrides: Partial<OutboxOp> & Pick<OutboxOp, 'id' | 'kind'>): Omit<OutboxOp, 'status' | 'attempts' | 'createdAt' | 'error'> {
  return { idempotencyKey: `key-${overrides.id}`, scope: VEHICLE, target: overrides.id, payload: {}, ...overrides };
}

function network(online = true) {
  const listeners = new Set<(value: boolean) => void>();
  let state = online;
  const value: OutboxNetwork & { set: (next: boolean) => void } = {
    isOnline: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      state = next;
      listeners.forEach((listener) => listener(next));
    },
  };
  return value;
}

const apiError = (status: number, kind: ApiError['kind'], code: string, retryAfter: number | null = null) =>
  new ApiError({ kind, status, code, message: `${code} message`, retryAfter });

describe('createOutbox (09 §8.12)', () => {
  beforeEach(() => AsyncStorage.clear());

  it('sends in order, keeps a write while offline and sends it on reconnect', async () => {
    const sent: string[] = [];
    const net = network(false);
    const box = createOutbox({ send: async (entry) => (sent.push(entry.id), { outcome: 'done' }), network: net });
    box.enqueue(op({ id: 'a', kind: 'item.create' }));
    box.enqueue(op({ id: 'b', kind: 'log.create' }));
    await box.flush();
    expect(sent).toEqual([]);
    expect(box.store.getState().ops.map((entry) => entry.status)).toEqual(['queued', 'queued']);
    net.set(true);
    await box.flush();
    expect(sent).toEqual(['a', 'b']);
    expect(box.store.getState().ops).toEqual([]);
  });

  it('retry stops the run, conflict and gone leave the queue, a refusal stays marked', async () => {
    const answers: Record<string, OutboxOutcome[]> = {
      a: [{ outcome: 'retry' }, { outcome: 'done' }],
      b: [{ outcome: 'conflict' }],
      c: [{ outcome: 'gone' }],
      d: [{ outcome: 'failed', message: 'Ungültig' }],
    };
    const settled: string[] = [];
    const box = createOutbox({ send: async (entry) => answers[entry.id]!.shift()!, onSettled: (entry, result) => settled.push(`${entry.id}:${result.outcome}`) });
    ['a', 'b', 'c', 'd'].forEach((id) => box.enqueue(op({ id, kind: 'item.update' })));
    await box.flush();
    expect(box.store.getState().ops.map((entry) => [entry.id, entry.status, entry.attempts])).toEqual([
      ['a', 'queued', 1],
      ['b', 'queued', 0],
      ['c', 'queued', 0],
      ['d', 'queued', 0],
    ]);
    await box.flush();
    expect(settled).toEqual(['a:done', 'b:conflict', 'c:gone', 'd:failed']);
    expect(box.store.getState().ops).toEqual([expect.objectContaining({ id: 'd', status: 'failed', error: 'Ungültig' })]);
    answers.d = [{ outcome: 'done' }];
    await box.retry('d');
    expect(box.store.getState().ops).toEqual([]);
  });

  it('survives a restart for the same member only', async () => {
    const send = jest.fn(async () => ({ outcome: 'retry' }) as OutboxOutcome);
    const first = createOutbox({ send, storageKey: 'sc.test.outbox', owner: () => 'm1', network: network(false) });
    await first.hydrated();
    first.enqueue(op({ id: 'a', kind: 'odometer.set' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const again = createOutbox({ send, storageKey: 'sc.test.outbox', owner: () => 'm1', network: network(false) });
    await again.hydrated();
    expect(again.store.getState().ops.map((entry) => entry.id)).toEqual(['a']);
    const other = createOutbox({ send, storageKey: 'sc.test.outbox', owner: () => 'm2', network: network(false) });
    await other.hydrated();
    expect(other.store.getState().ops).toEqual([]);
    await again.reset();
    expect(await AsyncStorage.getItem('sc.test.outbox')).toBeNull();
  });

  it('a write cut off while sending goes back in line', () => {
    expect(reviveOps({ owner: 'm1', ops: [{ ...op({ id: 'a', kind: 'x' }), status: 'sending', attempts: 1, createdAt: 1, error: null }] }, 'm1')[0]?.status).toBe('queued');
  });
});

describe('coalesceMaintenance', () => {
  const full = (entry: ReturnType<typeof op>): OutboxOp => ({ ...entry, status: 'queued', attempts: 0, createdAt: 1, error: null });

  it('an edit of an unsent create joins the create without its version', () => {
    const create = full(op({ id: 'c1', kind: 'item.create', target: 'item1', payload: { body: { id: 'item1', type: 'service', notes: null } } }));
    const next = coalesceMaintenance([create], full(op({ id: 'u1', kind: 'item.update', target: 'item1', payload: { body: { version: 3, notes: 'Neu' } } })));
    expect(next).toHaveLength(1);
    expect(next[0]?.payload).toEqual({ body: { id: 'item1', type: 'service', notes: 'Neu' } });
  });

  it('two edits become one, keeping the first version', () => {
    const first = full(op({ id: 'u1', kind: 'log.update', target: 'log1', payload: { body: { version: 2, notes: 'A' } } }));
    const next = coalesceMaintenance([first], full(op({ id: 'u2', kind: 'log.update', target: 'log1', payload: { body: { version: 5, workshop: 'B' } } })));
    expect(next).toHaveLength(1);
    expect(next[0]?.payload).toEqual({ body: { version: 2, notes: 'A', workshop: 'B' } });
  });

  it('deleting an unsent create drops both; a delete drops waiting edits; the newest mileage wins', () => {
    const create = full(op({ id: 'c1', kind: 'log.create', target: 'log1' }));
    expect(coalesceMaintenance([create], full(op({ id: 'd1', kind: 'log.delete', target: 'log1' })))).toEqual([]);
    const edit = full(op({ id: 'u1', kind: 'item.update', target: 'item1', payload: { body: {} } }));
    expect(coalesceMaintenance([edit], full(op({ id: 'd1', kind: 'item.delete', target: 'item1' }))).map((entry) => entry.kind)).toEqual(['item.delete']);
    const km = full(op({ id: 'o1', kind: 'odometer.set', target: VEHICLE, payload: { km: 1 } }));
    expect(coalesceMaintenance([km], full(op({ id: 'o2', kind: 'odometer.set', target: VEHICLE, payload: { km: 2 } }))).map((entry) => entry.id)).toEqual(['o2']);
  });
});

describe('outcomeOf (ADR-441 contract)', () => {
  it('maps the answers', () => {
    expect(outcomeOf(apiError(0, 'network', 'network'))).toEqual({ outcome: 'retry' });
    expect(outcomeOf(apiError(409, 'conflict', 'edit_conflict'))).toEqual({ outcome: 'conflict' });
    expect(outcomeOf(apiError(409, 'conflict', 'conflict', 3))).toEqual({ outcome: 'retry' });
    expect(outcomeOf(apiError(409, 'conflict', 'conflict'))).toEqual({ outcome: 'conflict' });
    expect(outcomeOf(apiError(404, 'not_found', 'not_found'))).toEqual({ outcome: 'gone' });
    expect(outcomeOf(apiError(422, 'validation', 'validation_failed'))).toEqual({ outcome: 'failed', message: 'validation_failed message' });
    expect(outcomeOf(apiError(503, 'server', 'server'))).toEqual({ outcome: 'retry' });
  });

  it('sends a create with its client id and Idempotency-Key', async () => {
    setMember({ id: '01nina', username: 'nina.neu', displayName: 'Nina', avatarUrl: null, nextStep: null });
    const calls: { url: string; key: string | null; body: unknown }[] = [];
    globalThis.fetch = jest.fn(async (input: Request) => {
      calls.push({ url: input.url, key: input.headers.get('Idempotency-Key'), body: JSON.parse(await input.text()) });
      return new Response(JSON.stringify({ data: { id: 'item1' } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const result = await sendMaintenanceOp({
      id: 'op1',
      idempotencyKey: 'key-1',
      kind: 'item.create',
      scope: VEHICLE,
      target: 'item1',
      payload: { body: { id: 'item1', type: 'oil_change' } },
      status: 'sending',
      attempts: 1,
      createdAt: 1,
      error: null,
    });
    expect(calls.length).toBe(1);
    expect(result).toEqual({ outcome: 'done' });
    expect(calls[0]?.url).toContain(`/vehicles/${VEHICLE}/maintenance-items`);
    expect(calls[0]?.key).toBe('key-1');
    expect(calls[0]?.body).toEqual({ id: 'item1', type: 'oil_change' });
  });
});
