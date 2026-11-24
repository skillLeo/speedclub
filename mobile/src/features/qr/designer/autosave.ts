/**
 * STK-05 autosave (m5.4-contract §3.1): PUT the editor's state 1.2 s after the last change, with the version and the draft revision the
 * editor last saw as `base_version` / `base_revision`. One save at a time; a change during a save is sent right after it. The server
 * decides the version: a draft is updated in place (its revision rises), an edit after a passed Scan-Test opens version n + 1, an
 * unchanged state writes nothing.
 *
 * Honest outcomes, never a silent loss:
 * - 409 `edit_conflict`: another device saved in between (the version or the draft revision moved, review MF-4). The queue stops and
 *   keeps the member's state; the screen asks whether to load the newer version or to keep this one (`resolveConflict`).
 * - 422: the server refused a field (the custom line's screening, `content_blocked`): the queue waits for the next change.
 * - 403: a suspended owner may look but not write.
 * - no connection: the queue keeps the state and sends it when `resume()` is called (back online, "Erneut versuchen").
 * - 429 / 5xx: tries again after the server's Retry-After, or with a growing pause, at most three times; then "error" with retry.
 *
 * `flush()` waits for a save already on its way and then sends what is still waiting, until nothing waits (review MF-2). `close()` is
 * the screen going away: it stops talking to the screen but still sends what the member did.
 */
import { ApiError } from '@/api/client';
import type { StickerDesign } from '@/api/queries/stickers';

import { payloadOptions, stateKey, stateOf, type DesignState } from './model';

export const AUTOSAVE_DELAY_MS = 1200;
const RETRY_BASE_MS = 2000;
const RETRY_LIMIT = 3;
/** A flush never loops forever: a save that keeps answering with a newer change stops after this many rounds. */
const FLUSH_ROUNDS = 5;

export type AutosaveStatus =
  /** Nothing to save. */
  | 'saved'
  /** A change waits for the pause after typing. */
  | 'pending'
  | 'saving'
  | 'offline'
  | 'conflict'
  | 'invalid'
  | 'forbidden'
  | 'error';

export type AutosaveEvent =
  | { type: 'status'; status: AutosaveStatus }
  | { type: 'saved'; design: StickerDesign; sent: DesignState }
  | { type: 'invalid'; fieldErrors: Readonly<Record<string, readonly string[]>>; code: string; message: string };

export type AutosaveSave = (input: { baseVersion: number; baseRevision: number; state: DesignState; keepalive: boolean }) => Promise<StickerDesign>;

/** What the queue needs of a design: where it stands and what it holds. */
export type AutosaveBase = Pick<StickerDesign, 'version' | 'revision' | 'template' | 'options'>;

