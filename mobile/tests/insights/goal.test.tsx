/** M5.7 build goal "Ziel: Saison 2027" (10 §6.2, m5.7-contract §4.1): visitor line, owner rows, the sheet and its PATCH. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { BuildGoalBlock, hasVisibleGoal } from '@/features/insights/components/BuildGoalBlock';
import { BuildGoalSheet } from '@/features/insights/components/BuildGoalSheet';
import { berlinYear, firstGoalSeason, goalSeasons, goalVisibleTo, optimisticGoal } from '@/features/insights/model';
import { hydrateThemePreference } from '@/theme';
import { dismissToast } from '@/ui';
import { ToastHost } from '@/ui/ToastHost';

import { newQueryClient, renderScreen, signIn, stubApi } from '../gift/helpers';
import { R34 } from '../vehicle/fixtures';
import { insights } from './fixtures';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}), usePathname: () => '/' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const YEAR = berlinYear(new Date());
const goal = (season: number, passed = false) => ({ season, label: `Ziel: Saison ${season}`, passed });
const car = (extra: Partial<PublicVehicle> = {}): PublicVehicle => ({ ...R34, ...extra });

function client(insightsOn = true) {
  const next = newQueryClient();
  next.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { insights: insightsOn } }, confirmed: true });
  return next;
}

const ERROR_422 = { status: 422, body: { message: 'Die Angaben sind ungültig.', code: 'validation_failed', errors: { build_goal_season: ['Wähle eine Saison bis 2036.'] } } };

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
  dismissToast();
});

describe('goal rules', () => {
  it('offers this year to ten years ahead, and keeps a stored past season', () => {
    expect(goalSeasons(2026, null)).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036]);
    expect(goalSeasons(2026, 2025)[0]).toBe(2025);
    expect(goalSeasons(2026, 2028)).toHaveLength(11);
  });

  it('offers the next season first once this one is over (from November, DQ-P5-035 c)', () => {
    expect(firstGoalSeason(new Date('2026-10-31T12:00:00Z'))).toBe(2026);
    expect(firstGoalSeason(new Date('2026-11-16T12:00:00Z'))).toBe(2027);
    // 31 October 23:30 UTC is already November in Berlin.
    expect(firstGoalSeason(new Date('2026-10-31T23:30:00Z'))).toBe(2027);
    expect(goalSeasons(2026, null, 2027)).toEqual([2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036]);
    // A goal for this season set before November stays listed, first.
    expect(goalSeasons(2026, 2026, 2027)[0]).toBe(2026);
  });

  it('shows a visitor a goal only while its season is not over; the owner always', () => {
    expect(goalVisibleTo(null, true)).toBe(false);
    expect(goalVisibleTo(goal(2027), false)).toBe(true);
    expect(goalVisibleTo(goal(2025, true), false)).toBe(false);
    expect(goalVisibleTo(goal(2025, true), true)).toBe(true);
    expect(hasVisibleGoal(car({ build_goal: goal(2027) }), false)).toBe(true);
    expect(optimisticGoal(null, 2026, '')).toBeNull();
    expect(optimisticGoal(2027, 2026, 'Ziel: Saison 2027')).toEqual({ season: 2027, label: 'Ziel: Saison 2027', passed: false });
  });
});

describe('BuildGoalBlock', () => {
  it('gives a visitor the line "Ziel: Saison 2027" under the card, and nothing for a passed goal', async () => {
    stubApi({});
    const view = await renderScreen(
      <BuildGoalBlock vehicle={car({ build_goal: goal(2027) })} routeId="VEH-01" owner={false}>
        <RNText>Karte</RNText>
      </BuildGoalBlock>,
      client(),
    );
    expect(screen.getByTestId('VEH-01.goal.label')).toHaveTextContent('Ziel: Saison 2027');
    expect(screen.getByText('Karte')).toBeTruthy();
    expect(screen.queryByTestId('VEH-01.insights')).toBeNull();
    await view.unmount();
    await renderScreen(<BuildGoalBlock vehicle={car({ build_goal: goal(2025, true) })} routeId="VEH-01" owner={false} />, client());
    expect(screen.queryByTestId('VEH-01.goal')).toBeNull();
  });

  it("gives the owner the goal row and Statistiken with this week's views, to INS-01", async () => {
    const { calls } = stubApi({ [`GET /vehicles/${R34.id}/insights`]: { body: { data: insights({ scope: 'vehicle' }) } } });
    await renderScreen(<BuildGoalBlock vehicle={car({ build_goal: null })} routeId="GAR-02" owner />, client());
    expect(screen.getByTestId('GAR-02.goal')).toHaveTextContent(/Build-Ziel.*Nicht gesetzt/);
    await waitFor(() => expect(screen.getByTestId('GAR-02.insights')).toHaveTextContent(/128 Aufrufe diese Woche/));
    expect(calls.map((call) => call.path)).toEqual([`/api/v1/vehicles/${R34.id}/insights`]);
    await fireEvent.press(screen.getByTestId('GAR-02.insights'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/vehicles/[id]/insights', params: { id: R34.id } });
  });

  it('offers no Statistiken row while the flag is off or for a draft', async () => {
    const { calls } = stubApi({});
    await renderScreen(<BuildGoalBlock vehicle={car()} routeId="GAR-02" owner />, client(false));
    expect(screen.queryByTestId('GAR-02.insights')).toBeNull();
    await renderScreen(<BuildGoalBlock vehicle={car({ status: 'draft' })} routeId="GAR-02" owner />, client(true));
    expect(screen.queryAllByTestId('GAR-02.insights')).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('offers a passed goal as "Neues Ziel setzen"', async () => {
    stubApi({});
    await renderScreen(<BuildGoalBlock vehicle={car({ build_goal: goal(2025, true) })} routeId="GAR-02" owner />, client(false));
    expect(screen.getByTestId('GAR-02.goal')).toHaveTextContent(/Saison 2025 ist vorbei.*Neues Ziel setzen/);
  });
});

describe('BuildGoalSheet', () => {
  const render = (current: ReturnType<typeof goal> | null, onClose = jest.fn()) =>
    renderScreen(
      <>
        <BuildGoalSheet vehicle={R34} goal={current} visible onClose={onClose} testID="GAR-02.goalSheet" />
        <ToastHost />
      </>,
      client(),
    );

  it('saves a season through the vehicle PATCH, with a toast, and closes', async () => {
    const { calls } = stubApi({ [`PATCH /vehicles/${R34.id}`]: { body: { data: { id: R34.id, slug: R34.slug, build_goal: goal(YEAR + 1) } } } });
    const onClose = jest.fn();
    await render(null, onClose);
    const save = screen.getByTestId('GAR-02.goalSheet.save');
    // Nothing changed yet: nothing to save.
    expect(save).toBeDisabled();
    // DQ-P5-035 c: "Kein Ziel" leads the list and is the chosen row of a car without a goal.
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveTextContent('Kein Ziel');
    expect(radios[0]).toBeChecked();
    await fireEvent.press(screen.getByTestId(`GAR-02.goalSheet.season.${YEAR + 1}`));
    await fireEvent.press(screen.getByTestId('GAR-02.goalSheet.save'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ build_goal_season: YEAR + 1 });
    expect(await screen.findByText(`Ziel gespeichert: Saison ${YEAR + 1}`)).toBeTruthy();
  });

  it('clears the goal with null', async () => {
    const { calls } = stubApi({ [`PATCH /vehicles/${R34.id}`]: { body: { data: { id: R34.id, slug: R34.slug, build_goal: null } } } });
    const onClose = jest.fn();
    await render(goal(YEAR + 1), onClose);
    await fireEvent.press(screen.getByTestId('GAR-02.goalSheet.season.none'));
    await fireEvent.press(screen.getByTestId('GAR-02.goalSheet.save'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ build_goal_season: null });
  });

  it("puts the server's 422 on the field and stays open", async () => {
    stubApi({ [`PATCH /vehicles/${R34.id}`]: ERROR_422 });
    const onClose = jest.fn();
    await render(null, onClose);
    await fireEvent.press(screen.getByTestId(`GAR-02.goalSheet.season.${YEAR + 2}`));
    await fireEvent.press(screen.getByTestId('GAR-02.goalSheet.save'));
    expect(await screen.findByTestId('GAR-02.goalSheet.error')).toHaveTextContent('Wähle eine Saison bis 2036.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before a changed choice is closed away', async () => {
    stubApi({});
    const onClose = jest.fn();
    await render(null, onClose);
    await fireEvent.press(screen.getByTestId(`GAR-02.goalSheet.season.${YEAR + 1}`));
    await fireEvent.press(screen.getByTestId('GAR-02.goalSheet.scrim'));
    expect(await screen.findByTestId('GAR-02.goalSheet.discard')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('GAR-02.goalSheet.discard.confirm'));
    expect(onClose).toHaveBeenCalled();
  });
});
