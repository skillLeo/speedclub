import { latestReleased, parseMyWrapped, parseSeasonKey, parseWrappedCard, parseWrappedPayload } from '@/api/queries/wrapped';
import { countdownDays, initialCardIndex, showsCountdown, STORY_CARD_MS, storyFrame } from '@/features/wrapped/model';

import { rawCards, rawPayload } from './helpers';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

describe('Season Wrapped model', () => {
  it('reads season keys and nothing else', () => {
    expect(parseSeasonKey('2027-saison')).toEqual({ year: 2027, kind: 'saison' });
    expect(parseSeasonKey('2027-jahr')).toEqual({ year: 2027, kind: 'jahr' });
    expect(parseSeasonKey('2027')).toBeNull();
    expect(parseSeasonKey('../me')).toBeNull();
    expect(parseSeasonKey(undefined)).toBeNull();
  });

  it('parses all nine cards in order, with their payload positions', () => {
    const payload = parseWrappedPayload(rawPayload());
    expect(payload?.cards.map((entry) => entry.card.kind)).toEqual(['intro', 'spots', 'scans', 'score', 'top_mod', 'treffen', 'build_spirit', 'percentile', 'share']);
    expect(payload?.cards.map((entry) => entry.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const topMod = payload?.cards[4]?.card;
    // The variant that fills 1080 pixels, with blurhash and focal point.
    expect(topMod?.kind === 'top_mod' ? topMod.after_media : null).toEqual({ source: 'https://speedclub.test/media/after-1280.jpg', blurhash: 'LoGlekxvjYof_Nt7ayj]M{j@ofWB', thumbhash: null, focal: { x: 0.5, y: 0.6 } });
  });

  it('never keeps a card that would say 0, nor an unknown one; the share card always closes', () => {
    const cards = rawCards();
    const share = cards.pop() as Record<string, unknown>;
    const payload = parseWrappedPayload(
      rawPayload([
        share,
        ...cards,
        { kind: 'spots', count: 0, unique_cars: 0, cities: [] },
        { kind: 'treffen', attended: 0, names: [] },
        { kind: 'scans', sticker_scans: 0, profile_or_vehicle_views: 0, top_city: null },
        { kind: 'speed_board', value: 280 },
      ]),
    );
    expect(payload?.cards.map((entry) => entry.card.kind)).toEqual(['intro', 'spots', 'scans', 'score', 'top_mod', 'treffen', 'build_spirit', 'percentile', 'share']);
    expect(payload?.cards[payload.cards.length - 1]?.n).toBe(1);
    expect(parseWrappedCard({ kind: 'spots', count: 0 })).toBeNull();
    expect(parseWrappedCard({ kind: 'treffen', attended: 0 })).toBeNull();
    expect(parseWrappedCard({ kind: 'scans', sticker_scans: 0, profile_or_vehicle_views: null })).toBeNull();
    expect(parseWrappedCard({ kind: 'percentile', bundesland: 'NRW' })).toBeNull();
    expect(parseWrappedPayload({ data: { season_key: '2027-saison', cards: [] } })).toBeNull();
  });

  it('reads the list and the countdown, and finds the newest released season', () => {
    const list = parseMyWrapped({
      data: [
        { season_key: '2027-saison', released: true, generated_at: null, viewed_at: null },
        { season_key: '2027-jahr', released: false, generated_at: null, viewed_at: null },
        { season_key: 'nonsense', released: true },
      ],
      meta: { countdown: { season_key: '2027-jahr', release_at: '2027-12-20T10:00:00+01:00' } },
    });
    expect(list.seasons).toHaveLength(2);
    expect(list.countdown).toEqual({ season_key: '2027-jahr', release_at: '2027-12-20T10:00:00+01:00' });
    expect(latestReleased(list.seasons)?.season_key).toBe('2027-saison');
    expect(latestReleased([...list.seasons, { season_key: '2028-saison', released: true, generated_at: null, viewed_at: null }])?.season_key).toBe('2028-saison');
    expect(parseMyWrapped({}).seasons).toEqual([]);
  });

  it('lays the card out at 9:16 in the room it gets', () => {
    expect(storyFrame(393, 900)).toEqual({ width: 393, height: 698 });
    expect(storyFrame(1000, 800)).toEqual({ width: 450, height: 800 });
    expect(storyFrame(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it('opens a link on its card, clamped', () => {
    expect(initialCardIndex(undefined, 9)).toBe(0);
    expect(initialCardIndex('4', 9)).toBe(3);
    expect(initialCardIndex(['12'], 9)).toBe(8);
    expect(initialCardIndex('x', 9)).toBe(0);
    expect(STORY_CARD_MS).toBe(6000);
  });

  it('shows the countdown only in the last 7 days and until dismissed', () => {
    const now = new Date(2027, 9, 28, 12, 0);
    const countdown = { season_key: '2027-saison', release_at: new Date(2027, 10, 1, 10, 0).toISOString() };
    expect(countdownDays(countdown.release_at, now)).toBe(4);
    expect(showsCountdown(countdown, now, new Set())).toBe(true);
    expect(showsCountdown(countdown, now, new Set(['2027-saison']))).toBe(false);
    expect(showsCountdown(countdown, new Date(2027, 9, 20), new Set())).toBe(false);
    expect(showsCountdown(countdown, new Date(2027, 10, 2), new Set())).toBe(false);
    expect(showsCountdown(null, now, new Set())).toBe(false);
  });
});
