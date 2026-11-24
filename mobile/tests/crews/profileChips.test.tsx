/**
 * PROF-02 crew chips without layout shift (R4DQ-11, R4DQ-33): the identity skeleton holds until the member's crews are in, the chips
 * then sit in the identity block above Folgen/Nachricht, and a failed crews answer shows the profile without chips.
 */
import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import type { MemberProfile } from '@/api/queries/social';
import { MemberProfileScreen } from '@/features/profile/screens/MemberProfileScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen } from '../settings/harness';

const mockParams: Record<string, string | undefined> = {};
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/u/jann.ptrs',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, getState: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('@shopify/flash-list', () => ({
  FlashList: ({ data, renderItem, ListEmptyComponent, ListHeaderComponent, ListFooterComponent }: {
    data: readonly unknown[];
    renderItem: (info: { item: unknown; index: number }) => ReactNode;
    ListEmptyComponent?: ReactNode;
    ListHeaderComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
  }) => (
    <>
      {ListHeaderComponent}
      {data.length === 0 ? ListEmptyComponent : data.map((item, index) => renderItem({ item, index }))}
      {ListFooterComponent}
    </>
  ),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('device-token')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  process.env.EXPO_PUBLIC_WEB_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const JANN: MemberProfile = {
  username: 'jann.ptrs',
  share_url: 'https://speedclub.test/u/jann.ptrs?via=share',
  level: { level: 1, title: 'Street Rookie' },
  founding_number: null,
  display_name: 'Jann Petersen',
  city: 'Hamburg',
  bio: null,
  avatar: null,
  cover: null,
  member_since: '2024-02-18T10:00:00+00:00',
  stats: { vehicles: 0, followers: 4, following: 5 },
  is_sample: false,
  is_editorial: false,
  is_self: false,
  is_following: false,
  follows_you: false,
  can_message: true,
};

const CREW = {
  id: '01JCREW0000000000000000001',
  slug: 'nordlicht-crew',
  name: 'Nordlicht Crew',
  description: null,
  bundesland: 'HH',
  bundesland_label: 'Hamburg',
  join_mode: 'open',
  member_count: 12,
  logo: null,
  cover: null,
  is_sample: false,
  share_path: '/crews/nordlicht-crew',
  viewer: null,
  role: 'founder',
};

const EMPTY_PAGE = { data: [], links: {}, meta: { path: null, per_page: 30, next_cursor: null, prev_cursor: null } };

type Answer = { status?: number; body: unknown };

/** The profile and its garage answer at once; the crews wait for `release`. */
function stub(crews: () => Promise<Answer>) {
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    const path = new URL(request.url).pathname;
    const answer: Answer = path.endsWith('/public/users/jann.ptrs/crews')
      ? await crews()
      : path.endsWith('/public/users/jann.ptrs/vehicles')
        ? { body: EMPTY_PAGE }
        : path.endsWith('/public/users/jann.ptrs')
          ? { body: { data: JANN } }
          : { status: 404, body: { message: 'Nicht gefunden', code: 'not_found' } };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

let client: QueryClient;

beforeAll(hydrateThemePreference);
beforeEach(() => {
  client = newQueryClient();
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { crews: true } }, confirmed: true });
  mockParams.username = 'jann.ptrs';
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});
afterEach(() => client.clear());

describe('PROF-02 crew chips (R4DQ-11, R4DQ-33)', () => {
  it('keeps the skeleton until the crews are in, then shows the chips in the identity block above the actions', async () => {
    let release: (answer: Answer) => void = () => undefined;
    stub(() => new Promise<Answer>((resolve) => (release = resolve)));
    await renderScreen(<MemberProfileScreen />, client);
    // The profile answered, the crews did not: still the skeleton, no name drawn yet.
    await act(async () => undefined);
    expect(screen.getByTestId('PROF-02.skeleton')).toBeTruthy();
    expect(screen.queryByTestId('PROF-02.name')).toBeNull();

    await act(async () => release({ body: { data: [CREW] } }));
    await waitFor(() => expect(screen.getByTestId('PROF-02.name')).toHaveTextContent('Jann Petersen'));
    const identity = screen.getByTestId('PROF-02.identity');
    expect(within(identity).getByTestId('PROF-02.crews.nordlicht-crew')).toHaveTextContent('Nordlicht Crew · Gründer');
    // Under the meta line, above Folgen/Nachricht: the chips come before the actions in reading order.
    const ids: string[] = [];
    const walk = (node: { props?: { testID?: string }; children?: unknown[] } | string) => {
      if (typeof node === 'string') return;
      if (node.props?.testID) ids.push(node.props.testID);
      for (const child of (node.children ?? []) as (typeof node)[]) walk(child);
    };
    walk(identity as unknown as Parameters<typeof walk>[0]);
    expect(ids.indexOf('PROF-02.meta')).toBeLessThan(ids.indexOf('PROF-02.crews'));
    expect(ids.indexOf('PROF-02.crews')).toBeLessThan(ids.indexOf('PROF-02.actions'));
  });

  it('shows the profile without chips when the crews fail', async () => {
    stub(async () => ({ status: 500, body: { message: 'Fehler', code: 'server_error' } }));
    await renderScreen(<MemberProfileScreen />, client);
    await waitFor(() => expect(screen.getByTestId('PROF-02.name')).toHaveTextContent('Jann Petersen'));
    expect(screen.queryByTestId('PROF-02.crews')).toBeNull();
  });
});
