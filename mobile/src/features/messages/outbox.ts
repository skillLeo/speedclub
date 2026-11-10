/**
 * The outbox (contract §7, "instant and safe"): every own message appears at once, goes out in the order it was written, and never
 * twice nor lost while the app runs.
 *
 * - Each message gets a `client_id` and an Idempotency-Key when it is written. Both stay the same through every retry, so a
 *   retry the server already answered returns the first message (contract §2) and the thread shows it once.
 * - Per conversation one message is on its way at a time, oldest first. A message that failed for a reason that would fail the
 *   next one too (no connection, the rate limit, a server error) holds the ones behind it, so they never overtake it.
 * - Offline, messages wait as `queued` and go out when the connection returns. A failure that only the member can resolve
 *   (refused, a pending request, no permission to write) shows "Erneut senden" and lets the next messages pass.
 * - A message refused for the missing re-consent (403 `consent_required`, ADR-245) keeps its text and its place, holds the ones
 *   behind it, and goes out again once the member accepted (`resumeAfterConsent`); there is no timed retry, as it would only be
 *   refused again.
 * - The server's copy can arrive by polling before the send answers: `reconcile` then drops the entry by `client_id`, and the
 *   late answer is ignored.
 * - An outbox belongs to one member. `dispose` aborts what is under way and forgets the rest, so a message of one member can
 *   never be sent, or shown, in another member's session (ADR-175, ADR-185). Nothing is written to disk: message text stays in
 *   memory only.
 *
 * Pure apart from the transport it is given, so it is tested without React or the network.
 */
import type { ChatVehicle, DeliveryFailure, FailureReason, ThreadMessage } from './model';

export type LocalPhoto = { uri: string; width: number; height: number; mimeType?: string | null; fileName?: string | null };

export type OutboxDraft =
  | { kind: 'text'; body: string }
  | { kind: 'vehicle'; vehicle: ChatVehicle }
  | { kind: 'photo'; photo: LocalPhoto; /** Set once the upload succeeded, so a retry does not upload again. */ mediaId: string | null };

export type OutboxState = 'queued' | 'sending' | 'failed';

export type OutboxEntry = {
  readonly clientId: string;
  readonly idempotencyKey: string;
  readonly conversationId: string;
  readonly draft: OutboxDraft;
  readonly createdAt: string;
  /** Order of writing, across conversations. */
  readonly seq: number;
  readonly state: OutboxState;
  readonly failure: DeliveryFailure | null;
  readonly attempts: number;
};

export type SendRequest = {
  conversationId: string;
  clientId: string;
  idempotencyKey: string;
  draft: OutboxDraft;
  /** For a photo: the uploaded media. */
  mediaId: string | null;
  signal: AbortSignal;
};

export type OutboxTransport = {
  /** `POST conversations/{id}/media`: the media id of the uploaded photo. */
  uploadPhoto: (conversationId: string, photo: LocalPhoto, signal: AbortSignal) => Promise<string>;
  /** `POST conversations/{id}/messages` with `client_id` and the Idempotency-Key: the server's copy. */
  send: (request: SendRequest) => Promise<ThreadMessage>;
};

export type OutboxOptions = {
  memberId: string;
  transport: OutboxTransport;
  /** Maps any error of the transport to a reason and a message that is safe to show. */
  classify: (error: unknown) => DeliveryFailure;
  online?: boolean;
  now?: () => Date;
  /** A new random id (client_id and Idempotency-Key). */
  newId: () => string;
  /** The server's copy, before the entry leaves the outbox: put it in the thread so the bubble never blinks. */
  onDelivered?: (conversationId: string, message: ThreadMessage) => void;
  /** A failure the screen should hear about, for example `cannot_message` (the conversation closed). */
  onFailed?: (conversationId: string, failure: DeliveryFailure) => void;
  /** The prepared photo file is no longer needed: sent, removed, or the session ended. Deletes it from the device. */
  releasePhoto?: (photo: LocalPhoto) => void;
  /** One send gives up after this long and counts as no connection (default 30 s). */
  sendTimeoutMs?: number;
  /** One photo upload gives up after this long (default 120 s). */
  uploadTimeoutMs?: number;
};

