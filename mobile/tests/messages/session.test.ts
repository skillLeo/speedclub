// The messaging session (ADR-175, ADR-182, ADR-185): the outbox and the socket belong to one member and end with the session.
import { ApiError } from '@/api/client';
import { unavailableMessaging, type MessagingAdapter } from '@/features/messages/data';
import { classifyError } from '@/features/messages/errors';
import { currentOutbox, endMessagingSession, outboxFor } from '@/features/messages/session';
import { notifyConsentAccepted } from '@/state/consent';
import { setGuest, setMember, setMemberChanged, useSessionStore } from '@/state/session';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `uuid-${(n += 1)}` };
});
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));

const sends: AbortSignal[] = [];
const adapter: MessagingAdapter = {
  ...unavailableMessaging,
  available: true,
  transport: {
    uploadPhoto: () => Promise.resolve('m'),
    send: ({ signal }) => {
      sends.push(signal);
      return new Promise(() => undefined);
    },
  },
};

const member = (id: string) => ({ id, username: id, displayName: null, avatarUrl: null });

afterEach(() => {
  endMessagingSession();
  useSessionStore.setState({ status: 'loading', member: null, memberChanged: false });
});

describe('messaging session', () => {
  it('has no outbox for a guest or while the adapter is not available', () => {
    expect(outboxFor(null, adapter)).toBeNull();
    expect(outboxFor('m1', unavailableMessaging)).toBeNull();
  });

  it('gives the same outbox to every screen of one member', () => {
    setMember(member('m1'));
    expect(outboxFor('m1', adapter)).toBe(outboxFor('m1', adapter));
  });

  it('sign-out discards the outbox and aborts the send under way', () => {
    setMember(member('m1'));
    const outbox = outboxFor('m1', adapter);
    outbox?.enqueue('c1', { kind: 'text', body: 'Noch eine Frage zum Fahrwerk' });
    expect(sends).toHaveLength(1);
    setGuest();
    expect(sends[0]!.aborted).toBe(true);
    expect(outbox?.disposed).toBe(true);
    expect(currentOutbox()).toBeNull();
  });

  it('another member never gets the previous member\'s outbox', () => {
    setMember(member('m1'));
    const first = outboxFor('m1', adapter);
    first?.enqueue('c1', { kind: 'text', body: 'Hallo' });
    setMember(member('m2'));
    expect(first?.disposed).toBe(true);
    const second = outboxFor('m2', adapter);
    expect(second).not.toBe(first);
    expect(second?.entries('c1')).toHaveLength(0);
  });

  it('a member change in another tab ends it before the old screens are gone (ADR-182)', () => {
    setMember(member('m1'));
    const outbox = outboxFor('m1', adapter);
    setMemberChanged(true);
    expect(outbox?.disposed).toBe(true);
  });

  it('a message refused for the missing re-consent waits with its text and goes out once the member accepted (SF-2)', async () => {
    const refusal = new ApiError({ kind: 'forbidden', status: 403, code: 'consent_required', message: 'Stimm zuerst den geänderten Bedingungen zu, dann geht es weiter.' });
    const bodies: string[] = [];
    let refuse = true;
    const consenting: MessagingAdapter = {
      ...adapter,
      classify: (error) => classifyError(error, 'Nicht gesendet'),
      transport: {
        uploadPhoto: () => Promise.resolve('m'),
        send: ({ draft }) => {
          bodies.push(draft.kind === 'text' ? draft.body : draft.kind);
          return refuse ? Promise.reject(refusal) : new Promise(() => undefined);
        },
      },
    };
    setMember(member('m1'));
    const outbox = outboxFor('m1', consenting);
    outbox?.enqueue('c1', { kind: 'text', body: 'Noch eine Frage zum Fahrwerk' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Not "cannot message": the conversation is fine, and the bubble keeps "Erneut senden".
    expect(outbox?.entries('c1')[0]).toMatchObject({
      state: 'failed',
      failure: { reason: 'consent_required', message: 'Stimm zuerst den geänderten Bedingungen zu, dann geht es weiter.' },
      draft: { kind: 'text', body: 'Noch eine Frage zum Fahrwerk' },
    });

    refuse = false;
    notifyConsentAccepted();
    expect(bodies).toEqual(['Noch eine Frage zum Fahrwerk', 'Noch eine Frage zum Fahrwerk']);
    expect(outbox?.entries('c1')[0]?.state).toBe('sending');
  });
});
