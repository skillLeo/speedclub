/** R4-2.1 HOME-01 "Wähle das Car of the Day von morgen": vote, change, refusals, the own car, flag off. Never a count. */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { cotdVoteKeys, parseVoteState } from '@/features/home/cotdVote';
import { candidateHandleLines, candidateNameLines, candidateNameText, CotdVoteModule } from '@/features/home/components/CotdVoteModule';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import * as toastModule from '@/ui/toast';

import { GTI, M4, R34, voteCandidate, voteRoundBody } from './fixtures';
import { callsTo, newQueryClient, renderWithProviders, stubFetch } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/',
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/lib/clock', () => ({ now: () => new Date('2026-11-21T19:00:00+01:00') }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ID = 'HOME-01.vote';
const withFlags = (flags: Record<string, boolean>) => {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, ...flags } }, confirmed: true });
  return client;
};
const render = (flags: Record<string, boolean> = { cotd_voting: true }) =>
  renderWithProviders(<CotdVoteModule column={350} bleed={20} onOpen={jest.fn()} testID={ID} />, withFlags(flags));
const radio = (position: number) => screen.getByTestId(`${ID}.candidate.${position}`);
const methodOf = (request: Request) => request.method;
/** The name as the tile sets it reads the same once its binding characters (word joiner, no-break space) are folded. */
const fold = (text: unknown) => String(text).replace(/\u2060/g, '').replace(/\u00A0/g, ' ');
const nameOf = (position: number) => fold(screen.getByTestId(`${ID}.candidate.${position}.name`).props.children);

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  useSessionStore.setState({ status: 'member', member: { id: 'viewer', username: 'max.e46', displayName: 'Max', avatarUrl: null } });
});

