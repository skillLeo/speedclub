/**
 * R4-2.3 Crews screens against a stubbed API (contract-crews §3): CREW-00 list, sort and Bundesland (never by size), flag off and
 * empty; CREW-01 join, request, withdraw, accept, members with their builds, old slug, not found and report; CREW-02 validation, the
 * create call and a 422 on its field; CREW-03 approve, invite (422 on the username) and the typed-name delete; CREW-04 hidden crews;
 * CREW-05 accept; the PROF-02 crew chips.
 */
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { meKey } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { CrewChips } from '@/features/crews/components/CrewChips';
import { CrewEditorScreen } from '@/features/crews/screens/CrewEditorScreen';
import { CrewInvitesScreen } from '@/features/crews/screens/CrewInvitesScreen';
import { CrewListScreen } from '@/features/crews/screens/CrewListScreen';
import { CrewManageScreen } from '@/features/crews/screens/CrewManageScreen';
import { CrewScreen } from '@/features/crews/screens/CrewScreen';
import { MyCrewsScreen } from '@/features/crews/screens/MyCrewsScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import { dismissToast, ToastHost } from '@/ui';

import { newQueryClient, renderScreen as renderWith, stubFetch, type Answer } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), dismiss: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/crews',
  useRoute: () => ({ key: 'crews-1', name: 'crews/index' }),
  useNavigation: () => ({
    getState: () => ({ routeNames: ['index', 'crews/index'], routes: [{ key: 'home-1', name: 'index' }, { key: 'crews-1', name: 'crews/index' }] }),
    getParent: () => undefined,
    canGoBack: () => true,
    goBack: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    dispatch: jest.fn(),
    setOptions: jest.fn(),
  }),
  usePreventRemove: jest.fn(),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: ReactNode }) => children,
}));
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown) => string;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
};
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), scrollToIndex: jest.fn(), getScrollableNode: () => null }));
    const { data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent, ListFooterComponent } = props;
    const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
    return createElement(Fragment, null, ListHeaderComponent, data.length === 0 ? ListEmptyComponent : items, ListFooterComponent);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('device-token')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const SLUG = 'nordlicht-crew';
const LUKAS = { username: 'lukas.sc', display_name: 'Lukas Scholz', city: 'Hamburg', avatar: null, is_sample: false, is_editorial: false };
const NINA = { ...LUKAS, username: 'nina.r34', display_name: 'Nina' };
const MAX = { ...LUKAS, username: 'max.e46', display_name: 'Max' };

const can = (extra: Record<string, boolean> = {}) => ({
  edit: false,
  invite: false,
  approve: false,
  manage_members: false,
  hand_over: false,
  delete: false,
  join: false,
  request: false,
  leave: false,
  ...extra,
});

function card(extra: Record<string, unknown> = {}) {
  return {
    id: '01JCREW0000000000000000001',
    slug: SLUG,
    name: 'Nordlicht Crew',
    description: 'Ausfahrten an der Küste.',
    bundesland: 'HH',
    bundesland_label: 'Hamburg',
    join_mode: 'open',
    member_count: 12,
    logo: null,
    cover: null,
    is_sample: false,
    share_path: `/crews/${SLUG}`,
    viewer: null,
    ...extra,
  };
}

function crew(viewer: Record<string, unknown> | null = null, extra: Record<string, unknown> = {}) {
  return {
    ...card(),
    status: 'active',
    created_at: '2026-03-01T10:00:00Z',
    founder: LUKAS,
    viewer: viewer ? { role: null, state: 'none', invite_id: null, request_id: null, can: can(), ...viewer } : null,
    pending_requests_count: null,
    open_invites_count: null,
    ...extra,
  };
}

const VEHICLE = {
  id: '01JVEH00000000000000000001',
  slug: 'bmw-m3-e46-lukas',
  full_title: 'BMW M3 E46',
  subline_parts: ['2003', '3,2 l R6'],
  cover: null,
  spec_strip: [{ key: 'power', value: '343', unit: 'PS' }],
  is_main: true,
  is_sample: false,
};

const memberRow = (member: typeof LUKAS, role: string, extra: Record<string, unknown> = {}) => ({ member, role, joined_at: '2026-03-01T10:00:00Z', is_self: false, vehicles: [], ...extra });
const page = (data: unknown[]) => ({ data, links: {}, meta: { next_cursor: null, prev_cursor: null, per_page: 30, path: null } });

