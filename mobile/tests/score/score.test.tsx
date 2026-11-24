/** M5.9c Build Journey + Build Score, app part (contract docs/reports/phase-5/m5.9c-contract.md §1, §2, §4, §5). */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { parseBuildScore, vehicleBuildScoreOf, type BuildScore, type NextUpgrade } from '@/api/queries/buildScore';
import type { BuildUpdate } from '@/api/queries/vehicles';
import { BuildScoreCompact } from '@/features/score/components/BuildScoreCompact';
import { BuildScoreSection, detailsLayout, gaugeBoxFor } from '@/features/score/components/BuildScoreSection';
import { latestPair } from '@/features/score/components/JourneyCard';
import { journeyPair } from '@/features/score/journey';
import { beforeAfterIssues, isRegistered, rankLines, updateKindOf, upgradeHref, upgradeItems } from '@/features/score/model';
import { useLegalPill } from '@/features/vehicle/legal';
import i18n from '@/i18n';
import * as hapticsModule from '@/lib/haptics';
import { parseQa } from '@/lib/qa';
import { hydrateThemePreference } from '@/theme';
import { BuildScoreGauge } from '@/ui/BuildScoreGauge';
import { angleForFraction, arcLength, dashOffset, gaugeHeight, scoreAngle, scoreDelta, stageOf } from '@/ui/buildScoreGaugeMath';
import { __resetOdometerSessionForTests } from '@/ui/motion/OdometerNumber';
import { __setAccessibilityForTests } from '@/ui/motion';
import { Timeline } from '@/ui/Timeline';

import { renderUi } from '../ui/helpers';
import { R34 } from '../vehicle/fixtures';
import { renderWithProviders, stubFetch } from '../vehicle/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, router: mockRouter, useLocalSearchParams: () => ({}), usePathname: () => '/v/test' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const SCORE = {
  total: 642,
  stage: 4,
  parts: { completeness: { points: 220, max: 300 }, documentation: { points: 200, max: 300 }, community: { points: 132, max: 250 }, journey: { points: 90, max: 150 } },
  ranks: [
    { scope: 'generation', label: 'R34', rank: 4, group_size: 61, region: 'Deutschland' },
    { scope: 'bundesland', label: 'NRW', rank: 2, group_size: 14 },
  ],
  computed_at: '2026-11-14T08:30:00Z',
  previous_total: 617,
  formula_version: '1',
};
const UPGRADES: NextUpgrade[] = [
  { key: 'description', label_key: 'description', points: 50, progress: { have: 120, need: 200 } },
  { key: 'photos', label_key: 'photos', points: 80, progress: { have: 2, need: 6 } },
  { key: 'reactors', label_key: 'reactors', points: 40, progress: { have: 30, need: 50 } },
  { key: 'planned_mods', label_key: 'planned_mods', points: 25, progress: { have: 0, need: 1 } },
];

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  __resetOdometerSessionForTests();
  void i18n.changeLanguage('de');
});

