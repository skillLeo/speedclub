// The realtime hub (contract §3): only with keys, auth through the API with a signal, ids-only events, teardown per member.
import { RealtimeHub, type ConnectionFactory, type ConnectionState, type RealtimeConnection } from '@/features/messages/realtime';

type Listener = { name: string; event: string; handler: (payload: unknown) => void };

function fakeFactory() {
  const made: {
    options: Parameters<ConnectionFactory>[0];
    listeners: Listener[];
    left: string[];
    disconnected: boolean;
    setState: (state: ConnectionState) => void;
    subscriptions: Map<string, (ok: boolean) => void>;
  }[] = [];
  const factory: ConnectionFactory = async (options) => {
    const record = {
      options,
      listeners: [] as Listener[],
      left: [] as string[],
      disconnected: false,
      setState: (_: ConnectionState): void => undefined,
      subscriptions: new Map<string, (ok: boolean) => void>(),
    };
    let stateListener: ((state: ConnectionState) => void) | null = null;
    record.setState = (state) => stateListener?.(state);
    made.push(record);
    const connection: RealtimeConnection = {
      listen: (name, event, handler) => {
        const listener = { name, event, handler };
        record.listeners.push(listener);
        return () => {
          record.listeners = record.listeners.filter((item) => item !== listener);
        };
      },
      leave: (name) => record.left.push(name),
      onSubscription: (name, listener) => {
        record.subscriptions.set(name, listener);
      },
      onState: (listener) => {
        stateListener = listener;
        return () => {
          stateListener = null;
        };
      },
      disconnect: () => {
        record.disconnected = true;
      },
    };
    return connection;
  };
  return { factory, made };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const ON = { enabled: true, key: 'public-key', cluster: 'eu' };
const authorize = jest.fn((_channel: string, _socket: string, _signal: AbortSignal) => Promise.resolve({ auth: 'sig' }));

function emit(listeners: Listener[], name: string, event: string, payload: unknown) {
  listeners.filter((item) => item.name === name && item.event === event).forEach((item) => item.handler(payload));
}

describe('realtime hub', () => {
  it('never connects without realtime enabled and a key', async () => {
    const { factory, made } = fakeFactory();
    const hub = new RealtimeHub(factory);
    hub.configure({ memberId: 'm1', config: { enabled: false, key: null, cluster: null }, authorize });
    hub.watchConversation('c1', {});
    await flush();
    expect(made).toHaveLength(0);
    hub.configure({ memberId: 'm1', config: { enabled: true, key: null, cluster: 'eu' }, authorize });
    await flush();
    expect(made).toHaveLength(0);
    expect(hub.status.get()).toBe(false);
  });

  it('subscribes the private channels and passes events on with ids only', async () => {
    const { factory, made } = fakeFactory();
    const hub = new RealtimeHub(factory);
    hub.configure({ memberId: 'm1', config: ON, authorize });
    const onMessage = jest.fn();
    const onTyping = jest.fn();
    const onInbox = jest.fn();
    hub.watchConversation('c1', { onMessage, onTyping });
    hub.watchUser({ onMessage: onInbox });
    await flush();
    expect(made).toHaveLength(1);
    expect(made[0]!.options).toMatchObject({ key: 'public-key', cluster: 'eu' });
    emit(made[0]!.listeners, 'conversation.c1', 'MessageSent', { conversation_id: 'c1', message_id: '01X' });
    emit(made[0]!.listeners, 'conversation.c1', 'Typing', { conversation_id: 'c1' });
    emit(made[0]!.listeners, 'user.m1', 'MessageSent', { conversation_id: 'c2' });
    expect(onMessage).toHaveBeenCalledWith('01X');
    expect(onTyping).toHaveBeenCalled();
    expect(onInbox).toHaveBeenCalledWith('c2');
  });

  it('reports the connection, so polling slows to the safety net and speeds up on a drop', async () => {
    const { factory, made } = fakeFactory();
    const hub = new RealtimeHub(factory);
    const seen: boolean[] = [];
    hub.status.subscribe(() => seen.push(hub.status.get()));
    hub.configure({ memberId: 'm1', config: ON, authorize });
    hub.watchConversation('c1', {});
    await flush();
    made[0]!.setState('connected');
    made[0]!.setState('disconnected');
    expect(seen).toEqual([true, false]);
  });

  it('authorises through the API with a signal that the teardown aborts', async () => {
    const { factory, made } = fakeFactory();
    const hub = new RealtimeHub(factory);
    hub.configure({ memberId: 'm1', config: ON, authorize });
    hub.watchConversation('c1', {});
    await flush();
    await made[0]!.options.authorize('private-conversation.c1', '123.456');
    const signal = authorize.mock.calls.at(-1)?.[2];
    expect(authorize.mock.calls.at(-1)?.slice(0, 2)).toEqual(['private-conversation.c1', '123.456']);
    expect(signal?.aborted).toBe(false);
    hub.configure(null);
    expect(signal?.aborted).toBe(true);
  });

  it('a member change disconnects, forgets the listeners and drops late events of the old session', async () => {
    const { factory, made } = fakeFactory();
    const hub = new RealtimeHub(factory);
    hub.configure({ memberId: 'm1', config: ON, authorize });
    const onMessage = jest.fn();
    hub.watchConversation('c1', { onMessage });
    await flush();
    const old = made[0]!;
    hub.configure({ memberId: 'm2', config: ON, authorize });
    expect(old.disconnected).toBe(true);
    emit(old.listeners, 'conversation.c1', 'MessageSent', { message_id: '01X' });
    expect(onMessage).not.toHaveBeenCalled();
    expect(hub.memberId).toBe('m2');
    // Nothing of the old member is watched any more, so the new session does not connect by itself.
    await flush();
    expect(made).toHaveLength(1);
  });

  it('a connection that answers after the teardown is closed at once', async () => {
    let finish: (connection: RealtimeConnection) => void = () => undefined;
    const pending: RealtimeConnection = {
      listen: () => () => undefined,
      leave: () => undefined,
      onSubscription: () => undefined,
      onState: () => () => undefined,
      disconnect: jest.fn(),
    };
    const hub = new RealtimeHub(() => new Promise((resolve) => (finish = resolve)));
    hub.configure({ memberId: 'm1', config: ON, authorize });
    hub.watchConversation('c1', {});
    hub.teardown();
    finish(pending);
    await flush();
    expect(pending.disconnect).toHaveBeenCalled();
  });

  it('counts a channel live only once the socket is up and its subscription succeeded (review 9)', async () => {
    const { factory, made } = fakeFactory();
    const hub = new RealtimeHub(factory);
    hub.configure({ memberId: 'm1', config: ON, authorize });
    hub.watchConversation('c1', {});
    await flush();
    const live = hub.channelLive('conversation.c1');
    expect(live).toBe(hub.channelLive('conversation.c1'));
    made[0]!.setState('connected');
    expect(live.get()).toBe(false);
    made[0]!.subscriptions.get('conversation.c1')?.(true);
    expect(live.get()).toBe(true);
    made[0]!.subscriptions.get('conversation.c1')?.(false);
    expect(live.get()).toBe(false);
    made[0]!.subscriptions.get('conversation.c1')?.(true);
    made[0]!.setState('disconnected');
    expect(live.get()).toBe(false);
  });

  it('leaves a channel when its last listener goes', async () => {
    const { factory, made } = fakeFactory();
    const hub = new RealtimeHub(factory);
    hub.configure({ memberId: 'm1', config: ON, authorize });
    const stop = hub.watchConversation('c1', {});
    await flush();
    stop();
    expect(made[0]!.left).toEqual(['conversation.c1']);
    expect(made[0]!.listeners).toHaveLength(0);
  });
});