function me(extra: Record<string, unknown> = {}) {
  return {
    id: 'me',
    username: 'max.e46',
    display_name: 'Max',
    city: null,
    avatar: null,
    is_sample: false,
    is_editorial: false,
    email_verified: true,
    member_since: '2025-03-01T00:00:00Z',
    restrictions: {
      suspended: false,
      messaging: { restricted: false, until: null, decision_id: null },
      publishing: { restricted: false, until: null, decision_id: null },
      forum: { restricted: false, until: null, decision_id: null },
    },
    ...extra,
  };
}

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) =>
  renderWith(
    <>
      {element}
      <ToastHost />
    </>,
    client,
  );

function flags(on: Record<string, boolean> = { crews: true }) {
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: on }, confirmed: true });
}

function signIn() {
  useSessionStore.setState({ status: 'member', member: { id: 'me', username: 'max.e46', displayName: 'Max', avatarUrl: null } });
  client.setQueryData(meKey, me());
}

const callsTo = (calls: Request[], method: string, path: string) => calls.filter((call) => call.method === method && new URL(call.url).pathname.endsWith(path));

beforeAll(async () => {
  await hydrateThemePreference();
});
beforeEach(() => {
  client = newQueryClient();
  jest.clearAllMocks();
  mockParams = {};
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});
afterEach(() => {
  dismissToast();
  client.clear();
  queryClient.clear();
});

describe('CREW-00 Crews', () => {
  it('lists crews with Bundesland, member count and join mode; sorts by name or newest and filters by Bundesland', async () => {
    flags();
    const { calls } = stubFetch({ '/crews': { body: page([card(), card({ id: '01JCREW0000000000000000002', slug: 'sued-crew', name: 'Süd Crew', is_sample: true, join_mode: 'invite' })]) } });
    await renderScreen(<CrewListScreen />);
    expect(await screen.findByTestId(`CREW-00.crew.${SLUG}`)).toBeTruthy();
    expect(screen.getByTestId(`CREW-00.crew.${SLUG}.subline`)).toHaveTextContent('Hamburg · 12 Mitglieder');
    // R4DQ-04: no cover, no photo — the typographic card leads with the initials and the Bundesland's code.
    expect(screen.queryByTestId(`CREW-00.crew.${SLUG}.cover`)).toBeNull();
    expect(screen.getByTestId(`CREW-00.crew.${SLUG}.initials`, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId(`CREW-00.crew.${SLUG}.region`, { includeHiddenElements: true })).toHaveTextContent('HH');
    // R4DQ-17: "Meine Crews" is no header over the list (a guest has no such row at all).
    expect(screen.queryByTestId('CREW-00.mine')).toBeNull();
    expect(screen.getByText('Offen')).toBeTruthy();
    expect(screen.getByTestId('CREW-00.crew.sued-crew.sample')).toBeTruthy();
    expect(calls.some((call) => call.url.includes('sort=name'))).toBe(true);

    await act(async () => fireEvent.press(screen.getByTestId('CREW-00.sort')));
    await act(async () => fireEvent.press(await screen.findByTestId('CREW-00.sortSheet.newest')));
    await waitFor(() => expect(calls.some((call) => call.url.includes('sort=newest'))).toBe(true));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ sort: 'newest' });

    await act(async () => fireEvent.press(screen.getByTestId('CREW-00.region')));
    await act(async () => fireEvent.press(await screen.findByTestId('CREW-00.regionSheet.HH')));
    await waitFor(() => expect(calls.some((call) => call.url.includes('bundesland=HH') && call.url.includes('sort=newest'))).toBe(true));
    // C2: no list is ever ordered by size.
    expect(calls.some((call) => /sort=(members|size|member_count)/.test(call.url))).toBe(false);

    await act(async () => fireEvent.press(screen.getByTestId(`CREW-00.crew.${SLUG}`)));
    expect(mockRouter.push).toHaveBeenCalledWith(`/crews/${SLUG}`);
  });

  it('shows the badged sample and "Crew gründen" when there are none, and nothing while the flag is off', async () => {
    flags();
    stubFetch({ '/crews': { body: page([]) } });
    await renderScreen(<CrewListScreen />);
    expect(await screen.findByTestId('CREW-00.empty')).toBeTruthy();
    // The preview is inert (hidden from readers), so it is found among the hidden elements.
    expect(screen.getByTestId('CREW-00.empty.sample.sample', { includeHiddenElements: true })).toBeTruthy();
    client.clear();
    flags({});
    await renderScreen(<CrewListScreen />);
    expect(await screen.findByTestId('CREW-00.unavailable')).toBeTruthy();
  });
});

