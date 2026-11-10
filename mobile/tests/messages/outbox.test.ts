// The outbox (contract §7): order, retry with the same keys, dedupe on client_id, the offline queue and the session boundary.
import { createOutbox, entryToMessage, type OutboxTransport, type SendRequest } from '@/features/messages/outbox';
import type { DeliveryFailure, ThreadMessage } from '@/features/messages/model';

import { serverMessage } from './fixtures';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class NetworkError extends Error {}
class Refused extends Error {
  constructor(readonly reason: DeliveryFailure['reason']) {
    super(reason);
  }
}

const classify = (error: unknown): DeliveryFailure => {
  if (error instanceof Refused) return { reason: error.reason, message: `refused: ${error.reason}` };
  return { reason: 'network', message: 'offline' };
};

/** A transport whose sends wait until the test answers them, in the order they were asked. */
function manualTransport() {
  const calls: { request: SendRequest; answer: Deferred<ThreadMessage> }[] = [];
  const uploads: { photoUri: string; answer: Deferred<string> }[] = [];
  const transport: OutboxTransport = {
    send: (request) => {
      const answer = deferred<ThreadMessage>();
      calls.push({ request, answer });
      return answer.promise;
    },
    uploadPhoto: (_conversation, photo) => {
      const answer = deferred<string>();
      uploads.push({ photoUri: photo.uri, answer });
      return answer.promise;
    },
  };
  return { transport, calls, uploads };
}