describe('HOME-01 Car of the Day vote', () => {
  it('shows a round restored from the persisted cache after a reload instead of breaking Start (R5-1)', async () => {
    // The persister writes the cache as JSON. A round cached as parsed state came back with its times as strings, `format.time`
    // threw, and Start showed "Diese Ansicht konnte nicht geladen werden" to a signed-in member until the cache expired.
    // A read that still went out fails: the restored round has to carry the card on its own.
    const { calls } = stubFetch({ '/car-of-the-day/vote': { status: 503, body: { error: { code: 'server_error', message: 'down' } } } });
    const client = withFlags({ cotd_voting: true });
    client.setQueryData(cotdVoteKeys.state('viewer|de'), JSON.parse(JSON.stringify(voteRoundBody().data)), { updatedAt: Date.now() });
    await renderWithProviders(<CotdVoteModule column={350} bleed={20} onOpen={jest.fn()} testID={ID} />, client);
    expect(await screen.findByTestId(`${ID}.intro`)).toHaveTextContent('Eine Stimme pro Tag. Ändern kannst du sie bis morgen, 17:00 Uhr.');
    expect(nameOf(1)).toBe(R34.full_title);
    // Whatever the cache holds is JSON: the query keeps the body, the round is parsed when it is read.
    expect(JSON.parse(JSON.stringify(client.getQueryData(cotdVoteKeys.state('viewer|de'))))).toEqual(client.getQueryData(cotdVoteKeys.state('viewer|de')));
    expect(callsTo(calls, '/car-of-the-day/vote').length).toBeLessThanOrEqual(1);
  });

  it('does not break on a cache an older build left (its parsed round as JSON, times as strings)', async () => {
    stubFetch({ '/car-of-the-day/vote': { status: 503, body: { error: { code: 'server_error', message: 'down' } } } });
    const client = withFlags({ cotd_voting: true });
    client.setQueryData(cotdVoteKeys.state('viewer|de'), JSON.parse(JSON.stringify(parseVoteState(voteRoundBody()))), { updatedAt: Date.now() });
    await renderWithProviders(<CotdVoteModule column={350} bleed={20} onOpen={jest.fn()} testID={ID} />, client);
    expect(await screen.findByTestId(`${ID}.title`)).toBeTruthy();
    expect(nameOf(1)).toBe(R34.full_title);
  });

  it('shows the three candidates in the Picker order with name and owner, and no number of votes', async () => {
    stubFetch({ '/car-of-the-day/vote': { body: voteRoundBody() } });
    await render();
    expect(await screen.findByTestId(`${ID}.title`)).toHaveTextContent('Wähle das Car of the Day von morgen');
    expect(screen.getByTestId(`${ID}.intro`)).toHaveTextContent('Eine Stimme pro Tag. Ändern kannst du sie bis morgen, 17:00 Uhr.');
    expect(nameOf(1)).toBe(R34.full_title);
    expect(nameOf(2)).toBe(M4.full_title);
    expect(nameOf(3)).toBe(GTI.full_title);
    expect(radio(1)).toHaveAccessibleName(`${R34.full_title}, @kenji.r34`);
    expect(screen.queryByText(/Stimme[n]? \d|\d+ ?%|\d+ Stimmen/)).toBeNull();
  });

  it('votes with an idempotency key, shows the choice at once and says "Du hast abgestimmt"', async () => {
    let answer = voteRoundBody();
    const { calls } = stubFetch({
      '/car-of-the-day/vote': (request) => {
        if (request.method === 'POST') answer = voteRoundBody({ my_vote: M4.id });
        return { body: answer };
      },
    });
    await render();
    await screen.findByTestId(`${ID}.candidate.2`);
    await act(async () => fireEvent.press(radio(2)));
    expect(radio(2)).toBeChecked();
    const post = await waitFor(() => {
      const found = callsTo(calls, '/car-of-the-day/vote').find((request) => methodOf(request) === 'POST');
      expect(found).toBeDefined();
      return found!;
    });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await post.clone().json()).toEqual({ day: '2026-11-22', vehicle_id: M4.id });
    expect(await screen.findByTestId(`${ID}.voted`)).toHaveTextContent(`Du hast abgestimmt: ${M4.full_title}. Wechseln geht bis 17:00 Uhr.`);
    expect(screen.getByTestId(`${ID}.candidate.2.chosen`)).toHaveTextContent('Deine Wahl');
  });

  it('puts the old vote back and says why when the vote is refused', async () => {
    const toast = jest.spyOn(toastModule, 'toast');
    stubFetch({
      '/car-of-the-day/vote': (request) =>
        request.method === 'POST'
          ? { status: 422, body: { message: 'Die Abstimmung für diesen Tag ist beendet.', code: 'validation_failed', errors: { day: ['Die Abstimmung für diesen Tag ist beendet.'] } } }
          : { body: voteRoundBody({ my_vote: R34.id }) },
    });
    await render();
    await screen.findByTestId(`${ID}.candidate.2`);
    await act(async () => fireEvent.press(radio(2)));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Die Abstimmung für diesen Tag ist beendet.', expect.objectContaining({ haptic: 'warning' })));
    await waitFor(() => expect(radio(1)).toBeChecked());
    expect(radio(2)).not.toBeChecked();
  });

  it('shows the own car without letting it be voted for', async () => {
    const { calls } = stubFetch({
      '/car-of-the-day/vote': { body: voteRoundBody({ candidates: [voteCandidate(1, R34, { own: true, votable: false }), voteCandidate(2, M4)] }) },
    });
    await render();
    expect(await screen.findByTestId(`${ID}.candidate.1.own`)).toHaveTextContent('Dein Auto');
    expect(radio(1)).toBeDisabled();
    await act(async () => fireEvent.press(radio(1)));
    expect(callsTo(calls, '/car-of-the-day/vote').filter((request) => methodOf(request) === 'POST')).toHaveLength(0);
  });

  it.each([
    ['account_too_new', 'Abstimmen kannst du drei Tage nach deiner Anmeldung, ab 23.11.2026, 10:00 Uhr.'],
    ['email_unverified', 'Bestätige zuerst deine E-Mail-Adresse, dann kannst du abstimmen.'],
    ['restricted', 'Dein Konto ist gerade eingeschränkt, deshalb kannst du nicht abstimmen.'],
    ['sample_account', 'Mit einem Beispielkonto kannst du nicht abstimmen.'],
  ])('says plainly why %s may not vote', async (reason, line) => {
    stubFetch({
      '/car-of-the-day/vote': {
        body: voteRoundBody({ can_vote: false, cannot_vote_reason: reason, can_vote_from: reason === 'account_too_new' ? '2026-11-23T10:00:00+01:00' : null }),
      },
    });
    await render();
    expect(await screen.findByTestId(`${ID}.reason.${reason}`)).toHaveTextContent(line);
    expect(radio(1)).toBeDisabled();
  });

  it('reads a closed round and the winner the votes picked', async () => {
    stubFetch({
      '/car-of-the-day/vote': {
        body: voteRoundBody({ status: 'closed', can_vote: false, cannot_vote_reason: 'closed', my_vote: M4.id }, { day: '2026-11-21', my_vote: GTI.id, winner: GTI, by_vote: true }),
      },
    });
    await render();
    expect(await screen.findByTestId(`${ID}.intro`)).toHaveTextContent('Abstimmung beendet, um 18 Uhr steht der Gewinner fest.');
    expect(screen.getByTestId(`${ID}.voted`)).toHaveTextContent(`Du hast abgestimmt: ${M4.full_title}.`);
    expect(screen.getByTestId(`${ID}.lastResult`)).toHaveTextContent(`Deine Wahl hat gewonnen: ${GTI.full_title} ist heute Car of the Day`);
    expect(radio(2)).toBeDisabled();
    expect(screen.queryByTestId(`${ID}.lastResult.sample`)).toBeNull();
    expect(screen.queryByTestId(`${ID}.candidate.1.sample`)).toBeNull();
  });

  it('badges a sample candidate and a sample last winner "Beispiel" (ADR-535), one badge per tile', async () => {
    const sampleM4 = { ...M4, is_sample: true };
    stubFetch({
      '/car-of-the-day/vote': {
        body: voteRoundBody(
          { candidates: [voteCandidate(2, sampleM4), voteCandidate(1, R34), voteCandidate(3, GTI)] },
          { day: '2026-11-21', my_vote: null, winner: { ...GTI, is_sample: true }, by_vote: true },
        ),
      },
    });
    await render();
    expect(await screen.findByTestId(`${ID}.candidate.2.sample`)).toHaveTextContent('Beispiel');
    expect(screen.queryByTestId(`${ID}.candidate.1.sample`)).toBeNull();
    expect(screen.queryByTestId(`${ID}.candidate.3.sample`)).toBeNull();
    expect(screen.getAllByText('Beispiel', { exact: true }).length).toBe(2);
    expect(radio(2)).toHaveAccessibleName(new RegExp(`^Beispiel, ${M4.full_title}`));
    expect(screen.getByTestId(`${ID}.lastResult.sample`)).toHaveTextContent('Beispiel');
    expect(screen.getByTestId(`${ID}.lastResult`)).toHaveAccessibleName(`Von euch gewählt: ${GTI.full_title} ist heute Car of the Day, Beispiel`);
  });

  it('is not there with the flag off, for a guest, or when the server answers feature_disabled', async () => {
    const { calls } = stubFetch({ '/car-of-the-day/vote': { status: 404, body: { message: 'Aus', code: 'feature_disabled', errors: {} } } });
    const off = await render({ cotd_voting: false });
    expect(screen.queryByTestId(ID)).toBeNull();
    expect(callsTo(calls, '/car-of-the-day/vote')).toHaveLength(0);
    await act(async () => off.unmount());

    useSessionStore.setState({ status: 'guest', member: null });
    const guest = await render();
    expect(screen.queryByTestId(ID)).toBeNull();
    expect(callsTo(calls, '/car-of-the-day/vote')).toHaveLength(0);
    await act(async () => guest.unmount());

    useSessionStore.setState({ status: 'member', member: { id: 'viewer', username: 'max.e46', displayName: 'Max', avatarUrl: null } });
    await render();
    await waitFor(() => expect(callsTo(calls, '/car-of-the-day/vote')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId(`${ID}.skeleton`)).toBeNull());
    expect(screen.queryByTestId(ID)).toBeNull();
    expect(screen.queryByTestId(`${ID}.error`)).toBeNull();
  });

  it('hides an unavailable round', async () => {
    stubFetch({ '/car-of-the-day/vote': { body: voteRoundBody({ status: 'unavailable', unavailable_reason: 'staff_decided', candidates: [] }) } });
    await render();
    await waitFor(() => expect(screen.queryByTestId(`${ID}.skeleton`)).toBeNull());
    expect(screen.queryByTestId(ID)).toBeNull();
  });

  it('offers a retry when the round could not be read', async () => {
    stubFetch({ '/car-of-the-day/vote': { status: 500, body: { message: 'Fehler', code: 'server_error', errors: {} } } });
    await render();
    expect(await screen.findByTestId(`${ID}.error`)).toHaveTextContent(/Die Abstimmung konnte nicht geladen werden\./);
    expect(screen.getByTestId(`${ID}.retry`)).toBeTruthy();
  });

  it('marks the chosen car with the onPhoto ring and its stage-toned inner gap, and says "Deine Wahl"', async () => {
    stubFetch({ '/car-of-the-day/vote': { body: voteRoundBody({ my_vote: R34.id }) } });
    await render();
    const ring = await screen.findByTestId(`${ID}.candidate.1.ring`);
    expect(ring).toBeTruthy();
    expect(screen.getByTestId(`${ID}.candidate.1.chosen`)).toHaveTextContent('Deine Wahl');
    expect(radio(1)).toBeChecked();
  });
});

