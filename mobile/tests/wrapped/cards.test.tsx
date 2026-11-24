import { screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { WrappedCardView } from '@/features/wrapped/components/cards';
import { QA_QR_SVG, QA_SEASON, qaWrappedPayload } from '@/features/wrapped/qaWrapped';
import { parseWrappedPayload, type PlacedCard, type WrappedPayload } from '@/api/queries/wrapped';
import { hydrateThemePreference } from '@/theme';

import { rawCards, rawPayload, renderScreen, signIn } from './helpers';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

async function card(payload: WrappedPayload, kind: string) {
  const placed = payload.cards.find((entry) => entry.card.kind === kind) as PlacedCard;
  await renderScreen(<WrappedCardView placed={placed} payload={payload} qrSvg={QA_QR_SVG} width={360} height={640} testID="t" />);
}

beforeAll(hydrateThemePreference);
beforeEach(signIn);

describe('Wrapped cards with the bundled sample', () => {
  const sample = () => qaWrappedPayload();

  it('has all nine cards, every one badged "Beispiel"', async () => {
    const payload = sample();
    expect(payload.cards.map((entry) => entry.card.kind)).toEqual(['intro', 'spots', 'scans', 'score', 'top_mod', 'treffen', 'build_spirit', 'percentile', 'share']);
    for (const entry of payload.cards) {
      await renderScreen(<WrappedCardView placed={entry} payload={payload} qrSvg={QA_QR_SVG} width={360} height={640} testID="t" />);
      expect(screen.getByTestId(`t.${entry.card.kind}.sample`)).toBeTruthy();
    }
  });

  it('marks every card root as a 9:16 story card for the DOM audit (ADR-518 c)', async () => {
    const payload = sample();
    for (const entry of payload.cards) {
      await renderScreen(<WrappedCardView placed={entry} payload={payload} qrSvg={QA_QR_SVG} width={360} height={640} testID="t" />);
      const root = screen.getByTestId(`t.${entry.card.kind}`);
      expect(root.props.dataSet).toEqual({ qaExempt: 'story-card' });
      const box: ViewStyle = StyleSheet.flatten(root.props.style as ViewStyle) ?? {};
      expect(Number(box.width) / Number(box.height)).toBeCloseTo(9 / 16, 2);
    }
  });

  it('is the one 2026 season everywhere (DQ-P5G-29)', () => {
    const payload = sample();
    expect(QA_SEASON).toBe('2026-saison');
    expect(payload.season_key).toBe('2026-saison');
    expect(payload.window).toEqual({ from: '2026-03-01', to: '2026-10-31' });
  });

  it('intro: the brush logo, the own car, the title, the window and whose season', async () => {
    await card(sample(), 'intro');
    expect(screen.getByTestId('t.intro.wordmark')).toBeTruthy();
    // ADR-516 a: the member's own car on the intro.
    expect(screen.getByTestId('t.intro.photo', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Deine Saison 2026')).toBeTruthy();
    expect(screen.getByTestId('t.intro.window')).toBeTruthy();
    expect(screen.getByText('Die Saison von Lukas')).toBeTruthy();
  });

  it('spots: the count, the cities as a sentence, the rarest find with its number and frame', async () => {
    await card(sample(), 'spots');
    expect(screen.getByText('47')).toBeTruthy();
    expect(screen.getByText('31 verschiedene Autos')).toBeTruthy();
    expect(screen.getByText('Unterwegs in Düsseldorf, Köln, Essen, Duisburg und Neuss.')).toBeTruthy();
    expect(screen.getByTestId('t.spots.rarest.legend')).toBeTruthy();
    expect(screen.getByText('Nr.\u00a00412')).toBeTruthy();
    expect(screen.getByText('Legend')).toBeTruthy();
  });

  it('scans: the sticker scans, the views and the top city', async () => {
    await card(sample(), 'scans');
    expect(screen.getByText('128')).toBeTruthy();
    expect(screen.getByText('1.940')).toBeTruthy();
    expect(screen.getByText('Die meisten Scans kamen aus Düsseldorf.')).toBeTruthy();
  });

  it('score: the car photo, the gauge at rest, the range and the stage change', async () => {
    await card(sample(), 'score');
    expect(screen.getByTestId('t.score.photo', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('t.score.gauge', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Von 412 auf 642 Punkte in dieser Saison.')).toBeTruthy();
    expect(screen.getByText('Aufgestiegen von Stufe 3 auf Stufe 4')).toBeTruthy();
  });

  it('top mod: brand and name, the car, the "Nachher" photo alone (no same-angle pair in the sample, DQ-P5G-31)', async () => {
    await card(sample(), 'top_mod');
    expect(screen.getByText('Work Meister S1 3P')).toBeTruthy();
    expect(screen.getByText('An deinem Nissan Skyline GT-R R34')).toBeTruthy();
    expect(screen.queryByTestId('t.top_mod.pair')).toBeNull();
    expect(screen.getByText('Nachher', { includeHiddenElements: true })).toBeTruthy();
  });

  it('top mod: a before/after pair from the server stays a pair', async () => {
    await card(parseWrappedPayload(rawPayload()) as WrappedPayload, 'top_mod');
    expect(screen.getByTestId('t.top_mod.pair', { includeHiddenElements: true })).toBeTruthy();
  });

  it('treffen, Build Spirit and percentile speak in words, never speed', async () => {
    await card(sample(), 'treffen');
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('Cars & Coffee Düsseldorf')).toBeTruthy();
    await card(sample(), 'build_spirit');
    expect(screen.getByTestId('t.build_spirit.photo', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Shakotan Artist')).toBeTruthy();
    expect(screen.getByText('Ermittelt nach festen Regeln aus deinen dokumentierten Mods.')).toBeTruthy();
    await card(sample(), 'percentile');
    expect(screen.getByText('Top 12 %')).toBeTruthy();
    expect(screen.getByText('Build Score in NRW')).toBeTruthy();
  });

  it('share: the car, its Dex number, score and stage, the QR and the short address', async () => {
    await card(sample(), 'share');
    expect(screen.getByTestId('t.share.wordmark')).toBeTruthy();
    expect(screen.getByText('Nr.\u00a00034')).toBeTruthy();
    expect(screen.getByText('Build Score 642 · Stufe 4')).toBeTruthy();
    expect(screen.getByLabelText('QR-Code zur Seite von Nissan Skyline GT-R R34')).toBeTruthy();
    // ADR-514: the shared card shows the car's page, never the sticker code; the sample's on the production host (DQ-P5G-45).
    expect(screen.getByText('joinspeedclub.com/v/nissan-skyline-gt-r-r34-5tf974vj')).toBeTruthy();
    // DQ-P5G-04: the QR is pinned to the card's foot, never inside the part that may scroll.
    expect(within(screen.getByTestId('t.share.body')).queryByTestId('t.share.qr')).toBeNull();
  });

  it('share without a code: no QR, the card stays whole', async () => {
    const payload = parseWrappedPayload(rawPayload(rawCards().map((raw) => (raw.kind === 'share' ? { ...raw, qr_url: null } : raw)))) as WrappedPayload;
    const placed = payload.cards.find((entry) => entry.card.kind === 'share') as PlacedCard;
    await renderScreen(<WrappedCardView placed={placed} payload={payload} qrSvg={null} width={360} height={640} testID="t" />);
    expect(screen.queryByTestId('t.share.qr')).toBeNull();
    expect(screen.queryByTestId('t.share.sample')).toBeNull();
    expect(screen.getByText('Nr.\u00a00034')).toBeTruthy();
  });

  it('ADR-516 a: intro, score and Build Spirit without a server photo stay typographic, with one they show it', async () => {
    const plain = parseWrappedPayload(rawPayload()) as WrappedPayload;
    for (const kind of ['intro', 'score', 'build_spirit'] as const) {
      await card(plain, kind);
      expect(screen.queryByTestId(`t.${kind}.photo`, { includeHiddenElements: true })).toBeNull();
    }
    const cover = rawCards().find((raw) => raw.kind === 'share')?.image;
    const withPhotos = parseWrappedPayload(
      rawPayload(rawCards().map((raw) => (raw.kind === 'intro' || raw.kind === 'score' || raw.kind === 'build_spirit' ? { ...raw, image: cover } : raw))),
    ) as WrappedPayload;
    for (const kind of ['intro', 'score', 'build_spirit'] as const) {
      const entry = withPhotos.cards.find((placed) => placed.card.kind === kind);
      expect(entry?.card.kind === kind && 'image' in entry.card ? entry.card.image?.source : null).toBe('https://speedclub.test/media/cover-1280.jpg');
      await card(withPhotos, kind);
      expect(screen.getByTestId(`t.${kind}.photo`, { includeHiddenElements: true })).toBeTruthy();
    }
  });

  it('spots and Treffen never carry a photo (other members\' cars and covers)', async () => {
    await card(sample(), 'spots');
    expect(screen.queryByTestId('t.spots.photo', { includeHiddenElements: true })).toBeNull();
    await card(sample(), 'treffen');
    expect(screen.queryByTestId('t.treffen.photo', { includeHiddenElements: true })).toBeNull();
  });

  it('a top mod with one photo shows it alone', async () => {
    const payload = parseWrappedPayload(rawPayload(rawCards().map((raw) => (raw.kind === 'top_mod' ? { ...raw, before_media: null } : raw)))) as WrappedPayload;
    await card(payload, 'top_mod');
    expect(screen.queryByTestId('t.top_mod.pair')).toBeNull();
    expect(screen.getByTestId('t.top_mod.photo', { includeHiddenElements: true })).toBeTruthy();
  });
});