function serverCopy(request: SendRequest, id: string): ThreadMessage {
  return serverMessage({
    id,
    clientId: request.clientId,
    mine: true,
    senderUsername: null,
    body: request.draft.kind === 'text' ? request.draft.body : null,
  });
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const made: { dispose: () => void }[] = [];
afterEach(() => {
  made.splice(0).forEach((outbox) => outbox.dispose());
  jest.useRealTimers();
});

function setup(online = true, extra: Partial<Parameters<typeof createOutbox>[0]> = {}) {
  const { transport, calls, uploads } = manualTransport();
  let id = 0;
  const delivered: { conversationId: string; message: ThreadMessage }[] = [];
  const failed: DeliveryFailure[] = [];
  const outbox = createOutbox({
    memberId: 'member-a',
    transport,
    classify,
    online,
    newId: () => `id-${String((id += 1)).padStart(3, '0')}`,
    now: () => new Date('2026-11-08T10:00:00Z'),
    onDelivered: (conversationId, message) => delivered.push({ conversationId, message }),
    onFailed: (_conversationId, failure) => failed.push(failure),
    ...extra,
  });
  made.push(outbox);
  return { outbox, calls, uploads, delivered, failed };
}

describe('outbox', () => {
  it('shows a message at once and sends it with its client_id and an idempotency key', async () => {
    const { outbox, calls, delivered } = setup();
    const entry = outbox.enqueue('c1', { kind: 'text', body: 'Hast du am Samstag Zeit?' });

    const shown = outbox.entries('c1');
    expect(shown).toHaveLength(1);
    expect(entryToMessage(shown[0]!)).toMatchObject({ mine: true, body: 'Hast du am Samstag Zeit?', delivery: 'sending', id: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.request).toMatchObject({ conversationId: 'c1', clientId: entry.clientId, idempotencyKey: entry.idempotencyKey });
    expect(entry.clientId).not.toBe(entry.idempotencyKey);

    calls[0]!.answer.resolve(serverCopy(calls[0]!.request, '01A'));
    await flush();
    expect(outbox.entries('c1')).toHaveLength(0);
    // The server's copy keeps the optimistic key, so the bubble does not remount.
    expect(delivered[0]!.message).toMatchObject({ id: '01A', key: entry.clientId, clientId: entry.clientId });
  });

  it('sends one message of a conversation at a time, in the order written', async () => {
    const { outbox, calls } = setup();
    outbox.enqueue('c1', { kind: 'text', body: 'eins' });
    outbox.enqueue('c1', { kind: 'text', body: 'zwei' });
    outbox.enqueue('c1', { kind: 'text', body: 'drei' });
    expect(calls).toHaveLength(1);
    expect(outbox.entries('c1').map((entry) => entry.state)).toEqual(['sending', 'queued', 'queued']);

    calls[0]!.answer.resolve(serverCopy(calls[0]!.request, '01A'));
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]!.answer.resolve(serverCopy(calls[1]!.request, '01B'));
    await flush();
    calls[2]!.answer.resolve(serverCopy(calls[2]!.request, '01C'));
    await flush();
    expect(calls.map((call) => (call.request.draft.kind === 'text' ? call.request.draft.body : ''))).toEqual(['eins', 'zwei', 'drei']);
    expect(outbox.size).toBe(0);
  });

  it('runs conversations side by side', () => {
    const { outbox, calls } = setup();
    outbox.enqueue('c1', { kind: 'text', body: 'an Jann' });
    outbox.enqueue('c2', { kind: 'text', body: 'an Kenji' });
    expect(calls.map((call) => call.request.conversationId)).toEqual(['c1', 'c2']);
  });

  it('queues while offline and drains in order on reconnect', async () => {
    const { outbox, calls } = setup(false);
    outbox.enqueue('c1', { kind: 'text', body: 'eins' });
    outbox.enqueue('c1', { kind: 'text', body: 'zwei' });
    expect(calls).toHaveLength(0);
    expect(outbox.entries('c1').map((entry) => entry.state)).toEqual(['queued', 'queued']);

    outbox.setOnline(true);
    expect(calls).toHaveLength(1);
    calls[0]!.answer.resolve(serverCopy(calls[0]!.request, '01A'));
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.request.draft).toEqual({ kind: 'text', body: 'zwei' });
  });

  it('a send that loses the connection waits for it, and goes again with the same keys', async () => {
    const { outbox, calls } = setup();
    const entry = outbox.enqueue('c1', { kind: 'text', body: 'eins' });
    outbox.setOnline(false);
    calls[0]!.answer.reject(new NetworkError());
    await flush();
    expect(outbox.entries('c1')[0]!).toMatchObject({ state: 'queued', failure: null });

    outbox.setOnline(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.request).toMatchObject({ clientId: entry.clientId, idempotencyKey: entry.idempotencyKey });
  });

  it('a network failure while online shows "Erneut senden" and holds the messages behind it', async () => {
    const { outbox, calls } = setup();
    const first = outbox.enqueue('c1', { kind: 'text', body: 'eins' });
    outbox.enqueue('c1', { kind: 'text', body: 'zwei' });
    calls[0]!.answer.reject(new NetworkError());
    await flush();
    expect(outbox.entries('c1').map((entry) => entry.state)).toEqual(['failed', 'queued']);
    expect(calls).toHaveLength(1);

    outbox.retry(first.clientId);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.request).toMatchObject({ clientId: first.clientId, idempotencyKey: first.idempotencyKey });
    calls[1]!.answer.resolve(serverCopy(calls[1]!.request, '01A'));
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2]!.request.draft).toEqual({ kind: 'text', body: 'zwei' });
  });

  it('a refusal only the member can resolve fails that message and lets the next one pass', async () => {
    const { outbox, calls, failed } = setup();
    outbox.enqueue('c1', { kind: 'text', body: 'eins' });
    outbox.enqueue('c1', { kind: 'text', body: 'zwei' });
    calls[0]!.answer.reject(new Refused('request_pending'));
    await flush();
    expect(outbox.entries('c1')[0]!).toMatchObject({ state: 'failed', failure: { reason: 'request_pending' } });
    expect(failed).toEqual([{ reason: 'request_pending', message: 'refused: request_pending' }]);
    expect(calls).toHaveLength(2);
  });

  describe('refused for the missing re-consent (ADR-245, code review phase-3-final SF-2)', () => {
    it('stays in the outbox with its text, holds the ones behind it, and is not retried by itself', async () => {
      jest.useFakeTimers();
      const { outbox, calls, failed } = setup();
      const first = outbox.enqueue('c1', { kind: 'text', body: 'Servus, steht der E46 noch?' });
      outbox.enqueue('c1', { kind: 'text', body: 'zwei' });
      calls[0]!.answer.reject(new Refused('consent_required'));
      await jest.advanceTimersByTimeAsync(120_000);
      const [held, behind] = outbox.entries('c1');
      expect(held).toMatchObject({ clientId: first.clientId, state: 'failed', failure: { reason: 'consent_required' } });
      expect(held!.draft).toEqual({ kind: 'text', body: 'Servus, steht der E46 noch?' });
      expect(entryToMessage(held!)).toMatchObject({ body: 'Servus, steht der E46 noch?', delivery: 'failed' });
      expect(behind!.state).toBe('queued');
      expect(failed).toEqual([{ reason: 'consent_required', message: 'refused: consent_required' }]);
      // A reconnect is no accept: nothing goes out.
      outbox.setOnline(false);
      outbox.setOnline(true);
      expect(calls).toHaveLength(1);
    });

    it('goes out after the accept, with the same keys, before the ones behind it', async () => {
      const { outbox, calls, delivered } = setup();
      const first = outbox.enqueue('c1', { kind: 'text', body: 'eins' });
      outbox.enqueue('c1', { kind: 'text', body: 'zwei' });
      outbox.enqueue('c2', { kind: 'text', body: 'anderswo' });
      calls[0]!.answer.reject(new Refused('consent_required'));
      calls[1]!.answer.reject(new Refused('consent_required'));
      await flush();
      expect(calls).toHaveLength(2);

      outbox.resumeAfterConsent();
      expect(calls).toHaveLength(4);
      expect(calls[2]!.request).toMatchObject({ clientId: first.clientId, idempotencyKey: first.idempotencyKey, draft: { kind: 'text', body: 'eins' } });
      expect(calls[3]!.request.draft).toEqual({ kind: 'text', body: 'anderswo' });
      calls[2]!.answer.resolve(serverCopy(calls[2]!.request, '01A'));
      calls[3]!.answer.resolve(serverCopy(calls[3]!.request, '01C'));
      await flush();
      expect(calls[4]!.request.draft).toEqual({ kind: 'text', body: 'zwei' });
      calls[4]!.answer.resolve(serverCopy(calls[4]!.request, '01B'));
      await flush();
      expect(delivered.map((item) => item.message.id)).toEqual(['01A', '01C', '01B']);
      expect(outbox.size).toBe(0);
    });

    it('the accept leaves other failures alone', async () => {
      const { outbox, calls } = setup();
      outbox.enqueue('c1', { kind: 'text', body: 'eins' });
      calls[0]!.answer.reject(new Refused('cannot_message'));
      await flush();
      outbox.resumeAfterConsent();
      expect(calls).toHaveLength(1);
      expect(outbox.entries('c1')[0]).toMatchObject({ state: 'failed', failure: { reason: 'cannot_message' } });
    });
  });

  it('a failed message can be removed; one on its way cannot', async () => {
    const { outbox, calls } = setup();
    const first = outbox.enqueue('c1', { kind: 'text', body: 'eins' });
    outbox.remove(first.clientId);
    expect(outbox.entries('c1')).toHaveLength(1);
    calls[0]!.answer.reject(new Refused('invalid'));
    await flush();
    outbox.remove(first.clientId);
    expect(outbox.entries('c1')).toHaveLength(0);
  });

  it('drops the entry when polling brings the server copy first, and ignores the late answer', async () => {
    const { outbox, calls, delivered } = setup();
    const entry = outbox.enqueue('c1', { kind: 'text', body: 'eins' });
    outbox.reconcile('c1', [entry.clientId]);
    expect(outbox.entries('c1')).toHaveLength(0);
    calls[0]!.answer.resolve(serverCopy(calls[0]!.request, '01A'));
    await flush();
    expect(delivered).toHaveLength(0);
  });

  it('a timeout after the server stored it ends with one message: the poll copy reconciles the failed entry', async () => {
    const { outbox, calls } = setup();
    const entry = outbox.enqueue('c1', { kind: 'text', body: 'eins' });
    calls[0]!.answer.reject(new NetworkError());
    await flush();
    expect(outbox.entries('c1')[0]!.state).toBe('failed');
    outbox.reconcile('c1', [entry.clientId]);
    expect(outbox.entries('c1')).toHaveLength(0);
  });

  it('uploads a photo once, and keeps its media id for a retry', async () => {
    const { outbox, calls, uploads } = setup();
    const entry = outbox.enqueue('c1', { kind: 'photo', photo: { uri: 'file:///r34.jpg', width: 1600, height: 1200 }, mediaId: null });
    expect(uploads).toHaveLength(1);
    uploads[0]!.answer.resolve('media-1');
    await flush();
    expect(calls[0]!.request.mediaId).toBe('media-1');
    calls[0]!.answer.reject(new NetworkError());
    await flush();
    outbox.retry(entry.clientId);
    await flush();
    expect(uploads).toHaveLength(1);
    expect(calls[1]!.request.mediaId).toBe('media-1');
  });

  it('keeps the same array between changes, for useSyncExternalStore', () => {
    const { outbox } = setup(false);
    outbox.enqueue('c1', { kind: 'text', body: 'eins' });
    expect(outbox.entries('c1')).toBe(outbox.entries('c1'));
  });

  describe('never stalls (review 8)', () => {
    it('counts a send without an answer in time as no connection, and tries again by itself', async () => {
      jest.useFakeTimers();
      const { outbox, calls } = setup(true, { sendTimeoutMs: 1_000 });
      const entry = outbox.enqueue('c1', { kind: 'text', body: 'eins' });
      await jest.advanceTimersByTimeAsync(1_000);
      expect(calls[0]!.request.signal.aborted).toBe(true);
      expect(outbox.entries('c1')[0]).toMatchObject({ state: 'failed', failure: { reason: 'network' } });
      // Doubling from 2 s: the first automatic retry, with the same keys.
      await jest.advanceTimersByTimeAsync(2_000);
      expect(calls).toHaveLength(2);
      expect(calls[1]!.request).toMatchObject({ clientId: entry.clientId, idempotencyKey: entry.idempotencyKey });
    });

    it('honours Retry-After on the rate limit', async () => {
      jest.useFakeTimers();
      const { outbox, calls } = setup(true, { classify: () => ({ reason: 'rate_limited', message: 'Zu viele', retryAfter: 20 }) });
      outbox.enqueue('c1', { kind: 'text', body: 'eins' });
      calls[0]!.answer.reject(new Error('429'));
      await jest.advanceTimersByTimeAsync(19_999);
      expect(calls).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(2);
    });

    it('does not retry by itself what only the member can resolve', async () => {
      jest.useFakeTimers();
      const { outbox, calls } = setup();
      outbox.enqueue('c1', { kind: 'text', body: 'eins' });
      calls[0]!.answer.reject(new Refused('request_pending'));
      await jest.advanceTimersByTimeAsync(120_000);
      expect(calls).toHaveLength(1);
    });
  });

  it('deletes the prepared photo once it is sent, removed, or the session ends (review 6)', async () => {
    const released: string[] = [];
    const { outbox, calls, uploads } = setup(true, { releasePhoto: (photo) => released.push(photo.uri) });
    outbox.enqueue('c1', { kind: 'photo', photo: { uri: 'file:///sent.jpg', width: 4, height: 3 }, mediaId: null });
    uploads[0]!.answer.resolve('m1');
    await flush();
    calls[0]!.answer.resolve(serverCopy(calls[0]!.request, '01A'));
    await flush();
    expect(released).toEqual(['file:///sent.jpg']);
    outbox.setOnline(false);
    outbox.enqueue('c2', { kind: 'photo', photo: { uri: 'file:///queued.jpg', width: 4, height: 3 }, mediaId: null });
    outbox.dispose();
    expect(released).toEqual(['file:///sent.jpg', 'file:///queued.jpg']);
  });

  describe('a session change', () => {
    it('aborts the send under way, forgets every entry and ignores the late answer', async () => {
      const { outbox, calls, delivered } = setup();
      outbox.enqueue('c1', { kind: 'text', body: 'eins' });
      outbox.enqueue('c1', { kind: 'text', body: 'zwei' });
      const signal = calls[0]!.request.signal;
      outbox.dispose();
      expect(signal.aborted).toBe(true);
      expect(outbox.entries('c1')).toHaveLength(0);
      calls[0]!.answer.resolve(serverCopy(calls[0]!.request, '01A'));
      await flush();
      expect(delivered).toHaveLength(0);
      expect(calls).toHaveLength(1);
      expect(() => outbox.enqueue('c1', { kind: 'text', body: 'drei' })).toThrow();
    });

    it('a queued message never goes out after the session ended, even when the connection returns', () => {
      const { outbox, calls } = setup(false);
      outbox.enqueue('c1', { kind: 'text', body: 'eins' });
      outbox.dispose();
      outbox.setOnline(true);
      expect(calls).toHaveLength(0);
    });
  });
});
