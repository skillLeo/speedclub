// M2.6 against a fake SafetyAdapter: the report sheet's steps and states, the block after a report and "Blockieren & melden", the
// guest path, SAFE-01 for the affected member and the reporter with the appeal, and SET-16's two sections.
import { act, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ApiError } from '@/api/client';
import { SafetyContext, unavailableSafety, type Loadable, type PagedList, type SafetyActions, type SafetyAdapter } from '@/features/safety/data';
import type { DecisionDetail, DecisionSummary, ReportSummary, ReportTarget } from '@/features/safety/model';
import { DecisionScreen } from '@/features/safety/screens/DecisionScreen';
import { ReportsScreen } from '@/features/safety/screens/ReportsScreen';
import { useReport } from '@/features/safety/useReport';
import { setGuest, setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference, radius, size, themes } from '@/theme';
import { Button } from '@/ui';

import { renderWithProviders, stubFetch } from '../home/harness';

type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactElement;
  keyExtractor?: (item: unknown) => string;
  ListEmptyComponent?: ReactElement | null;
  ListHeaderComponent?: ReactElement | null;
  ListFooterComponent?: ReactElement | null;
};

const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: () => true, dismissTo: jest.fn() };
const mockParams: { id?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/v/bmw-m3-e46',
  useNavigation: () => ({ addListener: () => () => undefined, getParent: () => undefined, getState: () => undefined, canGoBack: () => false }),
  usePreventRemove: () => undefined,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), getScrollableNode: () => null }));
    const { data, renderItem, keyExtractor, ListEmptyComponent, ListHeaderComponent, ListFooterComponent } = props;
    const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
    return createElement(Fragment, null, ListHeaderComponent ?? null, data.length === 0 ? ListEmptyComponent : items, ListFooterComponent ?? null);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `key-${String((n += 1)).padStart(3, '0')}` };
});
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
jest.mock('@/api/queries/auth', () => ({ ...jest.requireActual<object>('@/api/queries/auth'), useMe: () => ({ data: undefined }) }));
jest.mock('@/ui/toast', () => ({ ...jest.requireActual<object>('@/ui/toast'), toast: jest.fn() }));
const mockClock = { now: new Date('2026-11-08T11:00:00+01:00') };
jest.mock('@/lib/clock', () => ({ now: () => mockClock.now }));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  setMember({ id: 'member-lukas', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null });
  stubFetch({ '/users/paul.roadster/block': { body: { data: { blocked: true } } } });
});
afterEach(() => {
  useSessionStore.setState({ status: 'loading', member: null, promptOpen: false, intent: null });
  delete mockParams.id;
  jest.clearAllMocks();
});

const flush = () => act(async () => new Promise<void>((resolve) => setImmediate(resolve)));

function loaded<T>(data: T): Loadable<T> {
  return { data, isPending: false, isPaused: false, error: null, isFetching: false, refetch: jest.fn() };
}

function pending<T>(): Loadable<T> {
  return { data: undefined, isPending: true, isPaused: false, error: null, isFetching: true, refetch: jest.fn() };
}

const styleOf = (testID: string): ViewStyle => StyleSheet.flatten(screen.getByTestId(testID).props.style as ViewStyle) ?? {};

function paged<T>(data: readonly T[]): PagedList<T> {
  return { ...loaded<readonly T[]>(data), hasMore: false, isLoadingMore: false, loadMore: jest.fn() };
}

