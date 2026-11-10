/**
 * Realtime over Pusher Channels (EU) with laravel-echo (05 §11, contract §3), only when `app-config.realtime.enabled` and a key are
 * there. It is an accelerator, never the source of truth: events carry ids only (no body), and every event just asks the
 * poller to fetch now. Polling keeps working beside it at a 30 s safety net and returns to full pace the moment the socket drops.
 *
 * Safety (ADR-175, ADR-185): the hub belongs to one member. Private channels are authorised through the API client
 * (`POST broadcasting/auth`, token on native, cookie + XSRF on web), with a signal the hub aborts on teardown. Sign-out, an
 * expired session or another member tears the connection down and drops every listener; an event that still arrives belongs to
 * a connection generation that no longer exists and is ignored.
 *
 * laravel-echo and pusher-js load on first use (dynamic import), so a build without keys never pays for them.
 */
import type { Observable } from './pollScheduler';

export type RealtimeConfig = { enabled: boolean; key: string | null; cluster: string | null };

export type ChannelAuth = { auth: string; channel_data?: string };

/** `POST broadcasting/auth` through the API client. */
export type AuthorizeChannel = (channelName: string, socketId: string, signal: AbortSignal) => Promise<ChannelAuth>;

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'failed';

/** The part of Echo the hub uses, so tests can stand in for the socket. */
export type RealtimeConnection = {
  /** `name` without the `private-` prefix, as Echo's `private()` takes it. */
  listen: (name: string, event: string, handler: (payload: unknown) => void) => () => void;
  leave: (name: string) => void;
  /** `pusher:subscription_succeeded` (true) and `pusher:subscription_error` (false) of one private channel. */
  onSubscription: (name: string, listener: (subscribed: boolean) => void) => void;
  onState: (listener: (state: ConnectionState) => void) => () => void;
  disconnect: () => void;
};

export type ConnectionFactory = (options: { key: string; cluster: string; authorize: (channelName: string, socketId: string) => Promise<ChannelAuth> }) => Promise<RealtimeConnection>;

/**
 * Event names as Echo formats them with the `App.Events` namespace. The API handover confirms them; a `broadcastAs` name needs a
 * leading dot here.
 */
export const REALTIME_EVENTS = {
  messageSent: 'MessageSent',
  conversationRead: 'ConversationRead',
  typing: 'Typing',
  unreadChanged: 'UnreadChanged',
} as const;

export type ConversationEvents = {
  onMessage?: (messageId: string | null) => void;
  onRead?: (messageId: string | null) => void;
  onTyping?: () => void;
};

export type UserEvents = {
  onMessage?: (conversationId: string | null) => void;
  onUnreadChanged?: () => void;
};