export const SEND_TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 120_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/**
 * The pause before the automatic retry of a holding failure: `Retry-After` when the server sent one, else doubling from 2 s per
 * attempt, at most 60 s. So a conversation never stalls on a passing outage, and the rate limit is honoured.
 */
export function retryDelay(failure: DeliveryFailure, attempts: number): number {
  if (failure.retryAfter !== undefined && failure.retryAfter !== null && failure.retryAfter > 0) return failure.retryAfter * 1000;
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
}

/** Failures that would fail the next message too: they hold the queue so nothing overtakes. */
const HOLDING: ReadonlySet<FailureReason> = new Set(['network', 'rate_limited', 'server', 'consent_required']);

/** Holding failures that pass by themselves, so the outbox tries again after a pause. */
const RETRIED: ReadonlySet<FailureReason> = new Set(['network', 'rate_limited', 'server']);

export function holdsQueue(failure: DeliveryFailure | null): boolean {
  return failure !== null && HOLDING.has(failure.reason);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export class Outbox {
  readonly memberId: string;
  private readonly options: OutboxOptions;
  private readonly entriesById = new Map<string, OutboxEntry>();
  private readonly pumping = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly snapshots = new Map<string, readonly OutboxEntry[]>();
  private controller = new AbortController();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private online: boolean;
  private seq = 0;
  private disposedFlag = false;

  constructor(options: OutboxOptions) {
    this.options = options;
    this.memberId = options.memberId;
    this.online = options.online ?? true;
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }

  /** Writes a message: it shows at once and goes out as soon as it can. */
  enqueue(conversationId: string, draft: OutboxDraft): OutboxEntry {
    if (this.disposedFlag) throw new Error('outbox disposed');
    const id = this.options.newId();
    const entry: OutboxEntry = {
      clientId: id,
      idempotencyKey: this.options.newId(),
      conversationId,
      draft,
      createdAt: (this.options.now?.() ?? new Date()).toISOString(),
      seq: (this.seq += 1),
      state: 'queued',
      failure: null,
      attempts: 0,
    };
    this.entriesById.set(entry.clientId, entry);
    this.changed(conversationId);
    void this.pump(conversationId);
    return entry;
  }

  /** "Erneut senden": same client_id and key, back into the queue at its place. */
  retry(clientId: string): void {
    this.clearRetry(clientId);
    const entry = this.entriesById.get(clientId);
    if (!entry || entry.state !== 'failed') return;
    this.update(entry, { state: 'queued', failure: null });
    void this.pump(entry.conversationId);
  }

  /** "Löschen" of a message that did not go out. One on its way cannot be taken back. */
  remove(clientId: string): void {
    const entry = this.entriesById.get(clientId);
    if (!entry || entry.state === 'sending') return;
    this.clearRetry(clientId);
    this.entriesById.delete(clientId);
    this.release(entry);
    this.changed(entry.conversationId);
    void this.pump(entry.conversationId);
  }

  /** The connection changed. Back online, waiting messages and those that failed for the connection go out. */
  setOnline(online: boolean): void {
    if (this.disposedFlag || online === this.online) return;
    this.online = online;
    if (!online) return;
    const conversations = new Set<string>();
    for (const entry of this.entriesById.values()) {
      if (entry.state === 'failed' && entry.failure?.reason === 'network') this.update(entry, { state: 'queued', failure: null });
      conversations.add(entry.conversationId);
    }
    conversations.forEach((id) => void this.pump(id));
  }

  /** The member accepted the changed AGB or Datenschutz: what was refused for the consent goes out, in its place. */
  resumeAfterConsent(): void {
    if (this.disposedFlag) return;
    const conversations = new Set<string>();
    for (const entry of this.entriesById.values()) {
      if (entry.state !== 'failed' || entry.failure?.reason !== 'consent_required') continue;
      this.clearRetry(entry.clientId);
      this.update(entry, { state: 'queued', failure: null });
      conversations.add(entry.conversationId);
    }
    conversations.forEach((id) => void this.pump(id));
  }

  /** The server's copies of these client ids are in the thread: their entries are done, whatever state they were in. */
  reconcile(conversationId: string, clientIds: Iterable<string>): void {
    let removed = false;
    for (const clientId of clientIds) {
      const entry = this.entriesById.get(clientId);
      if (entry && entry.conversationId === conversationId) {
        this.clearRetry(clientId);
        this.entriesById.delete(clientId);
        this.release(entry);
        removed = true;
      }
    }
    if (removed) {
      this.changed(conversationId);
      void this.pump(conversationId);
    }
  }

  /** The entries of one conversation in the order written. The same array until something changes, for useSyncExternalStore. */
  entries(conversationId: string): readonly OutboxEntry[] {
    let list = this.snapshots.get(conversationId);
    if (!list) {
      list = [...this.entriesById.values()].filter((entry) => entry.conversationId === conversationId).sort((a, b) => a.seq - b.seq);
      this.snapshots.set(conversationId, list);
    }
    return list;
  }

  /** Whether anything waits or failed, in any conversation. */
  get size(): number {
    return this.entriesById.size;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The session ended or changed hands: abort what is under way and forget every entry. */
  dispose(): void {
    if (this.disposedFlag) return;
    this.disposedFlag = true;
    this.controller.abort();
    this.retryTimers.forEach((timer) => clearTimeout(timer));
    this.retryTimers.clear();
    this.entriesById.forEach((entry) => this.release(entry));
    this.entriesById.clear();
    this.snapshots.clear();
    this.listeners.forEach((listener) => listener());
    this.listeners.clear();
  }

  private release(entry: OutboxEntry): void {
    if (entry.draft.kind !== 'photo') return;
    try {
      this.options.releasePhoto?.(entry.draft.photo);
    } catch {
      // A file already gone is fine.
    }
  }

  private clearRetry(clientId: string): void {
    const timer = this.retryTimers.get(clientId);
    if (timer !== undefined) clearTimeout(timer);
    this.retryTimers.delete(clientId);
  }

  private scheduleRetry(entry: OutboxEntry, failure: DeliveryFailure): void {
    this.clearRetry(entry.clientId);
    const timer = setTimeout(() => {
      this.retryTimers.delete(entry.clientId);
      const current = this.entriesById.get(entry.clientId);
      if (!this.disposedFlag && current?.state === 'failed' && this.online) this.retry(entry.clientId);
    }, retryDelay(failure, entry.attempts));
    this.retryTimers.set(entry.clientId, timer);
  }

  /**
   * Runs one request with the outbox's abort and its own time limit. Over the limit the request is aborted and `SendTimedOut`
   * thrown at once, whether or not the transport honours the signal, so a hanging answer never holds the queue.
   */
  private async limited<T>(run: (signal: AbortSignal) => Promise<T>, limitMs: number): Promise<T> {
    const attempt = new AbortController();
    const outer = this.controller.signal;
    const onOuter = () => attempt.abort();
    outer.addEventListener('abort', onOuter);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        attempt.abort();
        reject(new SendTimedOut());
      }, limitMs);
    });
    try {
      return await Promise.race([run(attempt.signal), limit]);
    } finally {
      clearTimeout(timer);
      outer.removeEventListener('abort', onOuter);
    }
  }

  private update(entry: OutboxEntry, patch: Partial<Pick<OutboxEntry, 'state' | 'failure' | 'attempts' | 'draft'>>): OutboxEntry {
    const next: OutboxEntry = { ...entry, ...patch };
    this.entriesById.set(entry.clientId, next);
    this.changed(entry.conversationId);
    return next;
  }

  private changed(conversationId: string): void {
    this.snapshots.delete(conversationId);
    this.listeners.forEach((listener) => listener());
  }

  /** The next message of the conversation to send, or null: the oldest queued one that no holding failure stands before. */
  private next(conversationId: string): OutboxEntry | null {
    for (const entry of this.entries(conversationId)) {
      if (entry.state === 'failed' && holdsQueue(entry.failure)) return null;
      if (entry.state === 'sending') return null;
      if (entry.state === 'queued') return entry;
    }
    return null;
  }

  private async pump(conversationId: string): Promise<void> {
    if (this.pumping.has(conversationId)) return;
    this.pumping.add(conversationId);
    try {
      while (!this.disposedFlag && this.online) {
        const entry = this.next(conversationId);
        if (!entry) break;
        await this.sendOne(entry);
      }
    } finally {
      this.pumping.delete(conversationId);
    }
  }

  private async sendOne(queued: OutboxEntry): Promise<void> {
    let entry = this.update(queued, { state: 'sending', attempts: queued.attempts + 1 });
    try {
      let mediaId: string | null = null;
      if (entry.draft.kind === 'photo') {
        mediaId = entry.draft.mediaId;
        if (!mediaId) {
          const photo = entry.draft.photo;
          const conversationId = entry.conversationId;
          mediaId = await this.limited((signal) => this.options.transport.uploadPhoto(conversationId, photo, signal), this.options.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS);
          const current = this.entriesById.get(entry.clientId);
          if (this.disposedFlag || !current) return;
          entry = this.update(current, { draft: { ...entry.draft, mediaId } });
        }
      }
      const sending = entry;
      const message = await this.limited(
        (signal) =>
          this.options.transport.send({
            conversationId: sending.conversationId,
            clientId: sending.clientId,
            idempotencyKey: sending.idempotencyKey,
            draft: sending.draft,
            mediaId,
            signal,
          }),
        this.options.sendTimeoutMs ?? SEND_TIMEOUT_MS,
      );
      // Disposed: another session. Gone: the server's copy came by polling first.
      if (this.disposedFlag || !this.entriesById.has(entry.clientId)) return;
      this.options.onDelivered?.(entry.conversationId, { ...message, key: entry.clientId, clientId: entry.clientId });
      this.entriesById.delete(entry.clientId);
      this.release(entry);
      this.changed(entry.conversationId);
    } catch (error) {
      if (this.disposedFlag || isAbort(error)) return;
      const current = this.entriesById.get(entry.clientId);
      if (!current) return;
      // A send without an answer in time counts as no connection: it is retried with the same keys.
      const failure = error instanceof SendTimedOut ? { reason: 'network' as const, message: this.options.classify(error).message } : this.options.classify(error);
      if (failure.reason === 'network' && !this.online) {
        this.update(current, { state: 'queued', failure: null });
        return;
      }
      const failed = this.update(current, { state: 'failed', failure });
      if (RETRIED.has(failure.reason)) this.scheduleRetry(failed, failure);
      this.options.onFailed?.(entry.conversationId, failure);
    }
  }
}

/** A send or upload that did not answer in time. */
export class SendTimedOut extends Error {
  constructor() {
    super('send timed out');
    this.name = 'SendTimedOut';
  }
}

export function createOutbox(options: OutboxOptions): Outbox {
  return new Outbox(options);
}

/** The optimistic bubble of an entry. */
export function entryToMessage(entry: OutboxEntry): ThreadMessage {
  const { draft } = entry;
  return {
    key: entry.clientId,
    id: null,
    clientId: entry.clientId,
    kind: draft.kind,
    body: draft.kind === 'text' ? draft.body : null,
    media: null,
    localPhoto: draft.kind === 'photo' ? { uri: draft.photo.uri, width: draft.photo.width, height: draft.photo.height } : null,
    vehicle: draft.kind === 'vehicle' ? draft.vehicle : null,
    mine: true,
    senderDeleted: false,
    senderUsername: null,
    createdAt: entry.createdAt,
    reactions: [],
    delivery: entry.state,
    failure: entry.failure,
  };
}