function fakeActions(overrides: Partial<SafetyActions> = {}): SafetyActions {
  return {
    report: jest.fn(() => Promise.resolve({ id: '01JREP', status: 'received' as const })),
    appeal: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function adapterWith(options: {
  actions?: SafetyActions;
  decision?: DecisionDetail;
  reports?: ReportSummary[];
  decisions?: DecisionSummary[];
}): SafetyAdapter {
  const actions = options.actions ?? fakeActions();
  return {
    available: true,
    useMyReports: () => paged<ReportSummary>(options.reports ?? []),
    useMyDecisions: () => paged<DecisionSummary>(options.decisions ?? []),
    useDecision: () => loaded(options.decision ?? decision()),
    useActions: () => actions,
  };
}

function renderWith(adapter: SafetyAdapter, element: ReactElement) {
  return renderWithProviders(<SafetyContext value={adapter}>{element}</SafetyContext>);
}

const vehicle: ReportTarget = { type: 'vehicle', id: '01JVEH', label: 'BMW M3 (E46)', owner: 'paul.roadster' };
const message: ReportTarget = { type: 'message', id: '01JMSG', label: 'Nachricht von @paul.roadster', owner: 'paul.roadster' };

function Host({ target, onBlocked }: { target: ReportTarget; onBlocked?: (username: string) => void }) {
  const flow = useReport(target, { routeId: 'VEH-01', onBlocked });
  return (
    <View>
      {flow.available ? <Button label="Melden" onPress={flow.open} testID="host.report" /> : null}
      <Button label="Blockieren & melden" onPress={flow.openBlockAndReport} testID="host.blockAndReport" />
      {flow.element}
    </View>
  );
}

function decision(overrides: Partial<DecisionDetail> = {}): DecisionDetail {
  return {
    id: '01JDEC',
    viewer: 'affected',
    action: 'remove_content',
    outcome: 'remove_content',
    origin: 'report',
    reversesDecisionId: null,
    restriction: null,
    scope: { appliesTo: 'content', until: null },
    target: { type: 'photo', label: 'VW Golf II GTI' },
    decidedAt: '2026-11-02T09:00:00Z',
    notifiedAt: '2026-11-02T09:05:00Z',
    appealUntil: '2027-05-02T23:59:59+02:00',
    automatedDetection: false,
    automatedDecision: false,
    redress: ['internal_complaint', 'out_of_court', 'court'],
    disputeSettlementUrl: 'https://ec.europa.eu/digital-services-act/out-of-court-dispute-settlement',
    groundDocument: 'community',
    groundSection: '5',
    statement: {
      facts: 'Das Foto zeigt das Kennzeichen und das Gesicht einer anderen Person ohne deren Einwilligung.',
      ground: 'Community-Richtlinien §5 (Privatsphäre)',
    },
    appeal: null,
    canAppeal: true,
    ...overrides,
  };
}

describe('report sheet', () => {
  it('stays out of the menu while the API is missing', async () => {
    await renderWith(unavailableSafety, <Host target={vehicle} />);
    expect(screen.queryByTestId('host.report')).toBeNull();
  });

  it('asks the sub-reason for illegal content and sends it with the details', async () => {
    const actions = fakeActions();
    await renderWith(adapterWith({ actions }), <Host target={vehicle} />);
    await fireEvent.press(screen.getByTestId('host.report'));
    expect(await screen.findByText('Was ist das Problem?')).toBeTruthy();
    expect(screen.getByTestId('VEH-01.report.target')).toHaveTextContent('Du meldest: BMW M3 (E46)');
    // A list holds list items only (axe aria-required-children, M2.8): each row sits in one.
    const listsHoldItems = () => {
      for (const list of screen.container.queryAll((node) => node.props.role === 'list')) {
        expect(list.children.length).toBeGreaterThan(0);
        for (const child of list.children) expect(typeof child !== 'string' && child.props.role).toBe('listitem');
      }
    };
    listsHoldItems();
    await fireEvent.press(screen.getByTestId('VEH-01.report.reason.illegal'));
    expect(screen.getByText('Welche Art von Rechtsverstoß?')).toBeTruthy();
    listsHoldItems();
    await fireEvent.press(screen.getByTestId('VEH-01.report.subReason.street_racing'));
    expect(screen.getByTestId('VEH-01.report.chosen')).toHaveTextContent('Verstößt gegen geltendes Recht · Illegale Straßenrennen (§\u00a0315d StGB)');
    expect(screen.getByTestId('VEH-01.report.goodFaith')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('VEH-01.report.details'), '  Ruft zum Rennen auf der B27 am Samstag auf. ');
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    expect(actions.report).toHaveBeenCalledWith(
      { targetType: 'vehicle', targetId: '01JVEH', reason: 'illegal', subReason: 'street_racing', goodFaith: true, details: 'Ruft zum Rennen auf der B27 am Samstag auf.' },
      'key-001',
    );
    expect(screen.getByTestId('VEH-01.report.sent')).toBeTruthy();
    expect(screen.getByText('Danke. Wir prüfen deine Meldung.')).toBeTruthy();
  });

  it('skips the sub-reason for other reasons and notes the message context for a message', async () => {
    await renderWith(adapterWith({}), <Host target={message} />);
    await fireEvent.press(screen.getByTestId('host.report'));
    await fireEvent.press(await screen.findByTestId('VEH-01.report.reason.harassment'));
    expect(screen.queryByText('Welche Art von Rechtsverstoß?')).toBeNull();
    expect(screen.getByTestId('VEH-01.report.messageNote')).toHaveTextContent(/bis zu 5 Nachrichten davor und danach/);
    expect(screen.queryByTestId('VEH-01.report.goodFaith')).toBeNull();
  });

  it('refuses details over 1000 characters', async () => {
    const actions = fakeActions();
    await renderWith(adapterWith({ actions }), <Host target={vehicle} />);
    await fireEvent.press(screen.getByTestId('host.report'));
    await fireEvent.press(await screen.findByTestId('VEH-01.report.reason.spam'));
    await fireEvent.changeText(screen.getByTestId('VEH-01.report.details'), 'x'.repeat(1001));
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    expect(screen.getByText('Höchstens 1.000 Zeichen.')).toBeTruthy();
    expect(actions.report).not.toHaveBeenCalled();
  });

  it('requires the explanation for illegal content, at least 10 characters (Art. 16(2)(a) DSA)', async () => {
    const actions = fakeActions();
    await renderWith(adapterWith({ actions }), <Host target={vehicle} />);
    await fireEvent.press(screen.getByTestId('host.report'));
    await fireEvent.press(await screen.findByTestId('VEH-01.report.reason.illegal'));
    await fireEvent.press(screen.getByTestId('VEH-01.report.subReason.copyright'));
    expect(screen.getByText('Begründung')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('VEH-01.report.details'), 'Geklaut');
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    expect(screen.getByText('Erklär in mindestens 10 Zeichen, warum der Inhalt aus deiner Sicht rechtswidrig ist.')).toBeTruthy();
    expect(actions.report).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('VEH-01.report.details'), 'Das Foto stammt von meinem Instagram-Profil.');
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    expect(actions.report).toHaveBeenCalledTimes(1);
  });

  it('renews the idempotency key when the text changes, and keeps it for a plain retry', async () => {
    const report = jest.fn().mockRejectedValue(new ApiError({ kind: 'server', status: 500, code: 'server', message: '' }));
    await renderWith(adapterWith({ actions: fakeActions({ report }) }), <Host target={vehicle} />);
    await fireEvent.press(screen.getByTestId('host.report'));
    await fireEvent.press(await screen.findByTestId('VEH-01.report.reason.spam'));
    await fireEvent.changeText(screen.getByTestId('VEH-01.report.details'), 'Verkauft Fake-Felgen.');
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    await fireEvent.changeText(screen.getByTestId('VEH-01.report.details'), 'Verkauft Fake-Felgen, siehe Anzeige.');
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    const keys = report.mock.calls.map((call) => call[1]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('shows the state for idempotency_key_reused instead of an error', async () => {
    const report = jest.fn().mockRejectedValue(new ApiError({ kind: 'conflict', status: 409, code: 'idempotency_key_reused', message: '' }));
    await renderWith(adapterWith({ actions: fakeActions({ report }) }), <Host target={vehicle} />);
    await fireEvent.press(screen.getByTestId('host.report'));
    await fireEvent.press(await screen.findByTestId('VEH-01.report.reason.spam'));
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    expect(screen.getByTestId('VEH-01.report.duplicate')).toBeTruthy();
  });

  it('offers the block after sending, and leaves the page only once blocked', async () => {
    const onBlocked = jest.fn();
    await renderWith(adapterWith({}), <Host target={vehicle} onBlocked={onBlocked} />);
    await fireEvent.press(screen.getByTestId('host.report'));
    await fireEvent.press(await screen.findByTestId('VEH-01.report.reason.spam'));
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    expect(screen.getByText('Auch blockieren?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('VEH-01.report.blockOffer.block'));
    await flush();
    expect(screen.getByText('@paul.roadster blockieren?')).toBeTruthy();
    expect(onBlocked).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('VEH-01.reportBlock.confirm'));
    await flush();
    expect(onBlocked).toHaveBeenCalledWith('paul.roadster');
  });

  it('ends a duplicate calmly, and keeps the same key for a retry after a server error', async () => {
    const report = jest
      .fn()
      .mockRejectedValueOnce(new ApiError({ kind: 'server', status: 500, code: 'server', message: '' }))
      .mockRejectedValueOnce(new ApiError({ kind: 'conflict', status: 409, code: 'already_reported', message: '' }));
    await renderWith(adapterWith({ actions: fakeActions({ report }) }), <Host target={vehicle} />);
    await fireEvent.press(screen.getByTestId('host.report'));
    await fireEvent.press(await screen.findByTestId('VEH-01.report.reason.nudity'));
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    expect(screen.getByTestId('VEH-01.report.notice')).toHaveTextContent('Deine Meldung konnte nicht gesendet werden. Versuch es noch einmal.');
    expect(screen.getByText('Erneut senden')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    expect(report.mock.calls[0]?.[1]).toBe(report.mock.calls[1]?.[1]);
    expect(screen.getByTestId('VEH-01.report.duplicate')).toBeTruthy();
    expect(screen.getByText('Du hast das schon gemeldet')).toBeTruthy();
  });

  it('says what a 429 means and does not offer the same send again', async () => {
    const report = jest.fn().mockRejectedValue(new ApiError({ kind: 'rate_limited', status: 429, code: 'rate_limited', message: '' }));
    await renderWith(adapterWith({ actions: fakeActions({ report }) }), <Host target={vehicle} />);
    await fireEvent.press(screen.getByTestId('host.report'));
    await fireEvent.press(await screen.findByTestId('VEH-01.report.reason.spam'));
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    expect(screen.getByTestId('VEH-01.report.notice')).toHaveTextContent(/spätestens in 24 Stunden wieder senden/);
    expect(screen.getByTestId('VEH-01.report.send')).toBeDisabled();
  });

  it('"Blockieren & melden" on a message blocks first, then reports without a second block offer', async () => {
    const onBlocked = jest.fn();
    await renderWith(adapterWith({}), <Host target={message} onBlocked={onBlocked} />);
    await fireEvent.press(screen.getByTestId('host.blockAndReport'));
    expect(await screen.findByText('@paul.roadster blockieren und melden?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('VEH-01.reportBlock.confirm'));
    await flush();
    await fireEvent.press(await screen.findByTestId('VEH-01.report.reason.harassment'));
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    expect(screen.queryByTestId('VEH-01.report.blockOffer')).toBeNull();
    expect(onBlocked).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('VEH-01.report.done'));
    await flush();
    expect(onBlocked).toHaveBeenCalledWith('paul.roadster');
  });

  it('"Blockieren & melden" on anything else reports first, while it is still visible, then blocks', async () => {
    const onBlocked = jest.fn();
    const actions = fakeActions();
    await renderWith(adapterWith({ actions }), <Host target={vehicle} onBlocked={onBlocked} />);
    await fireEvent.press(screen.getByTestId('host.blockAndReport'));
    await fireEvent.press(await screen.findByTestId('VEH-01.report.reason.harassment'));
    expect(screen.queryByText('@paul.roadster blockieren und melden?')).toBeNull();
    await fireEvent.press(screen.getByTestId('VEH-01.report.send'));
    await flush();
    expect(actions.report).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('VEH-01.report.blockOffer')).toBeNull();
    await fireEvent.press(screen.getByTestId('VEH-01.report.done'));
    await flush();
    expect(await screen.findByText('@paul.roadster blockieren?')).toBeTruthy();
    expect(onBlocked).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('VEH-01.reportBlock.confirm'));
    await flush();
    expect(onBlocked).toHaveBeenCalledWith('paul.roadster');
  });

  it('sends a guest on native to the auth sheet', async () => {
    setGuest();
    await renderWith(adapterWith({}), <Host target={vehicle} />);
    await fireEvent.press(screen.getByTestId('host.report'));
    expect(useSessionStore.getState().promptOpen).toBe(true);
    expect(useSessionStore.getState().intent?.returnTo).toBe('/v/bmw-m3-e46');
    expect(screen.queryByText('Was ist das Problem?')).toBeNull();
  });
});

describe('SAFE-01', () => {
  beforeEach(() => {
    mockParams.id = '01JDEC';
  });

  it('shows the affected member the whole statement of reasons and the appeal deadline', async () => {
    await renderWith(adapterWith({}), <DecisionScreen />);
    expect(await screen.findByText('Wir haben deinen Inhalt entfernt')).toBeTruthy();
    expect(screen.getByTestId('SAFE-01.facts')).toHaveTextContent(/ohne deren Einwilligung/);
    expect(screen.getByTestId('SAFE-01.groundText')).toHaveTextContent('Community-Richtlinien §5 (Privatsphäre)');
    expect(screen.getByTestId('SAFE-01.automatedText')).toHaveTextContent(
      'Der Inhalt wurde ohne automatisierte Mittel erkannt, zum Beispiel durch eine Meldung. Eine Person aus unserem Team hat entschieden, kein automatisiertes System.',
    );
    expect(screen.getByTestId('SAFE-01.scope')).toHaveTextContent('Gilt für diesen Inhalt auf ganz SPEED CLUB. Er bleibt entfernt, es sei denn, ein Einspruch hat Erfolg.');
    expect(screen.getByTestId('SAFE-01.disputeLink')).toBeTruthy();
    expect(screen.getByTestId('SAFE-01.appeal.open')).toBeTruthy();
    expect(screen.getByTestId('SAFE-01.appealButton')).not.toBeDisabled();
    expect(screen.getByText(/bis zum 02.05.2027 Einspruch/)).toBeTruthy();
    expect(screen.getByTestId('SAFE-01.dispute')).toBeTruthy();
    expect(screen.getByTestId('SAFE-01.court')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('SAFE-01.groundLink'));
    // M2.6 item 13: the link lands on the ground's section of the guidelines.
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/legal/community?section=5');
  });

  it('writes a measure’s end as a calendar day in Berlin, as the decision mail does (d.m.Y, M2.8)', async () => {
    // 23:30 UTC is already 00:30 of the next day in Berlin; the line shows that day, with no clock time.
    const until = '2026-12-14T23:30:00Z';
    const restricted = decision({
      action: 'restrict',
      outcome: 'measures',
      restriction: { kind: 'messaging', until },
      scope: { appliesTo: 'account', until },
    });
    await renderWith(adapterWith({ decision: restricted }), <DecisionScreen />);
    expect(await screen.findByTestId('SAFE-01.scope')).toHaveTextContent('Gilt für dein Konto bis zum 15.12.2026.');
    expect(screen.getByTestId('SAFE-01.outcome')).toHaveTextContent('Du kannst bis zum 15.12.2026 keine Nachrichten schreiben.');
    expect(screen.queryByText(/00:30/)).toBeNull();
  });

  it('shows a reporter the outcome only, with automated means and the redress', async () => {
    const reporter = decision({ viewer: 'reporter', action: null, outcome: 'measures', scope: null, statement: null, groundDocument: null, groundSection: null, canAppeal: false });
    await renderWith(adapterWith({ decision: reporter }), <DecisionScreen />);
    expect(await screen.findByText('Wir haben deine Meldung geprüft')).toBeTruthy();
    expect(screen.getByTestId('SAFE-01.outcome')).toHaveTextContent('Wir haben „Foto von VW Golf II GTI“ geprüft und Maßnahmen ergriffen. Danke für deine Meldung.');
    expect(screen.queryByTestId('SAFE-01.facts')).toBeNull();
    expect(screen.queryByTestId('SAFE-01.groundLink')).toBeNull();
    expect(screen.getByTestId('SAFE-01.automatedText')).toBeTruthy();
    expect(screen.queryByTestId('SAFE-01.appeal')).toBeNull();
    expect(screen.getByTestId('SAFE-01.dispute')).toBeTruthy();
  });

  it('lets a reporter appeal when the server allows it (Art. 20(1) DSA)', async () => {
    await renderWith(adapterWith({ decision: decision({ viewer: 'reporter', action: null, outcome: 'no_action', scope: null, statement: null }) }), <DecisionScreen />);
    expect(await screen.findByTestId('SAFE-01.appeal.open')).toHaveTextContent(/bis zum 02.05.2027 Einspruch/);
    expect(screen.getByTestId('SAFE-01.appealButton')).not.toBeDisabled();
  });

  it('disables the appeal after the deadline', async () => {
    mockClock.now = new Date('2027-05-03T08:00:00+02:00');
    await renderWith(adapterWith({ decision: decision({ canAppeal: false }) }), <DecisionScreen />);
    expect(await screen.findByTestId('SAFE-01.appeal.expired')).toHaveTextContent('Die Frist für einen Einspruch ist am 02.05.2027 abgelaufen.');
    expect(screen.getByTestId('SAFE-01.appealButton')).toBeDisabled();
    mockClock.now = new Date('2026-11-08T11:00:00+01:00');
  });

  it('disables the appeal once one is open', async () => {
    const pending = decision({ appeal: { status: 'open', createdAt: '2026-11-04T10:00:00Z', decidedAt: null }, canAppeal: false });
    await renderWith(adapterWith({ decision: pending }), <DecisionScreen />);
    expect(await screen.findByTestId('SAFE-01.appeal.pending')).toHaveTextContent(/vom 04.11.2026 ist eingegangen/);
    expect(screen.getByTestId('SAFE-01.appealButton')).toBeDisabled();
  });

  it('sends the appeal and shows the sent state', async () => {
    const actions = fakeActions();
    await renderWith(adapterWith({ actions }), <DecisionScreen />);
    await fireEvent.press(await screen.findByTestId('SAFE-01.appealButton'));
    await fireEvent.press(screen.getByTestId('SAFE-01.appealSheet.send'));
    await flush();
    expect(screen.getByText('Schreib kurz, warum du widersprichst.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('SAFE-01.appealSheet.text'), 'Das Kennzeichen ist meins, die Person bin ich.');
    await fireEvent.press(screen.getByTestId('SAFE-01.appealSheet.send'));
    await flush();
    expect(actions.appeal).toHaveBeenCalledWith('01JDEC', 'Das Kennzeichen ist meins, die Person bin ich.', expect.any(String));
    expect(screen.getByTestId('SAFE-01.appealSheet.sent')).toBeTruthy();
  });

  it('shows the designed state for a decision that is not there', async () => {
    await renderWith(unavailableSafety, <DecisionScreen />);
    expect(await screen.findByTestId('SAFE-01.notFound')).toBeTruthy();
  });
});

describe('SET-16', () => {
  it('groups my reports and the decisions about my content, opening SAFE-01 where decided', async () => {
    const reports: ReportSummary[] = [
      { id: 'r1', target: { type: 'photo', label: 'Audi RS2 Avant' }, reason: 'spam', status: 'in_review', decision: null, createdAt: '2026-11-06T10:00:00Z' },
      {
        id: 'r2',
        target: { type: 'member', label: '@drift.koenig' },
        reason: 'harassment',
        status: 'decided',
        decision: { id: 'd2', outcome: 'measures', decidedAt: '2026-11-04T10:00:00Z', appealStatus: 'open' },
        createdAt: '2026-11-01T10:00:00Z',
      },
    ];
    await renderWith(adapterWith({ reports }), <ReportsScreen />);
    expect(await screen.findByText('Meine Meldungen')).toBeTruthy();
    expect(screen.getByTestId('SET-16.report.r1.status')).toHaveTextContent('In Prüfung');
    expect(screen.getByTestId('SET-16.report.r2.status')).toHaveTextContent('Entschieden');
    expect(screen.getByText('Foto von Audi RS2 Avant')).toBeTruthy();
    expect(screen.getByText(/Einspruch in Prüfung/)).toBeTruthy();
    expect(screen.getByTestId('SET-16.empty.about')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('SET-16.report.r2.body'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/decision/[id]', params: { id: 'd2' } });
  });

  it('shows both empty rows for a member without reports', async () => {
    await renderWith(adapterWith({}), <ReportsScreen />);
    expect(await screen.findByTestId('SET-16.empty.mine')).toBeTruthy();
    expect(screen.getByTestId('SET-16.empty.about')).toBeTruthy();
  });

  it('offers the next page of a section', async () => {
    const loadMore = jest.fn();
    const adapter = adapterWith({
      reports: [{ id: 'r1', target: { type: 'vehicle', label: 'Audi RS2 Avant' }, reason: 'spam', status: 'received', decision: null, createdAt: '2026-11-06T10:00:00Z' }],
    });
    const more: SafetyAdapter = { ...adapter, useMyReports: () => ({ ...adapter.useMyReports(), hasMore: true, loadMore }) };
    await renderWith(more, <ReportsScreen />);
    await fireEvent.press(await screen.findByTestId('SET-16.more.mine'));
    expect(loadMore).toHaveBeenCalled();
    expect(screen.queryByTestId('SET-16.more.about')).toBeNull();
  });

  it('keeps a calm placeholder until the API exists', async () => {
    await renderWith(unavailableSafety, <ReportsScreen />);
    expect(await screen.findByTestId('SET-16.soon')).toBeTruthy();
  });
});

describe('design QA round 1 (M2.8)', () => {
  const r1: ReportSummary = { id: 'r1', target: { type: 'photo', label: 'Audi RS2 Avant' }, reason: 'spam', status: 'in_review', decision: null, createdAt: '2026-11-06T10:00:00Z' };
  const r2: ReportSummary = {
    id: 'r2',
    target: { type: 'member', label: '@drift.koenig' },
    reason: 'harassment',
    status: 'decided',
    decision: { id: 'd2', outcome: 'measures', decidedAt: '2026-11-04T10:00:00Z', appealStatus: null },
    createdAt: '2026-11-01T10:00:00Z',
  };

  it('DQ-421: SET-16 sets each section in an FS-12 inset group: surface, radius 12 on its ends, rows of 72', async () => {
    await renderWith(adapterWith({ reports: [r1, r2] }), <ReportsScreen />);
    await screen.findByText('Meine Meldungen');
    const surface = themes.carbon.color.bg.surface;
    const first = styleOf('SET-16.card.report.r1');
    const last = styleOf('SET-16.card.report.r2');
    expect(first).toMatchObject({ backgroundColor: surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md });
    expect(first.borderBottomLeftRadius).toBeUndefined();
    expect(last).toMatchObject({ backgroundColor: surface, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md });
    expect(last.borderTopLeftRadius).toBeUndefined();
    expect(styleOf('SET-16.report.r1.body').minHeight).toBe(size.row.withThumb);
    // The empty line is the one row of its own card, never text on the canvas.
    expect(styleOf('SET-16.card.empty.about')).toMatchObject({
      backgroundColor: surface,
      borderTopLeftRadius: radius.md,
      borderBottomRightRadius: radius.md,
    });
    expect(styleOf('SET-16.empty.about').minHeight).toBe(size.row.withThumb);
  });

  it('DQ-421: only a row with a decision opens SAFE-01; the pill trails either way', async () => {
    await renderWith(adapterWith({ reports: [r1, r2] }), <ReportsScreen />);
    await screen.findByText('Meine Meldungen');
    expect(screen.getByTestId('SET-16.report.r1.body').props.role).toBeUndefined();
    expect(screen.getByTestId('SET-16.report.r2.body').props.role).toBe('link');
    expect(screen.getByTestId('SET-16.report.r1.status')).toHaveTextContent('In Prüfung');
    await fireEvent.press(screen.getByTestId('SET-16.report.r2.body'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/decision/[id]', params: { id: 'd2' } });
  });

  it('DQ-422: the SET-16 skeleton is one 72 card per section, at the top of the list without the state gap', async () => {
    const adapter: SafetyAdapter = {
      ...adapterWith({}),
      useMyReports: () => ({ ...pending<readonly ReportSummary[]>(), hasMore: false, isLoadingMore: false, loadMore: jest.fn() }),
      useMyDecisions: () => ({ ...pending<readonly DecisionSummary[]>(), hasMore: false, isLoadingMore: false, loadMore: jest.fn() }),
    };
    await renderWith(adapter, <ReportsScreen />);
    expect(screen.getByTestId('SET-16.skeleton')).toBeTruthy();
    expect(screen.getAllByTestId(/^SET-16\.skeleton\.(mine|about)\.card$/)).toHaveLength(2);
    expect(styleOf('SET-16.skeleton.mine.card').height).toBe(size.row.withThumb);
    expect(styleOf('SET-16.state').paddingTop).toBeUndefined();
  });

  it('DQ-422: SAFE-01 draws its skeleton from the top of the column, in the sections of the body', async () => {
    mockParams.id = '01JDEC';
    const adapter: SafetyAdapter = { ...adapterWith({}), useDecision: () => pending<DecisionDetail>() };
    await renderWith(adapter, <DecisionScreen />);
    expect(screen.getByTestId('SAFE-01.skeleton')).toBeTruthy();
    expect(styleOf('SAFE-01.column').justifyContent).toBeUndefined();
    expect(screen.getAllByTestId('SAFE-01.skeleton.section')).toHaveLength(3);
  });

  it('DQ-422: SAFE-01 still centres a state that is not a skeleton', async () => {
    mockParams.id = '01JDEC';
    await renderWith(unavailableSafety, <DecisionScreen />);
    await screen.findByTestId('SAFE-01.notFound');
    expect(styleOf('SAFE-01.column').justifyContent).toBe('center');
  });

  it('DQ-429: section and article numbers stay on the line of their sign (§ and Art. with a no-break space)', async () => {
    mockParams.id = '01JDEC';
    await renderWith(adapterWith({}), <DecisionScreen />);
    await screen.findByTestId('SAFE-01.dispute');
    // Exact text, not the matcher's whitespace-normalised one, which would accept a plain space too.
    expect(screen.getByText(/nach Art\.\u00a021 DSA wenden/, { normalizer: (text) => text })).toBeTruthy();
    expect(screen.queryByText(/Art\. 21/, { normalizer: (text) => text })).toBeNull();
  });
});

/** ADR-224 (M3.2): staff decisions without a report, and reversals. */
describe('SAFE-01 staff decisions and reversals', () => {
  beforeEach(() => {
    mockParams.id = '01JDEC';
  });

  it('own initiative: says we looked ourselves, never "Meldung"', async () => {
    await renderWith(adapterWith({ decision: decision({ origin: 'staff' }) }), <DecisionScreen />);
    const automated = await screen.findByTestId('SAFE-01.automatedText');
    expect(automated).toHaveTextContent(/^Wir haben das selbst geprüft, ohne automatisierte Mittel\./);
    expect(automated).not.toHaveTextContent(/Meldung|gemeldet/);
  });

  it('a reversal: its own title, what came back, the earlier decision, and no appeal', async () => {
    const reversal = decision({
      id: '01JREV',
      action: 'reverse',
      outcome: 'reversed',
      origin: 'staff',
      reversesDecisionId: '01JDEC',
      scope: null,
      redress: [],
      appealUntil: null,
      canAppeal: false,
    });
    await renderWith(adapterWith({ decision: reversal }), <DecisionScreen />);
    expect(await screen.findByText('Entscheidung aufgehoben')).toBeTruthy();
    expect(screen.getByTestId('SAFE-01.outcome')).toHaveTextContent(/„Foto von VW Golf II GTI“ ist wieder für alle sichtbar\./);
    expect(screen.getByTestId('SAFE-01.reverseNote')).toHaveTextContent(/keinen Einspruch/);
    expect(screen.queryByTestId('SAFE-01.section.redress')).toBeNull();
    expect(screen.queryByTestId('SAFE-01.appealButton')).toBeNull();
    // M3.5: the ground of a reversal is the review, never a lone link to the rule.
    expect(screen.getByText('Warum wir sie aufgehoben haben')).toBeTruthy();
    expect(screen.getByTestId('SAFE-01.groundText').props.children).toBeTruthy();
    expect(screen.queryByTestId('SAFE-01.groundLink')).toBeNull();
    await fireEvent.press(screen.getByTestId('SAFE-01.original'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/decision/[id]', params: { id: '01JDEC' } });
  });

  it('a lifted account measure says the account is usable again', async () => {
    await renderWith(
      adapterWith({ decision: decision({ action: 'reverse', outcome: 'reversed', target: { type: 'member', label: '@lukas.sc' }, scope: null, redress: [], canAppeal: false }) }),
      <DecisionScreen />,
    );
    expect(await screen.findByTestId('SAFE-01.outcome')).toHaveTextContent(/Wir haben die Maßnahme gegen dein Konto aufgehoben\. Du kannst es wieder wie vorher nutzen\./);
  });

  it('a reversal without the team\'s reason says what the review found', async () => {
    const base = decision({ action: 'reverse', outcome: 'reversed', scope: null, redress: [], canAppeal: false });
    await renderWith(adapterWith({ decision: { ...base, statement: base.statement ? { ...base.statement, ground: '' } : base.statement } }), <DecisionScreen />);
    expect(await screen.findByTestId('SAFE-01.groundText')).toHaveTextContent(/noch einmal geprüft/);
  });
});