describe('CREW-01 Crew', () => {
  it('joins an open crew with an Idempotency-Key and lists the members with their builds', async () => {
    flags();
    signIn();
    mockParams = { slug: SLUG };
    let joined = false;
    const { calls } = stubFetch({
      [`/crews/${SLUG}/members`]: { body: page([memberRow(LUKAS, 'founder', { vehicles: [VEHICLE] }), memberRow(NINA, 'admin')]) },
      [`/crews/${SLUG}/join`]: () => {
        joined = true;
        return { body: { data: crew({ role: 'member', state: 'member', can: can({ leave: true }) }) } };
      },
      [`/crews/${SLUG}`]: () => ({ body: { data: joined ? crew({ role: 'member', state: 'member', can: can({ leave: true }) }) : crew({ can: can({ join: true }) }) } }),
    });
    await renderScreen(<CrewScreen />);
    expect(await screen.findByTestId('CREW-01.name')).toHaveTextContent('Nordlicht Crew');
    expect(screen.getByTestId('CREW-01.facts')).toHaveTextContent('Offen · 12 Mitglieder');
    expect(await screen.findByTestId('CREW-01.member.lukas.sc')).toHaveTextContent('Gründer', { exact: false });
    expect(screen.getByTestId(`CREW-01.member.lukas.sc.car.${VEHICLE.slug}`)).toBeTruthy();
    // R4DQ-04: a crew without a cover opens without a stand-in photo; its members' cars lead only when they have photos (R4DQ-53).
    expect(screen.queryByTestId('CREW-01.cover')).toBeNull();
    expect(screen.queryByTestId('CREW-01.mosaic', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('CREW-01.member.nina.r34')).toHaveTextContent('Admin', { exact: false });

    await act(async () => fireEvent.press(screen.getByTestId('CREW-01.join')));
    await waitFor(() => expect(callsTo(calls, 'POST', `/crews/${SLUG}/join`)).toHaveLength(1));
    expect(callsTo(calls, 'POST', `/crews/${SLUG}/join`)[0]!.headers.get('Idempotency-Key')).toBe('uuid-1');
    expect(await screen.findByTestId('CREW-01.leave')).toBeTruthy();
    expect(await screen.findByText('Du bist jetzt in „Nordlicht Crew“.')).toBeTruthy();
  });

  it('badges a sample crew once: its member rows and cars inherit "Beispiel" (R4DQ-31)', async () => {
    flags();
    mockParams = { slug: SLUG };
    const sampleMember = { ...LUKAS, is_sample: true };
    stubFetch({
      [`/crews/${SLUG}/members`]: { body: page([memberRow(sampleMember, 'founder', { vehicles: [{ ...VEHICLE, is_sample: true }] })]) },
      [`/crews/${SLUG}`]: { body: { data: crew(null, { is_sample: true }) } },
    });
    await renderScreen(<CrewScreen />);
    expect(await screen.findByTestId(`CREW-01.member.lukas.sc.car.${VEHICLE.slug}`)).toBeTruthy();
    expect(screen.getByTestId('CREW-01.sample')).toBeTruthy();
    expect(screen.getAllByText('Beispiel')).toHaveLength(1);
  });

  it('opens a crew without a cover on its members’ cars (R4DQ-53)', async () => {
    flags();
    mockParams = { slug: SLUG };
    const photo = (id: string) => ({
      id,
      status: 'ready',
      category: 'vehicle',
      width: 1600,
      height: 1200,
      blurhash: null,
      thumbhash: null,
      focal_x: null,
      focal_y: null,
      alt: null,
      sort: 0,
      variants: [{ width: 1600, height: 1200, url: `https://speedclub.test/m/${id}.jpg` }],
    });
    stubFetch({
      [`/crews/${SLUG}/members`]: {
        body: page([
          memberRow(LUKAS, 'founder', { vehicles: [{ ...VEHICLE, cover: photo('m1') }] }),
          memberRow(NINA, 'member', { vehicles: [{ ...VEHICLE, id: 'v2', slug: 'v2', cover: photo('m2') }, { ...VEHICLE, id: 'v3', slug: 'v3', cover: null }] }),
        ]),
      },
      [`/crews/${SLUG}`]: { body: { data: crew(null) } },
    });
    await renderScreen(<CrewScreen />);
    expect(await screen.findByTestId('CREW-01.name')).toBeTruthy();
    expect(screen.getByTestId('CREW-01.mosaic', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('CREW-01.mosaic.1', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('CREW-01.mosaic.2', { includeHiddenElements: true })).toBeNull();
  });

  it('sends a request on a request crew, then withdraws it', async () => {
    flags();
    signIn();
    mockParams = { slug: SLUG };
    let requested = false;
    const { calls } = stubFetch({
      [`/crews/${SLUG}/members`]: { body: page([memberRow(LUKAS, 'founder')]) },
      [`/crews/${SLUG}/join-request`]: () => {
        requested = false;
        return { status: 204, body: null };
      },
      [`/crews/${SLUG}/join`]: () => {
        requested = true;
        return { body: { data: crew({ state: 'requested', request_id: '01JREQ', can: can() }, { join_mode: 'request' }) } };
      },
      [`/crews/${SLUG}`]: () => ({
        body: { data: requested ? crew({ state: 'requested', request_id: '01JREQ' }, { join_mode: 'request' }) : crew({ can: can({ request: true }) }, { join_mode: 'request' }) },
      }),
    });
    await renderScreen(<CrewScreen />);
    await act(async () => fireEvent.press(await screen.findByTestId('CREW-01.request')));
    expect(await screen.findByTestId('CREW-01.withdraw')).toBeTruthy();
    expect(screen.getByTestId('CREW-01.requestPending')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('CREW-01.withdraw')));
    await waitFor(() => expect(callsTo(calls, 'DELETE', `/crews/${SLUG}/join-request`)).toHaveLength(1));
    expect(await screen.findByTestId('CREW-01.request')).toBeTruthy();
  });

  it('accepts an open invitation through the invite, and says an invite-only crew needs one', async () => {
    flags();
    signIn();
    mockParams = { slug: SLUG };
    const { calls } = stubFetch({
      [`/crews/${SLUG}/members`]: { body: page([]) },
      '/me/crew-invites/01JINV/accept': { body: { data: crew({ role: 'member', state: 'member', can: can({ leave: true }) }) } },
      [`/crews/${SLUG}`]: { body: { data: crew({ state: 'invited', invite_id: '01JINV', can: can({ join: true }) }, { join_mode: 'invite' }) } },
    });
    await renderScreen(<CrewScreen />);
    await act(async () => fireEvent.press(await screen.findByTestId('CREW-01.accept')));
    await waitFor(() => expect(callsTo(calls, 'POST', '/me/crew-invites/01JINV/accept')).toHaveLength(1));
  });

  it('shows founder and admins Bearbeiten and Verwalten with the open requests, never Verlassen to the founder', async () => {
    flags();
    signIn();
    mockParams = { slug: SLUG };
    stubFetch({
      [`/crews/${SLUG}/members`]: { body: page([]) },
      [`/crews/${SLUG}`]: { body: { data: crew({ role: 'founder', state: 'member', can: can({ edit: true, approve: true, invite: true, manage_members: true, delete: true, hand_over: true }) }, { pending_requests_count: 3 }) } },
    });
    await renderScreen(<CrewScreen />);
    expect(await screen.findByTestId('CREW-01.manage')).toHaveTextContent('Verwalten · 3 Anfragen');
    expect(screen.getByTestId('CREW-01.edit')).toBeTruthy();
    expect(screen.queryByTestId('CREW-01.leave')).toBeNull();
    // The founder cannot report their own crew (422 own_content): no "Mehr" menu.
    expect(screen.queryByTestId('CREW-01.more')).toBeNull();
  });

  it('moves to the new slug of a renamed crew, and says when a crew is gone', async () => {
    flags();
    mockParams = { slug: 'alte-crew' };
    stubFetch({ [`/crews/${SLUG}/members`]: { body: page([]) }, '/crews/alte-crew': { body: { data: crew(null) } } });
    await renderScreen(<CrewScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith(`/crews/${SLUG}`));
    client.clear();
    flags();
    mockParams = { slug: 'weg' };
    stubFetch({ '/crews/weg': { status: 404, body: { message: 'Nicht gefunden', code: 'crew_unavailable' } } });
    await renderScreen(<CrewScreen />);
    expect(await screen.findByTestId('CREW-01.notFound')).toBeTruthy();
  });

  it('offers Melden to a member for the report target crew', async () => {
    flags();
    signIn();
    mockParams = { slug: SLUG };
    stubFetch({ [`/crews/${SLUG}/members`]: { body: page([]) }, [`/crews/${SLUG}`]: { body: { data: crew({ can: can({ join: true }) }) } } });
    await renderScreen(<CrewScreen />);
    await act(async () => fireEvent.press(await screen.findByTestId('CREW-01.more')));
    expect(await screen.findByTestId('CREW-01.moreSheet.report')).toBeTruthy();
  });
});

describe('CREW-02 Crew gründen', () => {
  it('refuses a short name without a call, then founds the crew with an Idempotency-Key and opens it', async () => {
    flags();
    signIn();
    const { calls } = stubFetch({ '/crews': { status: 201, body: { data: crew({ role: 'founder', state: 'member', can: can({ edit: true }) }) } } });
    await renderScreen(<CrewEditorScreen mode="create" />);
    await act(async () => fireEvent.changeText(await screen.findByTestId('CREW-02.name'), 'ab'));
    await act(async () => fireEvent.press(screen.getByTestId('CREW-02.cta.primary')));
    expect(await screen.findByText('Der Name braucht mindestens 3 Zeichen.')).toBeTruthy();
    expect(callsTo(calls, 'POST', '/crews')).toHaveLength(0);

    await act(async () => fireEvent.changeText(screen.getByTestId('CREW-02.name'), '  Nordlicht   Crew '));
    await act(async () => fireEvent.changeText(screen.getByTestId('CREW-02.description'), 'Ausfahrten an der Küste.'));
    await act(async () => fireEvent.press(screen.getByTestId('CREW-02.joinMode.request')));
    await act(async () => fireEvent.press(screen.getByTestId('CREW-02.cta.primary')));
    await waitFor(() => expect(callsTo(calls, 'POST', '/crews')).toHaveLength(1));
    const post = callsTo(calls, 'POST', '/crews')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBe('uuid-1');
    expect(await post.clone().json()).toEqual({ name: 'Nordlicht Crew', description: 'Ausfahrten an der Küste.', bundesland: null, join_mode: 'request' });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith(`/crews/${SLUG}`));
  });

  it('puts a refused name (content_blocked, 422) on its field', async () => {
    flags();
    signIn();
    stubFetch({ '/crews': { status: 422, body: { message: 'Bitte prüf deine Eingaben.', code: 'content_blocked', errors: { name: ['Dieser Name enthält ein gesperrtes Wort.'] } } } });
    await renderScreen(<CrewEditorScreen mode="create" />);
    await act(async () => fireEvent.changeText(await screen.findByTestId('CREW-02.name'), 'Nordlicht Crew'));
    await act(async () => fireEvent.press(screen.getByTestId('CREW-02.cta.primary')));
    expect(await screen.findByText('Dieser Name enthält ein gesperrtes Wort.')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('CREW-03 Crew verwalten', () => {
  const admin = crew({ role: 'founder', state: 'member', can: can({ edit: true, approve: true, invite: true, manage_members: true, delete: true, hand_over: true }) }, { pending_requests_count: 1 });

  it('approves a request with an Idempotency-Key', async () => {
    flags();
    signIn();
    mockParams = { slug: SLUG };
    const { calls } = stubFetch({
      [`/crews/${SLUG}/requests/01JREQ/approve`]: { status: 201, body: { data: memberRow(NINA, 'member') } },
      [`/crews/${SLUG}/requests`]: { body: page([{ id: '01JREQ', crew: card(), member: NINA, created_at: '2026-11-20T10:00:00Z' }]) },
      [`/crews/${SLUG}/members`]: { body: page([]) },
      [`/crews/${SLUG}`]: { body: { data: admin } },
    });
    await renderScreen(<CrewManageScreen tab="requests" />);
    await act(async () => fireEvent.press(await screen.findByTestId('CREW-03.request.01JREQ.approve')));
    await waitFor(() => expect(callsTo(calls, 'POST', `/crews/${SLUG}/requests/01JREQ/approve`)).toHaveLength(1));
    expect(callsTo(calls, 'POST', `/crews/${SLUG}/requests/01JREQ/approve`)[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await screen.findByText('@nina.r34 ist jetzt in der Crew.')).toBeTruthy();
  });

  it('invites by username and puts the server’s refusal on the field', async () => {
    flags();
    signIn();
    mockParams = { slug: SLUG, tab: 'invites' };
    const { calls } = stubFetch({
      [`/crews/${SLUG}/invites`]: () => ({ status: 422, body: { message: 'Bitte prüf deine Eingaben.', code: 'validation_failed', errors: { username: ['Dieses Mitglied ist schon in der Crew.'] } } }),
      [`/crews/${SLUG}/members`]: { body: page([]) },
      [`/crews/${SLUG}`]: { body: { data: admin } },
    });
    await renderScreen(<CrewManageScreen />);
    await act(async () => fireEvent.changeText(await screen.findByTestId('CREW-03.username'), '@lukas.sc'));
    await act(async () => fireEvent.press(screen.getByTestId('CREW-03.inviteSend')));
    await waitFor(() => expect(callsTo(calls, 'POST', `/crews/${SLUG}/invites`)).toHaveLength(1));
    expect(await callsTo(calls, 'POST', `/crews/${SLUG}/invites`)[0]!.clone().json()).toEqual({ username: 'lukas.sc' });
    expect(await screen.findByText('Dieses Mitglied ist schon in der Crew.')).toBeTruthy();
  });

  it('shows an empty Anfragen tab inline with one way to invite (R4DQ-48)', async () => {
    flags();
    signIn();
    mockParams = { slug: SLUG };
    stubFetch({
      [`/crews/${SLUG}/requests`]: { body: page([]) },
      [`/crews/${SLUG}/invites`]: { body: page([]) },
      [`/crews/${SLUG}/members`]: { body: page([]) },
      [`/crews/${SLUG}`]: { body: { data: admin } },
    });
    await renderScreen(<CrewManageScreen tab="requests" />);
    await act(async () => fireEvent.press(await screen.findByTestId('CREW-03.requests.empty.invite')));
    expect(await screen.findByTestId('CREW-03.username')).toBeTruthy();
  });

  it('lists members as dense rows with the overflow menu, without car rails and without a delete (R4DQ-20, R4DQ-30)', async () => {
    flags();
    signIn();
    mockParams = { slug: SLUG, tab: 'members' };
    stubFetch({
      [`/crews/${SLUG}/members`]: { body: page([memberRow(MAX, 'founder', { is_self: true }), memberRow(NINA, 'member', { vehicles: [VEHICLE] })]) },
      [`/crews/${SLUG}`]: () => ({ status: 200, body: { data: admin } }),
    });
    await renderScreen(<CrewManageScreen />);
    expect(await screen.findByTestId('CREW-03.member.nina.r34.actions')).toBeTruthy();
    // No actions on the founder's own row.
    expect(screen.queryByTestId('CREW-03.member.max.e46.actions')).toBeNull();
    expect(screen.queryByTestId('CREW-03.member.nina.r34.cars')).toBeNull();
    expect(screen.queryByTestId('CREW-03.delete')).toBeNull();
    // R4DQ-19: the name stands on a line of its own, never inside the intro sentence.
    expect(screen.getByTestId('CREW-03.crewName')).toHaveTextContent('Nordlicht Crew');
  });
});

describe('CREW-02 Crew bearbeiten, danger zone', () => {
  const founder = crew({ role: 'founder', state: 'member', can: can({ edit: true, approve: true, invite: true, manage_members: true, delete: true, hand_over: true }) });

  it('deletes the crew only once its name is typed, then opens Meine Crews', async () => {
    flags();
    signIn();
    mockParams = { slug: SLUG };
    const { calls } = stubFetch({ [`/crews/${SLUG}`]: () => ({ status: 200, body: { data: founder } }) });
    await renderScreen(<CrewEditorScreen mode="edit" />);
    await act(async () => fireEvent.press(await screen.findByTestId('CREW-02.delete')));
    const confirm = await screen.findByTestId('CREW-02.delete.confirm');
    expect(confirm.props.accessibilityState?.disabled ?? confirm.props['aria-disabled']).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId('CREW-02.delete.name'), 'nordlicht crew'));
    await act(async () => fireEvent.press(screen.getByTestId('CREW-02.delete.confirm')));
    await waitFor(() => expect(callsTo(calls, 'DELETE', `/crews/${SLUG}`)).toHaveLength(1));
    expect(callsTo(calls, 'DELETE', `/crews/${SLUG}`)[0]!.url).toContain('confirm_name=nordlicht');
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/crews/mine'));
  });

  it('shows no danger zone to an admin', async () => {
    flags();
    signIn();
    mockParams = { slug: SLUG };
    stubFetch({ [`/crews/${SLUG}`]: { body: { data: crew({ role: 'admin', state: 'member', can: can({ edit: true }) }) } } });
    await renderScreen(<CrewEditorScreen mode="edit" />);
    expect(await screen.findByTestId('CREW-02.name')).toBeTruthy();
    expect(screen.queryByTestId('CREW-02.delete')).toBeNull();
  });
});

describe('CREW-04 Meine Crews and CREW-05 Einladungen', () => {
  it('lists own crews with the role and explains a hidden one', async () => {
    flags();
    signIn();
    stubFetch({
      '/me/crews': { body: { data: [crew({ role: 'admin', state: 'member', can: can({ leave: true }) }, { status: 'hidden' })] } },
      '/me/crew-requests': { body: page([]) },
      '/me/crew-invites': { body: page([{ id: '01JINV', crew: card({ slug: 'sued-crew', name: 'Süd Crew' }), member: MAX, invited_by: NINA, created_at: '2026-11-20T10:00:00Z' }]) },
    });
    await renderScreen(<MyCrewsScreen />);
    expect(await screen.findByTestId(`CREW-04.crew.${SLUG}.role`)).toHaveTextContent('Admin');
    expect(screen.getByTestId(`CREW-04.crew.${SLUG}.status`)).toHaveTextContent('Ausgeblendet', { exact: false });
    expect(await screen.findByText('1 Einladung')).toBeTruthy();
  });

  it('accepts an invitation and opens the crew', async () => {
    flags();
    signIn();
    const { calls } = stubFetch({
      '/me/crew-invites/01JINV/accept': { body: { data: crew({ role: 'member', state: 'member', can: can({ leave: true }) }) } },
      '/me/crew-invites': { body: page([{ id: '01JINV', crew: card(), member: MAX, invited_by: NINA, created_at: '2026-11-20T10:00:00Z' }]) },
    });
    await renderScreen(<CrewInvitesScreen />);
    expect(await screen.findByTestId('CREW-05.invite.01JINV.meta')).toHaveTextContent('eingeladen von @nina.r34', { exact: false });
    // R4DQ-30: the meta and the buttons sit inside the crew's card, outside its link.
    const row = screen.getByTestId('CREW-05.invite.01JINV');
    expect(within(row).getByTestId('CREW-05.invite.01JINV.accept')).toBeTruthy();
    expect(within(screen.getByTestId('CREW-05.invite.01JINV.crew')).queryByTestId('CREW-05.invite.01JINV.accept')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('CREW-05.invite.01JINV.accept')));
    await waitFor(() => expect(callsTo(calls, 'POST', '/me/crew-invites/01JINV/accept')).toHaveLength(1));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/crews/${SLUG}`));
  });
});

describe('PROF-02 crew chips', () => {
  it('shows the member’s crews, the founder’s with its role', async () => {
    flags();
    stubFetch({ '/public/users/lukas.sc/crews': { body: { data: [{ ...card(), role: 'founder' }, { ...card({ id: '2', slug: 'sued-crew', name: 'Süd Crew' }), role: 'member' }] } } as Answer });
    await renderScreen(<CrewChips username="lukas.sc" routeId="PROF-02" />);
    expect(await screen.findByTestId(`PROF-02.crews.${SLUG}`)).toHaveTextContent('Nordlicht Crew · Gründer');
    await act(async () => fireEvent.press(screen.getByTestId('PROF-02.crews.sued-crew')));
    expect(mockRouter.push).toHaveBeenCalledWith('/crews/sued-crew');
  });
});