describe('gauge geometry (ADR-508)', () => {
  it('turns the needle from −120° at 0 through 0° at 500 to +120° at 1000, clamped outside the scale', () => {
    expect(scoreAngle(0)).toBe(-120);
    expect(scoreAngle(500)).toBe(0);
    expect(scoreAngle(1000)).toBe(120);
    expect(scoreAngle(-20)).toBe(-120);
    expect(scoreAngle(1400)).toBe(120);
  });

  it('puts the stage boundaries at 200, 400, 600 and 800', () => {
    expect([0, 199, 200, 399, 400, 599, 600, 799, 800, 1000].map(stageOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('fills the arc through the dash offset and shows a rise only when the score went up', () => {
    const length = arcLength(100);
    expect(dashOffset(length, 0)).toBeCloseTo(length);
    expect(dashOffset(length, 1)).toBeCloseTo(0);
    expect(dashOffset(length, 1.2)).toBeCloseTo(0);
    expect(scoreDelta(617, 642)).toBe(25);
    expect(scoreDelta(642, 642)).toBeNull();
    expect(scoreDelta(700, 642)).toBeNull();
    expect(scoreDelta(null, 642)).toBeNull();
  });

  it('lays the box out down to the arc ends or the last line under the numeral, whichever is lower (R6-3: text may reach past the square)', () => {
    expect(gaugeHeight(264, 128, 4, 0)).toBe(200);
    expect(gaugeHeight(264, 128, 4, 222)).toBe(222);
    expect(gaugeHeight(120, 56, 4, 95)).toBe(95);
    expect(gaugeHeight(120, 56, 4, 130)).toBe(130);
  });

  it('centres the details under the gauge, start-aligned at a large font (R4DQ-10; R7-1: no more "beside")', () => {
    expect(detailsLayout(1)).toBe('centred');
    expect(detailsLayout(1.3)).toBe('centred');
    expect(detailsLayout(2)).toBe('start');
  });

  it('grows the box with the font scale up to the numerals’ cap (1.3×) and never past the column (R7-1: 144 on every width)', () => {
    expect(gaugeBoxFor(390, 1)).toBe(144);
    expect(gaugeBoxFor(390, 2)).toBe(187);
    expect(gaugeBoxFor(130, 2)).toBe(130);
    expect(gaugeBoxFor(1200, 1)).toBe(144);
  });
});

describe('BuildScoreGauge', () => {
  const gauge = (props: Partial<Parameters<typeof BuildScoreGauge>[0]> = {}) => (
    <BuildScoreGauge
      total={642}
      valueText="642"
      scaleText="von 1.000"
      stageText="Stufe 4"
      deltaText={(delta) => `+${delta}`}
      accessibilityLabel="Build Score 642 von 1.000, Stufe 4"
      box={264}
      testID="g"
      {...props}
    />
  );

  it('reads as one text for screen readers', async () => {
    await renderUi(gauge());
    expect(screen.getByTestId('g').props['aria-label']).toBe('Build Score 642 von 1.000, Stufe 4');
    expect(screen.getByTestId('g').props.role).toBe('img');
  });

  it('stands at its value under reduced motion, also on the first view', async () => {
    __setAccessibilityForTests({ reduceMotion: true });
    try {
      await renderUi(gauge({ first: true }));
      expect(screen.getByTestId('g.needle', { includeHiddenElements: true })).toHaveAnimatedStyle({ transform: [{ rotate: `${angleForFraction(0.642)}deg` }] });
    } finally {
      __setAccessibilityForTests({ reduceMotion: false });
    }
  });

  it('shows "+25" with one light haptic on the first view of a rise', async () => {
    const light = jest.spyOn(hapticsModule.haptics, 'light');
    await renderUi(gauge({ previousTotal: 617, first: true }));
    expect(within(screen.getByTestId('g.delta', { includeHiddenElements: true })).getByText('+25', { includeHiddenElements: true })).toBeTruthy();
    expect(light).toHaveBeenCalledTimes(1);
    light.mockRestore();
  });

  it('has no chip and no haptic without a rise, and no haptic after the first view', async () => {
    const light = jest.spyOn(hapticsModule.haptics, 'light');
    await renderUi(gauge({ previousTotal: 700, first: true }));
    expect(screen.queryByTestId('g.delta', { includeHiddenElements: true })).toBeNull();
    await screen.unmount();
    await renderUi(gauge({ previousTotal: 617, first: false }));
    expect(screen.getByTestId('g.delta', { includeHiddenElements: true })).toBeTruthy();
    expect(light).not.toHaveBeenCalled();
    light.mockRestore();
  });
});

describe('the model', () => {
  it('lists only actionable upgrades, most points first, with what is missing', () => {
    const items = upgradeItems(UPGRADES);
    expect(items.map((item) => item.key)).toEqual(['photos', 'description', 'planned_mods']);
    expect(items[0]?.missing).toBe(4);
  });

  it('links each upgrade to its editor', () => {
    expect(upgradeHref('photos', 'v1')).toBe('/garage/v1/photos');
    expect(upgradeHref('description', 'v1')).toBe('/garage/v1/basics');
    expect(upgradeHref('planned_mods', 'v1')).toBe('/garage/v1/mods');
    expect(upgradeHref('key_specs', 'v1')).toBe('/garage/v1/specs');
    expect(upgradeHref('before_after', 'v1')).toEqual({ pathname: '/post-update', params: { vehicleId: 'v1', kind: 'before_after' } });
  });

  it('shows only the rank groups that are there, generation first, never under 3 cars', () => {
    const score = parseBuildScore({ ...SCORE, ranks: [...SCORE.ranks].reverse() }) as BuildScore;
    expect(rankLines(score.ranks).map((rank) => rank.scope)).toEqual(['generation', 'bundesland']);
    const small = parseBuildScore({ ...SCORE, ranks: [{ scope: 'bundesland', label: 'HB', rank: 1, group_size: 2 }] }) as BuildScore;
    expect(rankLines(small.ranks)).toEqual([]);
    const one = parseBuildScore({ ...SCORE, ranks: [SCORE.ranks[1]] }) as BuildScore;
    expect(rankLines(one.ranks).map((rank) => rank.scope)).toEqual(['bundesland']);
  });

  it('treats "TÜV-eingetragen" as the owner statement is_registered, or a status meaning "in the papers"', () => {
    expect(isRegistered({ is_registered: true, legal_status: 'abe' })).toBe(true);
    expect(isRegistered({ is_registered: false, legal_status: 'registered' })).toBe(false);
    expect(isRegistered({ legal_status: 'individual_approval' })).toBe(true);
    expect(isRegistered({ legal_status: 'parts_certificate' })).toBe(false);
    expect(isRegistered({ legal_status: null })).toBe(false);
  });

  it('needs both photos for a before/after', () => {
    expect(beforeAfterIssues({ before: null, after: null })).toEqual(['beforeMissing', 'afterMissing']);
    expect(beforeAfterIssues({ before: { uri: 'a' }, after: null })).toEqual(['afterMissing']);
    expect(beforeAfterIssues({ before: { uri: 'a' }, after: { uri: 'b' } })).toEqual([]);
  });

  it('reads the garage card score and the qaScore override', () => {
    expect(vehicleBuildScoreOf({ build_score: { total: 642, stage: 4 } })).toEqual({ total: 642, stage: 4 });
    expect(vehicleBuildScoreOf({ build_score: null })).toBeNull();
    expect(parseQa('?qaScore=sample').score).toBe('sample');
    expect(parseQa('?qaScore=812').score).toBe(812);
    expect(parseQa('?qaScore=1200')).toEqual({});
  });
});

describe('VEH-01 Build Score section', () => {
  const answer = (extra: Record<string, unknown> = {}) => ({ body: { data: { ...SCORE, ...extra } } });

  it('shows the gauge, both rank lines and, for a visitor, no checklist', async () => {
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: answer() });
    await renderWithProviders(<BuildScoreSection vehicle={R34} routeId="VEH-01" />);
    expect(await screen.findByTestId('VEH-01.score.gauge')).toBeTruthy();
    expect(screen.getByTestId('VEH-01.score.gauge').props['aria-label']).toBe('Build Score 642 von 1.000, Stufe 4');
    expect(screen.getByTestId('VEH-01.score.rank.generation')).toHaveTextContent('#4 von 61 R34 in Deutschland');
    expect(screen.getByTestId('VEH-01.score.rank.bundesland')).toHaveTextContent('#2 in NRW');
    expect(screen.queryByTestId('VEH-01.score.next')).toBeNull();
    expect(screen.queryByTestId('VEH-01.score.journey')).toBeNull();
  });

  it('gives the owner "Nächstes Upgrade" sorted by points, each item opening its editor', async () => {
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: answer({ next_upgrades: UPGRADES, ranks: [] }) });
    await renderWithProviders(<BuildScoreSection vehicle={{ ...R34, is_owner: true }} routeId="VEH-01" />);
    const group = await screen.findByTestId('VEH-01.score.next');
    const rows = () => within(screen.getByTestId('VEH-01.score.next')).getAllByTestId(/^VEH-01\.score\.next\.(photos|description|planned_mods|reactors)$/).map((row) => row.props.testID);
    // DQ-M53-05: the two that add most, then "Alle Tipps (3)" opens the rest in place.
    expect(rows()).toEqual(['VEH-01.score.next.photos', 'VEH-01.score.next.description']);
    expect(within(group).getByTestId('VEH-01.score.next.toggle')).toHaveTextContent('Alle Tipps (3)');
    await act(async () => fireEvent.press(screen.getByTestId('VEH-01.score.next.toggle')));
    expect(rows()).toEqual(['VEH-01.score.next.photos', 'VEH-01.score.next.description', 'VEH-01.score.next.planned_mods']);
    expect(within(group).getByText('4 Fotos mehr')).toBeTruthy();
    expect(within(group).getByText('+80')).toBeTruthy();
    expect(within(group).getByText('Beschreibung ab 200 Zeichen')).toBeTruthy();
    expect(within(group).getByText('Geplante Mods dokumentieren')).toBeTruthy();
    expect(screen.queryByTestId('VEH-01.score.ranks')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('VEH-01.score.next.photos.body')));
    expect(mockRouter.push).toHaveBeenCalledWith(`/garage/${R34.id}/photos`);
    expect(screen.getByTestId('VEH-01.score.journey')).toBeTruthy();
  });

  it('says the score is being calculated while the server has none', async () => {
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: { body: { data: null } } });
    await renderWithProviders(<BuildScoreSection vehicle={{ ...R34, is_owner: true }} routeId="VEH-01" />);
    expect(await screen.findByText('Dein Build Score wird berechnet …')).toBeTruthy();
  });

  it('shows no section when the vehicle has no score for this viewer (404)', async () => {
    const { fetchMock } = stubFetch({});
    await renderWithProviders(<BuildScoreSection vehicle={R34} routeId="VEH-01" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('VEH-01.score')).toBeNull());
  });

  it('offers a retry after an error', async () => {
    let fail = true;
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: () => (fail ? { status: 500, body: { message: 'Fehler' } } : answer()) });
    await renderWithProviders(<BuildScoreSection vehicle={R34} routeId="VEH-01" />);
    const retry = await screen.findByTestId('VEH-01.score.retry', {}, { timeout: 4000 });
    fail = false;
    await act(async () => fireEvent.press(retry));
    expect(await screen.findByTestId('VEH-01.score.gauge')).toBeTruthy();
  });

  it('explains the formula in plain German, never for power, speed, sound or money', async () => {
    stubFetch({
      [`/vehicles/${R34.id}/build-score`]: answer(),
      '/build-score/formula': {
        body: {
          data: {
            max: 1000,
            stages: [{ stage: 1, min: 0 }, { stage: 2, min: 200 }, { stage: 3, min: 400 }, { stage: 4, min: 600 }, { stage: 5, min: 800 }],
            parts: [{ key: 'completeness', max: 300, items: [{ key: 'photos', points: 20, limit: 6, max: 120 }, { key: 'description', points: 50, limit: null, max: 50, min_chars: 200 }] }],
            formula_version: '1',
          },
        },
      },
    });
    await renderWithProviders(<BuildScoreSection vehicle={R34} routeId="VEH-01" />);
    await act(async () => fireEvent.press(await screen.findByTestId('VEH-01.score.how')));
    expect(await screen.findByTestId('VEH-01.score.formula.never')).toHaveTextContent('Nie Punkte für PS, Tempo, Sound oder Geld.');
    expect(screen.getByTestId('VEH-01.score.formula.item.photos')).toHaveTextContent(/20 pro Foto, für bis zu 6 Fotos/);
    expect(screen.getByTestId('VEH-01.score.formula.item.description')).toHaveTextContent(/50 für eine Beschreibung ab 200 Zeichen/);
    expect(screen.getByTestId('VEH-01.score.formula.stages')).toHaveTextContent(/800/);
  });
});

