/**
 * M2.6 on the real adapter (api/queries/safety.ts, the context's default) against a fetch stub: "Melden" in PROF-02 sends
 * `POST reports` with the username and an idempotency key, VEH-01 offers it only for someone else's build, SAFE-01 maps
 * `DecisionResource` and its appeal errors, SET-16 reads both pages, a restricted notice links to its decision; plus HOME-02's
 * moderation rows and the targets a thread reports.
 */
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { AppNotification } from '@/api/queries/notifications';
import { reportBody, toDecision } from '@/api/queries/safety';
import type { components } from '@/api/schema';
import { RestrictedNotice } from '@/features/garage/components/frames';
import { notificationIcon, notificationTarget, notificationText } from '@/features/home/notifications';
import { MemberProfileScreen } from '@/features/profile/screens/MemberProfileScreen';
import { DecisionScreen } from '@/features/safety/screens/DecisionScreen';
import { ReportsScreen } from '@/features/safety/screens/ReportsScreen';
import { conversationTarget, messageTarget } from '@/features/safety/targets';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { ViewerScreen } from '@/features/vehicle/screens/ViewerScreen';
import i18n from '@/i18n';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen } from '../settings/harness';
import { R34, R34_WHEELS } from '../vehicle/fixtures';

const mockParams: Record<string, string | undefined> = {};
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), dismissTo: jest.fn(), canGoBack: jest.fn(() => true) };
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
  usePreventRemove: () => undefined,
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
jest.mock('expo-crypto', () => ({ randomUUID: () => 'report-key-1' }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  process.env.EXPO_PUBLIC_WEB_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
const mockClock = { now: new Date('2026-11-08T11:00:00+01:00') };
jest.mock('@/lib/clock', () => ({ now: () => mockClock.now }));

type DecisionData = components['schemas']['DecisionResource'];

const JANN = {
  username: 'jann.ptrs',
  display_name: 'Jann Petersen',
  city: 'Hamburg',
  bio: null,
  avatar: null,
  cover: null,
  member_since: '2024-02-18T10:00:00+00:00',
  stats: { vehicles: 0, followers: 4, following: 5 },
  is_self: false,
  is_following: false,
  follows_you: false,
  can_message: true,
};
const PAGE = <T,>(data: T[], next: string | null = null) => ({
  data,
  links: { first: null, last: null, prev: null, next: null },
  meta: { path: null, per_page: 30, next_cursor: next, prev_cursor: null },
});

// The seeded case (handover §7): nico.sti reported the second photo of tobi.quattro's RS6; removed, Community-Richtlinien §4.
const DECISION: DecisionData = {
  id: '01jdec0000000000000000rs6c',
  viewer: 'affected',
  action: 'remove_content',
  outcome: 'remove_content',
  origin: 'report',
  reverses_decision_id: null,
  restriction: null,
  scope: { applies_to: 'content', until: null },
  target: { type: 'photo', label: 'Audi RS6 Avant C8' },
  decided_at: '2026-11-01T10:00:00+01:00',
  notified_at: '2026-11-01T10:00:00+01:00',
  appeal_until: '2027-05-01T23:59:59+02:00',
  automated_detection: false,
  automated_decision: false,
  redress: ['internal_complaint', 'out_of_court', 'court'],
  dispute_settlement_url: 'https://ec.europa.eu/digital-services-act/out-of-court-dispute-settlement',
  ground_document: 'community',
  ground_section: '4',
  statement: { facts: 'Das Foto stammt nicht von dir, sondern aus einem Herstellerprospekt.', ground: 'Community-Richtlinien §4 (Deine Inhalte)' },
  appeal: null,
  can_appeal: true,
};

type Answer = { status?: number; body: unknown };
type Route = Answer | ((request: Request) => Answer);

/** Answers by "METHOD /path-suffix"; anything else is a 404. */
function stub(routes: Record<string, Route>) {
  const calls: Request[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    calls.push(request);
    const path = new URL(request.url).pathname;
    const key = Object.keys(routes).find((candidate) => {
      const [method, suffix] = candidate.split(' ');
      return method === request.method && path.endsWith(suffix ?? '');
    });
    const entry = key ? routes[key] : undefined;
    const answer = typeof entry === 'function' ? entry(request) : (entry ?? { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return calls;
}

const sent = (calls: Request[], method: string, suffix: string) =>
  calls.filter((call) => call.method === method && new URL(call.url).pathname.endsWith(suffix));

function signIn(username = 'lukas.sc') {
  useSessionStore.setState({ status: 'member', member: { id: 'me-1', username, displayName: null, avatarUrl: null } });
}

let client: QueryClient;
const render = (element: Parameters<typeof renderScreen>[0]) => renderScreen(element, client);

beforeAll(hydrateThemePreference);
beforeEach(() => {
  client = newQueryClient();
});
afterEach(() => {
  useSessionStore.setState({ status: 'loading', member: null, promptOpen: false, intent: null });
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  jest.clearAllMocks();
});

describe('the adapter', () => {
  it('sends the body of the handover: username for a member, good faith for illegal, a boolean message context', () => {
    expect(reportBody({ targetType: 'member', targetId: 'jann.ptrs', reason: 'harassment' })).toEqual({
      target_type: 'member',
      target_id: 'jann.ptrs',
      reason: 'harassment',
    });
    expect(
      reportBody({ targetType: 'message', targetId: '01JMSG', reason: 'illegal', subReason: 'hate_speech', goodFaith: true, details: 'Hetze.', messageContext: true }),
    ).toEqual({ target_type: 'message', target_id: '01JMSG', reason: 'illegal', sub_reason: 'hate_speech', details: 'Hetze.', good_faith: true, message_context: true });
  });

  it('maps DecisionResource; `law` has no document to link', () => {
    const mapped = toDecision({ ...DECISION, ground_document: 'law' });
    expect(mapped).toMatchObject({
      viewer: 'affected',
      action: 'remove_content',
      outcome: 'remove_content',
      scope: { appliesTo: 'content', until: null },
      automatedDetection: false,
      automatedDecision: false,
      disputeSettlementUrl: 'https://ec.europa.eu/digital-services-act/out-of-court-dispute-settlement',
      appealUntil: '2027-05-01T23:59:59+02:00',
      canAppeal: true,
      groundDocument: null,
      groundSection: '4',
    });
    expect(toDecision({ ...DECISION, viewer: 'reporter', action: null, outcome: 'measures', scope: null, statement: null })).toMatchObject({
      action: null,
      outcome: 'measures',
      scope: null,
    });
    expect(mapped.statement).toEqual({ facts: DECISION.statement?.facts, ground: DECISION.statement?.ground });
  });
});

describe('PROF-02 Melden', () => {
  it('reports the member by username with one idempotency key, and offers the block after', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    const calls = stub({
      'GET /public/users/jann.ptrs': { body: { data: JANN } },
      'GET /public/users/jann.ptrs/vehicles': { body: PAGE([]) },
      'POST /reports': { status: 201, body: { data: { id: '01jrep', status: 'received' } } },
    });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-02.more')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('PROF-02.more'));
    await fireEvent.press(screen.getByTestId('PROF-02.moreSheet.report'));
    await fireEvent.press(await screen.findByTestId('PROF-02.report.reason.harassment'));
    await act(async () => fireEvent.press(screen.getByTestId('PROF-02.report.send')));
    await waitFor(() => expect(screen.getByTestId('PROF-02.report.sent')).toBeTruthy());
    const [post] = sent(calls, 'POST', '/reports');
    expect(post?.headers.get('Idempotency-Key')).toBe('report-key-1');
    expect(await post?.clone().json()).toEqual({ target_type: 'member', target_id: 'jann.ptrs', reason: 'harassment' });
    expect(screen.getByTestId('PROF-02.report.blockOffer')).toBeTruthy();
  });

  it('ends a 409 already_reported in the calm duplicate step', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    stub({
      'GET /public/users/jann.ptrs': { body: { data: JANN } },
      'GET /public/users/jann.ptrs/vehicles': { body: PAGE([]) },
      'POST /reports': { status: 409, body: { message: 'Du hast das schon gemeldet.', code: 'already_reported', errors: {} } },
    });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-02.more')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('PROF-02.more'));
    await fireEvent.press(screen.getByTestId('PROF-02.moreSheet.report'));
    await fireEvent.press(await screen.findByTestId('PROF-02.report.reason.spam'));
    await act(async () => fireEvent.press(screen.getByTestId('PROF-02.report.send')));
    await waitFor(() => expect(screen.getByTestId('PROF-02.report.duplicate')).toBeTruthy());
  });
});

describe('VEH-01 Melden', () => {
  it('offers "Melden" for someone else’s build', async () => {
    signIn('nico.sti');
    stub({});
    await render(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('VEH-01.moreActions'));
    expect(screen.getByTestId('VEH-01.moreSheet.report')).toBeTruthy();
  });

  it('leaves it out for your own build', async () => {
    signIn('lukas.sc');
    stub({});
    await render(<VehicleProfile vehicle={{ ...R34, is_owner: true }} onBack={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('VEH-01.moreActions'));
    expect(screen.getByTestId('VEH-01.moreSheet.copyLink')).toBeTruthy();
    expect(screen.queryByTestId('VEH-01.moreSheet.report')).toBeNull();
  });
});

describe('VEH-04 Melden', () => {
  const wheels = { ...R34_WHEELS, photos: R34.photos.slice(0, 2) };

  it('stays hidden on a mod photo until the build says whose it is', async () => {
    signIn('nico.sti');
    mockParams.slug = R34.slug;
    mockParams.mod = wheels.id;
    let answerBuild: (answer: Answer) => void = () => undefined;
    const pendingBuild = new Promise<Answer>((resolve) => {
      answerBuild = resolve;
    });
    globalThis.fetch = jest.fn(async (input: Request | string) => {
      const request = typeof input === 'string' ? new Request(input) : input;
      const path = new URL(request.url).pathname;
      const answer = path.endsWith(`/mods/${wheels.id}`) ? { body: { data: wheels } } : path.endsWith(`/public/vehicles/${R34.slug}`) ? await pendingBuild : { status: 404, body: {} };
      return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    await render(<ViewerScreen />);
    await waitFor(() => expect(screen.getByTestId('VEH-04.viewer.counter')).toBeTruthy());
    expect(screen.queryByTestId('VEH-04.report')).toBeNull();
    await act(async () => answerBuild({ body: { data: R34 } }));
    await waitFor(() => expect(screen.getByTestId('VEH-04.report')).toBeTruthy());
  });

  it('never shows on your own build', async () => {
    signIn('lukas.sc');
    mockParams.slug = R34.slug;
    stub({ [`GET /public/vehicles/${R34.slug}`]: { body: { data: { ...R34, is_owner: true } } } });
    await render(<ViewerScreen />);
    await waitFor(() => expect(screen.getByTestId('VEH-04.viewer.counter')).toBeTruthy());
    expect(screen.queryByTestId('VEH-04.report')).toBeNull();
  });
});

describe('SAFE-01 on the API', () => {
  it('shows the server deadline and maps 409 appeal_exists onto the notice, asking again', async () => {
    signIn('tobi.quattro');
    mockParams.id = DECISION.id;
    const calls = stub({
      [`GET /decisions/${DECISION.id}`]: { body: { data: DECISION } },
      [`POST /decisions/${DECISION.id}/appeal`]: { status: 409, body: { message: 'Es gibt schon einen Einspruch.', code: 'appeal_exists', errors: {} } },
    });
    await render(<DecisionScreen />);
    expect(await screen.findByText('Wir haben deinen Inhalt entfernt')).toBeTruthy();
    expect(screen.getByTestId('SAFE-01.outcome')).toHaveTextContent(/^Wir haben „Foto von Audi RS6 Avant C8“ entfernt./);
    expect(screen.getByTestId('SAFE-01.appeal.open')).toHaveTextContent(/bis zum 01.05.2027 Einspruch/);
    await fireEvent.press(screen.getByTestId('SAFE-01.appealButton'));
    await fireEvent.changeText(await screen.findByTestId('SAFE-01.appealSheet.text'), 'Das Foto habe ich selbst gemacht.');
    await act(async () => fireEvent.press(screen.getByTestId('SAFE-01.appealSheet.send')));
    await waitFor(() => expect(screen.getByTestId('SAFE-01.appealSheet.notice')).toHaveTextContent('Zu dieser Entscheidung gibt es schon einen Einspruch.'));
    expect(await sent(calls, 'POST', `/decisions/${DECISION.id}/appeal`)[0]?.clone().json()).toEqual({ text: 'Das Foto habe ich selbst gemacht.' });
    await waitFor(() => expect(sent(calls, 'GET', `/decisions/${DECISION.id}`).length).toBeGreaterThan(1));
  });

  it('shows the designed state for a 404', async () => {
    signIn();
    mockParams.id = '01jnope';
    stub({});
    await render(<DecisionScreen />);
    expect(await screen.findByTestId('SAFE-01.notFound')).toBeTruthy();
  });
});

describe('SET-16 on the API', () => {
  it('reads both lists and their next pages', async () => {
    signIn();
    const calls = stub({
      'GET /me/reports': (request) =>
        new URL(request.url).searchParams.get('cursor')
          ? { body: PAGE([{ id: 'r0', target: { type: 'member', label: '@drift.koenig' }, reason: 'harassment', sub_reason: null, status: 'received', decision: null, created_at: '2026-10-01T10:00:00Z' }]) }
          : {
              body: PAGE(
                [{ id: 'r1', target: { type: 'vehicle', label: 'Toyota GR Yaris' }, reason: 'other', sub_reason: null, status: 'received', decision: null, created_at: '2026-11-06T10:00:00Z' }],
                'next-1',
              ),
            },
      'GET /me/decisions': { body: PAGE([]) },
    });
    await render(<ReportsScreen />);
    expect(await screen.findByText('Toyota GR Yaris')).toBeTruthy();
    expect(screen.getByTestId('SET-16.report.r1.status')).toHaveTextContent('Eingegangen');
    expect(screen.getByTestId('SET-16.empty.about')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('SET-16.more.mine')));
    expect(await screen.findByText('@drift.koenig')).toBeTruthy();
    expect(sent(calls, 'GET', '/me/reports')[0]?.url).toContain('per_page=30');
  });
});

describe('restricted states', () => {
  it('link the garage notice to the decision behind the restriction', async () => {
    signIn();
    client.setQueryData(['auth', 'me'], {
      restrictions: {
        suspended: false,
        messaging: { restricted: false, until: null, decision_id: null },
        publishing: { restricted: true, until: '2026-11-20T10:00:00+01:00', decision_id: '01jdecpub' },
      },
    });
    stub({});
    await render(<RestrictedNotice message="Veröffentlichen ist eingeschränkt." testID="GAR-02.restricted" />);
    await fireEvent.press(screen.getByTestId('GAR-02.restricted.decision'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/decision/[id]', params: { id: '01jdecpub' } });
  });
});

describe('HOME-02 moderation rows', () => {
  const t = i18n.getFixedT('de', 'home');
  const row = (type: AppNotification['type'], details: Record<string, unknown>): AppNotification =>
    ({ id: 'n1', type, details, actors: [], actor_count: 0, vehicle: null, created_at: '2026-11-08T09:00:00Z', read_at: null }) as unknown as AppNotification;

  it('names the decision and opens SAFE-01', () => {
    const decided = row('moderation_decision', { decision_id: '01jdec', action: 'remove_content' });
    expect(notificationText(decided, t)).toBe('Wir haben einen deiner Inhalte entfernt. Tippe für die Begründung und deine Möglichkeiten.');
    expect(notificationTarget(decided, 'tobi.quattro')).toEqual({ pathname: '/decision/[id]', params: { id: '01jdec' } });
    expect(notificationIcon(decided)).toBe('scales');
    const report = row('report_decided', { decision_id: '01jdec', outcome: 'measures' });
    expect(notificationText(report, t)).toBe('Wir haben deine Meldung geprüft und Maßnahmen ergriffen. Tippe für Einzelheiten.');
    expect(notificationText(row('report_decided', { decision_id: '01jdec', outcome: 'no_action' }), t)).toBe(
      'Wir haben deine Meldung geprüft und keinen Verstoß festgestellt. Tippe für Einzelheiten.',
    );
    expect(notificationText(row('report_decided', { decision_id: '01jdec' }), t)).toBe('Wir haben deine Meldung geprüft. Tippe für das Ergebnis.');
    expect(notificationTarget(row('report_decided', {}), 'nico.sti')).toBe('/settings/reports');
  });
});

describe('thread targets', () => {
  const message = (id: string, mine: boolean, createdAt: string) => ({ id, mine, senderUsername: mine ? null : 'max.e46', createdAt });

  it('reports a message of the other member, never your own', () => {
    expect(messageTarget(message('01J2', false, '2026-11-08T09:00:00Z'), 'max.e46')).toEqual({
      type: 'message',
      id: '01J2',
      label: 'Nachricht von @max.e46',
      owner: 'max.e46',
    });
    expect(messageTarget(message('01J3', true, '2026-11-08T09:01:00Z'), 'max.e46')).toBeNull();
  });

  it('reports a conversation as its newest message from the other member, or the member', () => {
    const thread = [message('01J1', false, '2026-11-08T08:00:00Z'), message('01J2', false, '2026-11-08T09:00:00Z'), message('01J3', true, '2026-11-08T10:00:00Z')];
    expect(conversationTarget(thread, 'max.e46')?.id).toBe('01J2');
    expect(conversationTarget([], 'max.e46')).toEqual({ type: 'member', id: 'max.e46', label: '@max.e46', owner: 'max.e46' });
  });
});
