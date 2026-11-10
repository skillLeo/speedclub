import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { meKey } from '@/api/queries/auth';
import { persistOptions } from '@/api/queryClient';
import { supportKeys } from '@/api/queries/settings';
import { referenceOf } from '@/features/settings/screens/ContactScreen';
import { SupportRequestsScreen } from '@/features/settings/screens/SupportRequestsScreen';
import { SupportThreadScreen } from '@/features/settings/screens/SupportThreadScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, stubFetch, type Answer } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/settings/help/requests',
  usePreventRemove: jest.fn(),
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()), notificationAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const TICKET = { id: '01tik', reference: 'SC-7H2KQXMB', category: 'qr', subject: 'Sticker lässt sich nicht scannen', status: 'pending', created_at: '2026-11-03T09:00:00Z' };
const THREAD = {
  ...TICKET,
  last_activity_at: '2026-11-04T10:00:00Z',
  messages: [
    { id: 'm1', author: 'member', body: 'Mein Sticker zeigt eine Fehlerseite.', created_at: '2026-11-03T09:00:00Z' },
    { id: 'm2', author: 'team', body: 'Danke, wir haben den Code neu ausgestellt. Probier es bitte noch einmal.', created_at: '2026-11-04T10:00:00Z' },
  ],
};

async function render(element: React.ReactElement, answers: Record<string, Answer | (() => Answer)>) {
  const stub = stubFetch(answers);
  const client = newQueryClient();
  client.setQueryData(meKey, { restrictions: { suspended: false, publishing: { restricted: false }, messaging: { restricted: false } } });
  await renderScreen(element, client);
  await act(async () => undefined);
  return { ...stub, client };
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  useSessionStore.setState({ status: 'member', member: MEMBER });
});

const MEMBER = { id: '01mem', username: 'lukas.sc', displayName: null, avatarUrl: null };