describe('GAR-01 compact score', () => {
  it('shows the number and the stage from the card', async () => {
    await renderUi(<BuildScoreCompact card={{ id: 'a', build_score: { total: 812, stage: 5 } } as { id: string }} testID="GAR-01.score.a" />);
    expect(screen.getByTestId('GAR-01.score.a.value')).toHaveTextContent('812');
    expect(screen.getByTestId('GAR-01.score.a.stage')).toHaveTextContent('Stufe 5');
    expect(screen.getByTestId('GAR-01.score.a').props['aria-label']).toBe('Build Score 812, Stufe 5');
  });

  it('says it is being calculated for null and shows nothing for an answer without the field', async () => {
    await renderUi(<BuildScoreCompact card={{ id: 'a', build_score: null } as { id: string }} testID="GAR-01.score.a" />);
    expect(screen.getByTestId('GAR-01.score.a.pending')).toBeTruthy();
    await screen.unmount();
    await renderUi(<BuildScoreCompact card={{ id: 'a' }} testID="GAR-01.score.a" />);
    expect(screen.queryByTestId('GAR-01.score.a')).toBeNull();
    expect(screen.queryByTestId('GAR-01.score.a.pending')).toBeNull();
  });
});

describe('Build Journey', () => {
  const photo = (id: string) => ({ ...R34.photos[0]!, id });
  const pairUpdate = { ...R34.updates[0]!, kind: 'before_after', photos: [photo('b'), photo('a')], photo_pairs: [{ before: 'b', after: 'a' }], modifications: [{ id: 'm', title: 'KW V3', category: null }] } as BuildUpdate;

  it('sets a before/after side by side in Verlauf, with its mod under the pair', async () => {
    const pair = { before: pairUpdate.photos[0]!, after: pairUpdate.photos[1]! };
    const entry = journeyPair(pairUpdate, pair, i18n.getFixedT('de', 'vehicle'), 320);
    expect(entry.layout).toBe('pair');
    expect(entry.caption).toBe('Vorher/Nachher: KW V3');
    await renderUi(<Timeline entries={[{ key: 'u', date: 'Juni 2026', title: 'Fahrwerk', beforeAfter: entry, testID: 'VEH-01.update.u' }]} />);
    expect(screen.getByTestId('VEH-01.update.u.beforeAfter.before')).toBeTruthy();
    expect(screen.getByTestId('VEH-01.update.u.beforeAfter.after')).toBeTruthy();
    expect(screen.getByTestId('VEH-01.update.u.beforeAfter.caption')).toHaveTextContent('Vorher/Nachher: KW V3');
  });

  it('picks the newest before/after post for the Journey card', () => {
    const plain = { ...R34.updates[0]!, id: 'plain', photos: [photo('x'), photo('y')], photo_pairs: [{ before: 'x', after: 'y' }] } as BuildUpdate;
    expect(updateKindOf(pairUpdate)).toBe('before_after');
    expect(latestPair([plain, pairUpdate])?.update.id).toBe(pairUpdate.id);
    expect(latestPair([plain])?.update.id).toBe('plain');
    expect(latestPair([])).toBeNull();
  });

  it('labels a TÜV-registered mod quietly as the owner statement', async () => {
    function Probe({ mod }: { mod: Parameters<ReturnType<typeof useLegalPill>>[0] }) {
      const pill = useLegalPill()(mod);
      return <RNText testID="pill">{`${pill.legalStatus ?? ''}|${pill.legalStatusLabel ?? ''}`}</RNText>;
    }
    await renderWithProviders(<Probe mod={{ legal_status: 'registered', legal_status_label: 'Eingetragen', is_registered: true }} />);
    expect(screen.getByTestId('pill')).toHaveTextContent('TÜV-eingetragen|TÜV-eingetragen, Angabe des Besitzers');
    await screen.unmount();
    await renderWithProviders(<Probe mod={{ legal_status: null, legal_status_label: null }} />);
    expect(screen.getByTestId('pill')).toHaveTextContent('|');
  });
});

