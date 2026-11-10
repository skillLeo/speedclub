import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { UNREAD_POLL_MS } from '@/api/queries/notifications';
import { useTabBadges } from '@/features/shell/useTabBadges';
import { useSessionStore } from '@/state/session';

import { callsTo, newQueryClient, stubFetch } from '../home/harness';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const COUNT = (notifications: number, messages = 0, requests = 0) => ({ body: { data: { notifications, messages, requests } } });

function renderBadges() {
  const client = newQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useTabBadges(), { wrapper });
}

const signIn = () => useSessionStore.setState({ status: 'member', member: { id: 'm1', username: 'lukas.sc', displayName: null, avatarUrl: null } });

beforeEach(() => {
  useSessionStore.setState({ status: 'guest', member: null });
  focusManager.setFocused(true);
});
afterEach(() => {
  jest.useRealTimers();
  focusManager.setFocused(undefined);
});

describe('tab badges (notifications/unread-count)', () => {
  it('asks nothing for a guest and shows nothing', async () => {
    const { calls } = stubFetch({ '/notifications/unread-count': COUNT(4) });
    const { result } = await renderBadges();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(result.current).toEqual({ messages: 0, home: false, notifications: 0 });
    expect(callsTo(calls, '/notifications/unread-count')).toHaveLength(0);
  });

  it('puts the dot on Start and messages plus requests on Nachrichten', async () => {
    signIn();
    stubFetch({ '/notifications/unread-count': COUNT(3, 2, 1) });
    const { result } = await renderBadges();
    await waitFor(() => expect(result.current).toEqual({ messages: 3, home: true, notifications: 3 }));
  });

  it('asks again every 60 s in the foreground, pauses in the background, and asks on return', async () => {
    jest.useFakeTimers();
    signIn();
    const { calls } = stubFetch({ '/notifications/unread-count': COUNT(1) });
    await renderBadges();
    await act(async () => jest.advanceTimersByTimeAsync(10));
    expect(callsTo(calls, '/notifications/unread-count')).toHaveLength(1);

    await act(async () => jest.advanceTimersByTimeAsync(UNREAD_POLL_MS));
    expect(callsTo(calls, '/notifications/unread-count')).toHaveLength(2);

    // The app goes to the background: no polling there.
    await act(async () => focusManager.setFocused(false));
    await act(async () => jest.advanceTimersByTimeAsync(3 * UNREAD_POLL_MS));
    expect(callsTo(calls, '/notifications/unread-count')).toHaveLength(2);

    // Back in front: one at once, then the 60 s again.
    await act(async () => focusManager.setFocused(true));
    await act(async () => jest.advanceTimersByTimeAsync(10));
    expect(callsTo(calls, '/notifications/unread-count')).toHaveLength(3);
    await act(async () => jest.advanceTimersByTimeAsync(UNREAD_POLL_MS));
    expect(callsTo(calls, '/notifications/unread-count')).toHaveLength(4);
  });

  it('shows nothing when the count cannot be read', async () => {
    signIn();
    stubFetch({ '/notifications/unread-count': { status: 500, body: { message: 'Serverfehler', code: 'server', errors: {} } } });
    const { result } = await renderBadges();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(result.current.home).toBe(false);
  });
});