describe('R4DQ-02 candidate names', () => {
  it('keeps two lines up to 130 % and the whole name from a larger font', () => {
    expect(candidateNameLines(1)).toBe(2);
    expect(candidateNameLines(1.3)).toBe(2);
    expect(candidateNameLines(1.31)).toBeUndefined();
    expect(candidateNameLines(2)).toBeUndefined();
  });

  it('keeps "GT-R" whole and binds "R34" to it where the pair fits the tile', () => {
    const name = candidateNameText('Nissan Skyline GT-R R34', 200, 2);
    expect(name).toContain('GT-\u2060R');
    expect(name).toMatch(/GT-\u2060R\u00A0R34$/);
  });

  it('lets the owner handle take two lines from a large font, breaking only after "." or "_" (R4DQ-54)', async () => {
    expect(candidateHandleLines(1)).toBe(1);
    expect(candidateHandleLines(1.3)).toBe(1);
    expect(candidateHandleLines(2)).toBe(2);
    stubFetch({ '/car-of-the-day/vote': { body: voteRoundBody() } });
    await render();
    const handle = await screen.findByTestId(`${ID}.candidate.1.owner`);
    expect(handle.props.children).toBe('@kenji.\u200Br34');
  });

  it('leaves the code breakable when the pair would not fit the tile', () => {
    expect(candidateNameText('Nissan Skyline GT-R R34', 40, 2)).toMatch(/GT-\u2060R R34$/);
  });
});