type Timers = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const DEFAULT_TIMERS: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class AutosaveQueue {
  private baseVersion: number;
  private baseRevision: number;
  private savedKey: string;
  private pending: DesignState | null = null;
  private inFlight: Promise<void> | null = null;
  private timer: unknown = null;
  private failures = 0;
  private closed = false;
  private current: AutosaveStatus = 'saved';
  private saves = 0;
  private keepalive = false;

  constructor(
    base: AutosaveBase,
    private readonly save: AutosaveSave,
    private onEvent: (event: AutosaveEvent) => void = () => undefined,
    private readonly delayMs: number = AUTOSAVE_DELAY_MS,
    private readonly timers: Timers = DEFAULT_TIMERS,
  ) {
    this.baseVersion = base.version;
    this.baseRevision = base.revision;
    this.savedKey = stateKey(stateOf(base));
  }

  get status(): AutosaveStatus {
    return this.current;
  }

  get version(): number {
    return this.baseVersion;
  }

  get revision(): number {
    return this.baseRevision;
  }

  /** How many saves this device has made: a Scan-Test 409 after one of them is the member's own change, not another device's. */
  get saveCount(): number {
    return this.saves;
  }

  /** True while something the member did is not on the server. */
  get unsaved(): boolean {
    return this.pending !== null || this.inFlight !== null;
  }

  /** The screen's handler of the moment (it changes with every render's state). */
  listen(handler: (event: AutosaveEvent) => void): void {
    this.onEvent = handler;
  }

  /**
   * The state the server holds now (after the Scan-Test, a reload, a restore). A change that waits and differs from it is still the
   * member's wish: it is sent after the usual pause instead of being dropped (review MF-1).
   */
  rebase(design: AutosaveBase): void {
    this.cancelTimer();
    this.baseVersion = design.version;
    this.baseRevision = design.revision;
    this.savedKey = stateKey(stateOf(design));
    this.failures = 0;
    if (this.pending && stateKey(this.pending) !== this.savedKey) {
      if (this.current !== 'conflict' && this.current !== 'forbidden') {
        this.setStatus('pending');
        this.schedule(this.delayMs);
      }
      return;
    }
    this.pending = null;
    if (!this.inFlight) this.setStatus('saved');
  }

  /** The editor changed. Back to the saved state: nothing waits. */
  change(state: DesignState): void {
    if (this.closed) return;
    if (this.current === 'conflict' || this.current === 'forbidden') {
      // Keeps the newest wish; nothing is sent until the member decides (conflict) or ever (forbidden).
      this.pending = state;
      return;
    }
    this.failures = 0;
    if (stateKey(state) === this.savedKey && !this.inFlight) {
      this.cancelTimer();
      this.pending = null;
      this.setStatus('saved');
      return;
    }
    this.pending = state;
    if (this.current !== 'offline') this.setStatus(this.inFlight ? 'saving' : 'pending');
    this.schedule(this.delayMs);
  }

  /**
   * Send now (before the Scan-Test, when the page is hidden, when the screen goes): waits for a save already on its way, then sends
   * what is still waiting, until nothing waits or a save fails (the status says why).
   */
  async flush(options: { keepalive?: boolean } = {}): Promise<void> {
    // The page is being left (web `pagehide`): the browser keeps the request alive after the page is gone (review SF-2). Only for
    // this flush: a tab that comes back saves normally again.
    if (options.keepalive) this.keepalive = true;
    try {
      this.cancelTimer();
      for (let round = 0; round < FLUSH_ROUNDS; round += 1) {
        if (this.inFlight) await this.inFlight;
        this.cancelTimer();
        if (!this.pending || !this.mayRun()) return;
        const before = this.saves;
        await this.run();
        // A failed save stops here: its status says why, and a retry keeps its own pause.
        if (this.saves === before) return;
      }
    } finally {
      if (options.keepalive) this.keepalive = false;
    }
  }


  /**
   * Before the Scan-Test: a design that was never saved (version 0, the server's default) is saved now even though nothing changed,
   * because the test needs a stored version. Otherwise the same as `flush`.
   */
  ensureSaved(state: DesignState): Promise<void> {
    if (this.baseVersion === 0 && !this.inFlight && this.pending === null) {
      this.pending = state;
      this.savedKey = '';
    }
    return this.flush();
  }

  /** Back online, "Erneut versuchen", the app back in front. */
  resume(): void {
    if (this.pending && (this.current === 'offline' || this.current === 'error')) {
      this.failures = 0;
      void this.flush();
    }
  }

  /**
   * After a 409: `keep` sends the member's state on top of the newer version; otherwise the newer version stands and the
   * member's state is dropped (the screen resets the editor to it).
   */
  resolveConflict(newest: AutosaveBase, keep: boolean, mine: DesignState | null = this.pending): void {
    this.cancelTimer();
    this.baseVersion = newest.version;
    this.baseRevision = newest.revision;
    this.savedKey = stateKey(stateOf(newest));
    this.pending = null;
    this.setStatus('saved');
    if (keep && mine) this.change(mine);
  }

  /**
   * The screen goes: no more events to it, but what the member did is still sent (a save on its way, a change waiting for its pause).
   * The caller keeps the server's cache current from the save itself, so that still happens after the screen is gone.
   */
  close(): Promise<void> {
    const done = this.flush();
    this.closed = true;
    return done;
  }

  private mayRun(): boolean {
    return this.current !== 'conflict' && this.current !== 'forbidden' && this.current !== 'invalid';
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private emit(event: AutosaveEvent): void {
    if (!this.closed) this.onEvent(event);
  }

  private setStatus(status: AutosaveStatus): void {
    if (this.current === status) return;
    this.current = status;
    this.emit({ type: 'status', status });
  }

  private run(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const state = this.pending;
    if (!state) return Promise.resolve();
    if (stateKey(state) === this.savedKey) {
      this.pending = null;
      this.setStatus('saved');
      return Promise.resolve();
    }
    this.pending = null;
    this.setStatus('saving');
    const sent: DesignState = { template: state.template, options: payloadOptions(state.options) };
    const attempt = this.send(state, sent);
    this.inFlight = attempt;
    return attempt;
  }

  private async send(state: DesignState, sent: DesignState): Promise<void> {
    try {
      const design = await this.save({ baseVersion: this.baseVersion, baseRevision: this.baseRevision, state: sent, keepalive: this.keepalive });
      this.inFlight = null;
      this.failures = 0;
      this.saves += 1;
      this.baseVersion = design.version;
      this.baseRevision = design.revision;
      this.savedKey = stateKey(stateOf(design));
      this.emit({ type: 'saved', design, sent });
      if (this.pending && stateKey(this.pending) !== this.savedKey) {
        this.setStatus('pending');
        // After the screen went, the flush loop sends it; on screen, right away.
        if (!this.closed) this.schedule(0);
      } else {
        this.pending = null;
        this.setStatus('saved');
      }
    } catch (error) {
      this.inFlight = null;
      // What the member wanted stays wanted: a newer change wins over the one that failed.
      this.pending = this.pending ?? state;
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (!(error instanceof ApiError)) {
      this.setStatus('error');
      return;
    }
    if (error.status === 409 && error.code === 'edit_conflict') {
      this.setStatus('conflict');
      return;
    }
    if (error.status === 422) {
      this.setStatus('invalid');
      this.emit({ type: 'invalid', fieldErrors: error.fieldErrors, code: error.code, message: error.message });
      return;
    }
    if (error.status === 403) {
      this.setStatus('forbidden');
      return;
    }
    if (error.kind === 'network' || error.status === 0) {
      this.setStatus('offline');
      return;
    }
    this.failures += 1;
    if ((error.status === 429 || error.status >= 500) && this.failures < RETRY_LIMIT && !this.closed) {
      this.setStatus('pending');
      this.schedule(error.retryAfter !== null ? error.retryAfter * 1000 : RETRY_BASE_MS * this.failures);
      return;
    }
    this.setStatus('error');
  }
}