function stringField(payload: unknown, field: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

type Session = { memberId: string; config: RealtimeConfig; authorize: AuthorizeChannel };

/** The default connection: Echo + pusher-js, TLS, no third-party interceptors. */
export const createEchoConnection: ConnectionFactory = async ({ key, cluster, authorize }) => {
  const [{ default: Echo }, { default: Pusher }] = await Promise.all([import('laravel-echo'), import('pusher-js')]);
  const echo = new Echo<'pusher'>({
    broadcaster: 'pusher',
    key,
    cluster,
    forceTLS: true,
    withoutInterceptors: true,
    Pusher,
    channelAuthorization: {
      customHandler: ({ channelName, socketId }: { channelName: string; socketId: string }, callback: (error: Error | null, data: ChannelAuth | null) => void) => {
        authorize(channelName, socketId).then(
          (data) => callback(null, data),
          (error: unknown) => callback(error instanceof Error ? error : new Error('channel authorisation failed'), null),
        );
      },
    },
  });
  return {
    listen: (name, event, handler) => {
      const channel = echo.private(name);
      channel.listen(event, handler);
      return () => {
        channel.stopListening(event, handler);
      };
    },
    leave: (name) => echo.leave(name),
    onSubscription: (name, listener) => {
      const channel = echo.private(name);
      channel.subscribed(() => listener(true));
      channel.error(() => listener(false));
    },
    onState: (listener) => echo.connector.onConnectionChange(listener),
    disconnect: () => echo.disconnect(),
  };
};

export class RealtimeHub {
  private readonly factory: ConnectionFactory;
  private session: Session | null = null;
  private connection: RealtimeConnection | null = null;
  private connecting: Promise<void> | null = null;
  /** Counts connections: an answer or a state of an older one is dropped. */
  private generation = 0;
  /** Counts sessions: an event or an unsubscribe of an older member's screen is dropped. */
  private sessionGeneration = 0;
  private controller = new AbortController();
  private connected = false;
  private readonly statusListeners = new Set<() => void>();
  private readonly watchers = new Map<string, { event: string; handler: (payload: unknown) => void; off: (() => void) | null }[]>();
  private offState: (() => void) | null = null;
  /** Channels whose subscription the server confirmed on the current connection. */
  private readonly subscribed = new Set<string>();
  private readonly channelObservables = new Map<string, Observable<boolean>>();

  constructor(factory: ConnectionFactory = createEchoConnection) {
    this.factory = factory;
  }

  /** Connected right now: the poller slows to its safety net. */
  readonly status: Observable<boolean> = {
    get: () => this.connected,
    subscribe: (listener) => {
      this.statusListeners.add(listener);
      return () => {
        this.statusListeners.delete(listener);
      };
    },
  };

  /**
   * Who is signed in and what app-config allows. Another member (or none) tears everything down, listeners included; a changed
   * config for the same member reconnects and keeps the listeners of the screens on show.
   */
  configure(session: Session | null): void {
    const previous = this.session;
    if (!session || !previous || session.memberId !== previous.memberId) {
      this.teardown();
      this.session = session;
      return;
    }
    const sameConfig =
      session.config.enabled === previous.config.enabled &&
      session.config.key === previous.config.key &&
      session.config.cluster === previous.config.cluster;
    this.session = session;
    if (sameConfig) return;
    this.closeConnection();
    if (this.watchers.size > 0) void this.ensureConnection();
  }

  /**
   * Live for one channel (review 9): the socket is connected **and** the server confirmed this channel's subscription. Only then
   * does a poller slow to its safety net; a refused or pending subscription keeps the full pace. The same object per name.
   */
  channelLive(name: string): Observable<boolean> {
    let observable = this.channelObservables.get(name);
    if (!observable) {
      observable = { get: () => this.connected && this.subscribed.has(name), subscribe: this.status.subscribe };
      this.channelObservables.set(name, observable);
    }
    return observable;
  }

  get memberId(): string | null {
    return this.session?.memberId ?? null;
  }

  /** `private-user.{own id}`: new messages anywhere, unread changes. */
  watchUser(events: UserEvents): () => void {
    const memberId = this.session?.memberId;
    if (!memberId) return () => undefined;
    return this.watch(`user.${memberId}`, [
      [REALTIME_EVENTS.messageSent, (payload) => events.onMessage?.(stringField(payload, 'conversation_id'))],
      [REALTIME_EVENTS.unreadChanged, () => events.onUnreadChanged?.()],
    ]);
  }

  /** `private-conversation.{id}`: messages, read and typing of one open conversation. */
  watchConversation(conversationId: string, events: ConversationEvents): () => void {
    if (!this.session) return () => undefined;
    return this.watch(`conversation.${conversationId}`, [
      [REALTIME_EVENTS.messageSent, (payload) => events.onMessage?.(stringField(payload, 'message_id'))],
      [REALTIME_EVENTS.conversationRead, (payload) => events.onRead?.(stringField(payload, 'message_id'))],
      [REALTIME_EVENTS.typing, () => events.onTyping?.()],
    ]);
  }

  /** Sign-out, expiry, another member: disconnect, abort authorisations, forget every listener of this session. */
  teardown(): void {
    this.sessionGeneration += 1;
    this.closeConnection();
    this.watchers.clear();
    this.session = null;
  }

  private closeConnection(): void {
    this.generation += 1;
    this.controller.abort();
    this.controller = new AbortController();
    this.offState?.();
    this.offState = null;
    this.connection?.disconnect();
    this.connection = null;
    this.connecting = null;
    for (const entries of this.watchers.values()) entries.forEach((entry) => (entry.off = null));
    const hadChannels = this.subscribed.size > 0;
    this.subscribed.clear();
    if (hadChannels && !this.connected) this.notify();
    this.setConnected(false);
  }

  private enabled(): boolean {
    const config = this.session?.config;
    return Boolean(config?.enabled && config.key && config.cluster);
  }

  private setConnected(next: boolean): void {
    if (next === this.connected) return;
    this.connected = next;
    this.notify();
  }

  private notify(): void {
    this.statusListeners.forEach((listener) => listener());
  }

  private trackSubscription(name: string): void {
    if (!this.connection) return;
    const generation = this.generation;
    this.connection.onSubscription(name, (ok) => {
      if (generation !== this.generation) return;
      const had = this.subscribed.has(name);
      if (ok) this.subscribed.add(name);
      else this.subscribed.delete(name);
      if (had !== ok) this.notify();
    });
  }

  private watch(name: string, bindings: [string, (payload: unknown) => void][]): () => void {
    const generation = this.sessionGeneration;
    const entries = bindings.map(([event, handler]) => ({
      event,
      // A late event of an older generation is dropped.
      handler: (payload: unknown) => {
        if (generation === this.sessionGeneration) handler(payload);
      },
      off: null as (() => void) | null,
    }));
    const list = this.watchers.get(name) ?? [];
    const first = list.length === 0;
    list.push(...entries);
    this.watchers.set(name, list);
    if (this.connection) {
      if (first) this.trackSubscription(name);
      entries.forEach((entry) => this.bind(name, entry));
    }
    else void this.ensureConnection();
    return () => {
      if (generation !== this.sessionGeneration) return;
      entries.forEach((entry) => entry.off?.());
      const rest = (this.watchers.get(name) ?? []).filter((entry) => !entries.includes(entry));
      if (rest.length > 0) this.watchers.set(name, rest);
      else {
        this.watchers.delete(name);
        if (this.subscribed.delete(name)) this.notify();
        this.connection?.leave(name);
      }
    };
  }

  private bind(name: string, entry: { event: string; handler: (payload: unknown) => void; off: (() => void) | null }): void {
    if (!this.connection || entry.off) return;
    entry.off = this.connection.listen(name, entry.event, entry.handler);
  }

  private ensureConnection(): Promise<void> {
    if (this.connection || !this.enabled() || !this.session) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const generation = this.generation;
    const { config, authorize } = this.session;
    const signal = this.controller.signal;
    this.connecting = this.factory({
      key: config.key ?? '',
      cluster: config.cluster ?? '',
      authorize: (channelName, socketId) => authorize(channelName, socketId, signal),
    })
      .then((connection) => {
        if (generation !== this.generation) {
          connection.disconnect();
          return;
        }
        this.connection = connection;
        this.offState = connection.onState((state) => {
          if (generation === this.generation) this.setConnected(state === 'connected');
        });
        this.watchers.forEach((entries, name) => {
          this.trackSubscription(name);
          entries.forEach((entry) => this.bind(name, entry));
        });
      })
      .catch(() => {
        // Without the library or the socket the app polls at full pace, which is the designed fallback (ADR-009).
        if (generation === this.generation) this.setConnected(false);
      })
      .finally(() => {
        if (generation === this.generation) this.connecting = null;
      });
    return this.connecting;
  }
}

/** The app's one hub. `useMessagingSession` configures it for the member signed in and tears it down when that changes. */
export const realtimeHub = new RealtimeHub();