describe('Journey card sharing', () => {
  it('shares the captured card on the phone and releases the file', async () => {
    jest.resetModules();
    const captureRef = jest.fn(async () => 'file:///tmp/card.png');
    const releaseCapture = jest.fn();
    const shareAsync = jest.fn(async () => undefined);
    jest.doMock('react-native-view-shot', () => ({ captureRef, releaseCapture }));
    jest.doMock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync }));
    const native = jest.requireActual<typeof import('@/features/score/journeyShare.native')>('@/features/score/journeyShare.native');
    const ref = { current: {} as never };
    await expect(native.shareJourneyCard(ref, 'Nissan Skyline GT-R R34')).resolves.toBe('shared');
    expect(captureRef).toHaveBeenCalledWith(ref, { format: 'png', result: 'tmpfile' });
    expect(shareAsync).toHaveBeenCalledWith('file:///tmp/card.png', expect.objectContaining({ mimeType: 'image/png' }));
    expect(releaseCapture).toHaveBeenCalledWith('file:///tmp/card.png');
    expect(native.canCaptureJourney).toBe(true);
    await expect(native.shareJourneyCard({ current: null }, 'x')).resolves.toBe('failed');
  });

  it('downloads the server card on the web, in the chosen format', async () => {
    jest.resetModules();
    const saveBlob = jest.fn();
    jest.doMock('@/features/qr/download', () => ({ saveBlob }));
    const GET = jest.fn(async () => ({ response: { ok: true }, data: new Blob(['png']) }));
    jest.doMock('@/api/client', () => ({ api: { GET } }));
    const web = jest.requireActual<typeof import('@/features/score/journeyShare')>('../../src/features/score/journeyShare.ts');
    expect(web.canCaptureJourney).toBe(false);
    await expect(web.downloadJourneyCard('v1', 'story')).resolves.toBe('saved');
    expect(GET).toHaveBeenCalledWith('/vehicles/{id}/share-card.png', expect.objectContaining({ params: { path: { id: 'v1' }, query: { format: 'story' } } }));
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'speedclub-v1-story.png');
    GET.mockImplementationOnce(async () => ({ response: { ok: false }, data: undefined as unknown as Blob }));
    await expect(web.downloadJourneyCard('v1', 'square')).resolves.toBe('failed');
  });
});

afterAll(() => waitFor(() => undefined));
