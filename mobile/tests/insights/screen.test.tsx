/** M5.7 INS-01 "Statistiken" (10 §6.1, §16; m5.7-contract §3): numbers, plain words, never a loss, owner only. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { deltaLine } from '@/features/insights/model';
import { InsightsScreen } from '@/features/insights/screens/InsightsScreen';
import i18n from '@/i18n';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, signIn, signOut, stubApi } from '../gift/helpers';
import { CAR, insights, zero } from './fixtures';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/insights',
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), getParent: () => undefined, getState: () => undefined }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('token-1')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  process.env.EXPO_PUBLIC_WEB_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ERROR = (status: number, code: string) => ({ status, body: { message: code, code, errors: {} } });
const t = i18n.getFixedT('de', 'profile');
const format = { number: (value: number) => String(value) };

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  signIn();
});

describe('delta in plain words (10 §16)', () => {
  it('names a rise with its percentage', () => {
    expect(deltaLine(t, { this_week: 128, last_week: 98, delta_percent: 31, trend: 'up' }, format)).toBe('31 % mehr als letzte Woche');
  });

  it('never gives a drop a percentage or a loss word', () => {
    const line = deltaLine(t, { this_week: 40, last_week: 98, delta_percent: -59, trend: 'down' }, format);
    expect(line).toBe('Letzte Woche: 98');
    expect(line).not.toMatch(/%|weniger|gesunken|−|-/);
  });

  it('says "new", "same" and "none" without numbers', () => {
    expect(deltaLine(t, { this_week: 5, last_week: 0, delta_percent: null, trend: 'new' }, format)).toBe('Die ersten Aufrufe – letzte Woche noch keine');
    expect(deltaLine(t, { this_week: 9, last_week: 9, delta_percent: 0, trend: 'same' }, format)).toBe('So viele wie letzte Woche');
    expect(deltaLine(t, { this_week: 0, last_week: 0, delta_percent: null, trend: 'same' }, format)).toBe('Diese Woche noch keine Aufrufe');
    // A rise on a small base (delta null below five): last week's number, no percentage.
    expect(deltaLine(t, { this_week: 4, last_week: 2, delta_percent: null, trend: 'up' }, format)).toBe('Letzte Woche: 2');
  });
});

describe('INS-01', () => {
  it('shows the account: headline, this week, 30 days, sources, the week and the pages', async () => {
    const { calls } = stubApi({ 'GET /me/insights': { body: { data: insights() } } });
    await renderScreen(<InsightsScreen scope="account" />);
    await waitFor(() => expect(screen.getByTestId('INS-01.thisWeek')).toHaveTextContent('128'));
    expect(screen.getByTestId('INS-01.headline')).toHaveTextContent('Deine Garage wurde diese Woche 128-mal angesehen – 31 % mehr als letzte Woche.');
    // DQ-P5-018: the comparison in words once (the sentence); every number names its period.
    expect(screen.getByTestId('INS-01.lastWeek')).toHaveTextContent('98');
    expect(screen.getByTestId('INS-01.delta')).toHaveTextContent(/Letzte Woche.*98/);
    expect(screen.queryByText('31 % mehr als letzte Woche')).toBeNull();
    expect(screen.queryByTestId('INS-01.deltaLine')).toBeNull();
    expect(screen.getByText('Aufrufe 30 Tage')).toBeTruthy();
    expect(screen.getByTestId('INS-01.total30')).toHaveTextContent('402');
    expect(screen.getByTestId('INS-01.sources.caption')).toHaveTextContent('Letzte 30 Tage');
    expect(screen.getByTestId('INS-01.week.caption')).toHaveTextContent('Die letzten 7 Tage, daneben die 7 Tage davor');
    expect(screen.getByTestId('INS-01.breakdown.caption')).toHaveTextContent('Aufrufe diese Woche');
    expect(screen.getByTestId('INS-01.source.sticker_scan')).toHaveTextContent(/Sticker-Scan.*180 · 45 %/);
    expect(screen.getByTestId('INS-01.week.scans')).toHaveTextContent(/14/);
    expect(screen.getByTestId('INS-01.week.spots')).toHaveTextContent(/6/);
    expect(screen.getByTestId('INS-01.week.followers')).toHaveTextContent(/Letzte Woche: 1/);
    expect(screen.getByTestId('INS-01.week.reactions')).toHaveTextContent(/Stark 9 · Sauber 6 · Tief 4 · Laut 2/);
    // DQ-P5-035 b: last week's number on its own line, never "· Letzte Woche" starting a line.
    expect(screen.getByTestId('INS-01.week.reactions')).toHaveTextContent(/Letzte Woche: 17\sStark 9/);
    expect(screen.getByTestId('INS-01.breakdown.profile')).toHaveTextContent(/40 Aufrufe/);
    expect(screen.getByLabelText(/Aufrufe der letzten 30 Tage: 402, an einem Tag höchstens 12\. Dazu 51 Sticker-Scans\./)).toBeTruthy();
    expect(screen.getByTestId('INS-01.chart.legend', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('INS-01.countingSince')).toBeNull();
    expect(calls.map((call) => call.path)).toEqual(['/api/v1/me/insights']);
    // A car of the breakdown opens its own statistics.
    fireEvent.press(screen.getByTestId(`INS-01.breakdown.${CAR}`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/vehicles/[id]/insights', params: { id: CAR } });
  });

  it('reads a drop without a loss: last week as a plain number, no percentage', async () => {
    stubApi({
      'GET /me/insights': {
        body: {
          data: insights({
            headline: 'Deine Garage wurde diese Woche 40-mal angesehen. Letzte Woche waren es 98.',
            views: { this_week: 40, last_week: 98, delta_percent: -59, trend: 'down', total_30_days: 310 },
          }),
        },
      },
    });
    await renderScreen(<InsightsScreen scope="account" />);
    await waitFor(() => expect(screen.getByTestId('INS-01.delta')).toHaveTextContent(/Letzte Woche.*98/));
    expect(screen.queryByText(/59/)).toBeNull();
    expect(screen.queryByText(/weniger|gesunken/)).toBeNull();
  });

  it('reads the vehicle scope with the car as the sub-line and "Zählung seit" inside the 30 days', async () => {
    mockParams = { id: CAR };
    const { calls } = stubApi({
      [`GET /vehicles/${CAR}/insights`]: {
        body: {
          data: insights({
            scope: 'vehicle',
            vehicle: { id: CAR, slug: 'nissan-skyline-gt-r-r34-5tf974vj', full_title: 'Nissan Skyline GT-R R34', cover: null, is_sample: false },
            counting_since: '2026-11-02',
            follows: { profile: null, vehicles: { this_week: 2, last_week: 0 } },
            breakdown: [],
          }),
        },
      },
    });
    await renderScreen(<InsightsScreen scope="vehicle" />);
    await waitFor(() => expect(screen.getByTestId('INS-01.subtitle')).toHaveTextContent(/Nissan Skyline GT\W*R R34/));
    expect(screen.getByTestId('INS-01.countingSince')).toHaveTextContent(/^Gezählt wird seit dem 2\.\s?Nov\.$/);
    expect(screen.queryByTestId('INS-01.week.followers')).toBeNull();
    expect(screen.queryByTestId('INS-01.breakdown')).toBeNull();
    expect(calls[0]?.path).toBe(`/api/v1/vehicles/${CAR}/insights`);
  });

  it('turns zero data into a sentence, the empty floor and one way on (share), not counters of zeros', async () => {
    stubApi({ 'GET /me/insights': { body: { data: zero() } } });
    await renderScreen(<InsightsScreen scope="account" />);
    await waitFor(() => expect(screen.getByTestId('INS-01.quiet')).toBeTruthy());
    // DQ-P5-036: the page's own title, and the body asks for what the button does ("Teil dein Profil" over "Profil teilen").
    expect(screen.getByTestId('INS-01.headline')).toHaveTextContent('Diese Woche noch keine Aufrufe.');
    expect(screen.getByText(/Teil dein Profil, damit es mehr Leute sehen\./)).toBeTruthy();
    expect(screen.getByText('Profil teilen')).toBeTruthy();
    // DQ-P5-019: a badged sample of the curve, not an empty chart frame.
    expect(screen.getByTestId('INS-01.sample.badge')).toHaveTextContent('Beispiel');
    expect(screen.getByLabelText(/^Beispiel: So zeigt die Kurve deine Aufrufe/)).toBeTruthy();
    expect(screen.queryByTestId('INS-01.chart')).toBeNull();
    expect(screen.queryByTestId('INS-01.thisWeek')).toBeNull();
  });

  it('shows staff in view-as the restricted state (403 view_as_read_only)', async () => {
    stubApi({ 'GET /me/insights': ERROR(403, 'view_as_read_only') });
    await renderScreen(<InsightsScreen scope="account" />);
    expect(await screen.findByTestId('INS-01.restricted')).toBeTruthy();
    expect(screen.getByText('Nur für den Besitzer')).toBeTruthy();
  });

  it("answers another member's car with the unavailable state", async () => {
    mockParams = { id: CAR };
    stubApi({ [`GET /vehicles/${CAR}/insights`]: ERROR(403, 'forbidden') });
    await renderScreen(<InsightsScreen scope="vehicle" />);
    expect(await screen.findByTestId('INS-01.unavailable')).toBeTruthy();
  });

  it('says when the feature is off (404 feature_disabled)', async () => {
    stubApi({ 'GET /me/insights': ERROR(404, 'feature_disabled') });
    await renderScreen(<InsightsScreen scope="account" />);
    expect(await screen.findByTestId('INS-01.disabled')).toBeTruthy();
  });

  it('offers a retry on a server error', async () => {
    jest.setTimeout(20000);
    const { calls } = stubApi({ 'GET /me/insights': ERROR(500, 'server_error') });
    await renderScreen(<InsightsScreen scope="account" />);
    // 5xx is retried twice (retryUnlessAnswered) before the error state shows.
    expect(await screen.findByTestId('INS-01.error', {}, { timeout: 10000 })).toBeTruthy();
    fireEvent.press(screen.getByText('Erneut versuchen'));
    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
  });

  it('asks a guest to sign in and reads nothing', async () => {
    signOut();
    const { calls } = stubApi({});
    await renderScreen(<InsightsScreen scope="account" />);
    expect(await screen.findByTestId('INS-01.guest')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