describe('SET-15a requests', () => {
  it('lists each request with reference, topic and status, and opens its thread', async () => {
    await render(<SupportRequestsScreen />, { '/support/tickets': { body: { data: [TICKET] } } });
    expect(await screen.findByText('Sticker lässt sich nicht scannen')).toBeTruthy();
    // DQ-671: the status is the pill SET-15b shows, not a trailing value beside the subject; the meta line wraps at its "·" only.
    expect(screen.getByTestId('SET-15a.row.01tik.status')).toHaveTextContent('Antwort vom Team');
    expect(screen.getByTestId('SET-15a.row.01tik.meta')).toHaveTextContent('SC-\u20607H2KQXMB\u00a0· QR-\u2060Sticker\u00a0· 03.11.2026', {
      normalizer: (text: string) => text,
    });
    await fireEvent.press(screen.getByTestId('SET-15a.row.01tik'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/settings/help/requests/[ticket]', params: { ticket: '01tik' } });
  });

  it('has an empty state with the way to a new request', async () => {
    await render(<SupportRequestsScreen />, { '/support/tickets': { body: { data: [] } } });
    expect(await screen.findByTestId('SET-15a.empty')).toBeTruthy();
  });

  it('shows the error with retry', async () => {
    await render(<SupportRequestsScreen />, { '/support/tickets': { status: 403, body: { message: 'x', code: 'forbidden' } } });
    expect(await screen.findByTestId('SET-15a.error')).toBeTruthy();
  });
});

describe('SET-15b thread', () => {
  it('shows the messages with the team as "Team" and the reply composer', async () => {
    mockParams = { ticket: '01tik' };
    await render(<SupportThreadScreen />, { '/support/tickets/01tik': { body: { data: THREAD } } });
    expect(await screen.findByText('Danke, wir haben den Code neu ausgestellt. Probier es bitte noch einmal.')).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.getByText('Du')).toBeTruthy();
    expect(screen.getByTestId('SET-15b.reply.input')).toBeTruthy();
    // DQ-670: members get no e-mail for a reply, only the in-app notice.
    expect(screen.getByTestId('SET-15b.replyHint')).toHaveTextContent('Deine Nachricht landet in dieser Anfrage beim Team. Die Antwort findest du hier, und du bekommst eine Mitteilung.');
  });

  it('sends a reply with an idempotency key, shows the answered thread and reads "Offen" again', async () => {
    mockParams = { ticket: '01tik' };
    const answered = {
      ...THREAD,
      status: 'open',
      messages: [...THREAD.messages, { id: 'm3', author: 'member', body: 'Klappt jetzt, danke!', created_at: '2026-11-05T08:00:00Z' }],
    };
    const { calls } = await render(<SupportThreadScreen />, {
      '/support/tickets/01tik/messages': { status: 201, body: { data: answered } },
      '/support/tickets/01tik': { body: { data: THREAD } },
    });
    await fireEvent.changeText(await screen.findByTestId('SET-15b.reply.input'), '  Klappt jetzt, danke!  ');
    await fireEvent.press(screen.getByTestId('SET-15b.cta.primary'));
    expect(await screen.findByTestId('SET-15b.message.m3')).toHaveTextContent(/Klappt jetzt, danke!/);
    expect(screen.getByTestId('SET-15b.status')).toHaveTextContent('Offen');
    const post = calls.find((request) => request.method === 'POST');
    expect(new URL(post!.url).pathname).toBe('/api/v1/support/tickets/01tik/messages');
    expect(post!.headers.get('Idempotency-Key')).toBe('uuid-1');
    expect(await post!.json()).toEqual({ message: 'Klappt jetzt, danke!' });
    expect(screen.getByTestId('SET-15b.reply.input').props.value).toBe('');
    // The answer is the thread: it is not read again.
    expect(calls.filter((request) => request.method === 'GET' && request.url.endsWith('/support/tickets/01tik'))).toHaveLength(1);
  });

  it('says a closed request opens again when the member writes', async () => {
    mockParams = { ticket: '01tik' };
    await render(<SupportThreadScreen />, { '/support/tickets/01tik': { body: { data: { ...THREAD, status: 'closed' } } } });
    expect(await screen.findByTestId('SET-15b.replyHint')).toHaveTextContent(/öffnen wir sie wieder/);
    expect(screen.getByTestId('SET-15b.reply.input')).toBeTruthy();
  });

  it('checks the text before sending: nothing goes out for an empty reply', async () => {
    mockParams = { ticket: '01tik' };
    const { calls } = await render(<SupportThreadScreen />, { '/support/tickets/01tik': { body: { data: THREAD } } });
    await fireEvent.changeText(await screen.findByTestId('SET-15b.reply.input'), ' ');
    await fireEvent.press(screen.getByTestId('SET-15b.cta.primary'));
    expect(await screen.findByText('Schreib deine Antwort.')).toBeTruthy();
    expect(calls.filter((request) => request.method === 'POST')).toHaveLength(0);
  });

  it('a 429 names the shared limit with the wait, and the retry of the same text keeps its key', async () => {
    mockParams = { ticket: '01tik' };
    const { calls } = await render(<SupportThreadScreen />, {
      '/support/tickets/01tik/messages': () => ({ status: 429, body: { message: 'Too many', code: 'rate_limited' } }),
      '/support/tickets/01tik': { body: { data: THREAD } },
    });
    await fireEvent.changeText(await screen.findByTestId('SET-15b.reply.input'), 'Noch eine Frage');
    await fireEvent.press(screen.getByTestId('SET-15b.cta.primary'));
    expect(await screen.findByTestId('SET-15b.notice')).toHaveTextContent(/schon fünf Nachrichten an den Support/);
    await fireEvent.press(screen.getByTestId('SET-15b.cta.primary'));
    await waitFor(() => expect(calls.filter((request) => request.method === 'POST')).toHaveLength(2));
    const keys = calls.filter((request) => request.method === 'POST').map((request) => request.headers.get('Idempotency-Key'));
    expect(new Set(keys).size).toBe(1);
  });

  it('maps a 422 on the text to the field', async () => {
    mockParams = { ticket: '01tik' };
    await render(<SupportThreadScreen />, {
      '/support/tickets/01tik/messages': { status: 422, body: { message: 'x', code: 'validation_failed', errors: { message: ['Der Text ist zu lang.'] } } },
      '/support/tickets/01tik': { body: { data: THREAD } },
    });
    await fireEvent.changeText(await screen.findByTestId('SET-15b.reply.input'), 'Noch eine Frage');
    await fireEvent.press(screen.getByTestId('SET-15b.cta.primary'));
    expect(await screen.findByText('Der Text ist zu lang.')).toBeTruthy();
  });

  it('another member\'s ticket reads as not found', async () => {
    mockParams = { ticket: '01xyz' };
    await render(<SupportThreadScreen />, {});
    expect(await screen.findByTestId('SET-15b.gone')).toBeTruthy();
  });

  it('takes only a real reference into a follow-up', () => {
    expect(referenceOf('SC-7H2KQXMB')).toBe('SC-7H2KQXMB');
    expect(referenceOf('<script>')).toBeNull();
    expect(referenceOf(['SC-7H2KQXMB'])).toBeNull();
  });
});

describe('support queries (code review M3.3-app SF-7)', () => {
  it('are keyed by the member and never written to the device', async () => {
    mockParams = { ticket: '01tik' };
    const { client } = await render(<SupportThreadScreen />, { '/support/tickets/01tik': { body: { data: THREAD } } });
    await screen.findByTestId('SET-15b.messages');
    const query = client.getQueryCache().find({ queryKey: supportKeys.thread('01mem', '01tik') });
    expect(query?.state.data).toBeTruthy();
    expect(persistOptions.dehydrateOptions?.shouldDehydrateQuery?.(query!)).toBe(false);
    expect(supportKeys.thread('01other', '01tik')).not.toEqual(supportKeys.thread('01mem', '01tik'));
  });
});
