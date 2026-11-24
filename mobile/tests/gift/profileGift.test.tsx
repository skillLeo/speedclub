/** M5.9d PROF-01/02: the level line and sheet, the founding line and the badge row (contract §1, §2, §4, §8). */
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { foundingNumberOf, nextStep, parseLadder, parseMyLevel, publicLevelOf } from '@/api/queries/level';
import { orderBadges, parseBadges, publicBadges } from '@/api/queries/badges';
import { BadgeSheet } from '@/features/gift/components/BadgeSheet';
import { badgesToEarn, visibleXpRules } from '@/features/gift/components/LevelSheet';
import { BadgeRowView, FoundingLine, LevelLine } from '@/features/gift/components/ProfileGift';
import { hydrateThemePreference } from '@/theme';

import { BADGES, renderScreen, signIn, stubApi } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}), usePathname: () => '/profile' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const LEVEL = { level: 4, title: 'Parts Hunter', xp: 1240, next_level_xp: 1600, progress: 0.6, today: { earned: 40, cap: 200 } };
const LADDER = [0, 100, 250, 500, 1600, 2000, 2400, 3600, 5200, 7500].map((from, index) => ({
  level: index + 1,
  title: ['Street Rookie', 'Garage Regular', 'Wrench Apprentice', 'Parts Hunter', 'Build Crafter', 'Familiar Face', 'Detail Master', 'Scene Veteran', 'Garage Legend', 'Kaido Legend'][index],
  from_xp: from,
}));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
});

describe('level', () => {
  it('reads the quiet {level, title} of a profile resource, and nothing invented', () => {
    expect(publicLevelOf({ level: { level: 4, title: 'Parts Hunter' } })).toEqual({ level: 4, title: 'Parts Hunter' });
    expect(publicLevelOf({ level: { level: 4, title: ' ' } })).toBeNull();
    expect(publicLevelOf({})).toBeNull();
    expect(parseMyLevel({ ...LEVEL, progress: 3 })?.progress).toBe(1);
    expect(parseMyLevel({ level: 10, title: 'Kaido Legend', xp: 9000, next_level_xp: null })).toMatchObject({ next_level_xp: null, progress: 1 });
  });

  it('shows "Lvl 6 · Familiar Face" beside another member\'s name as a button into their place on the ladder (CR2-4)', async () => {
    stubApi({ 'GET /me/level': { body: { data: { ...LEVEL, ladder: LADDER } } } });
    await renderScreen(<LevelLine level={{ level: 6, title: 'Familiar Face' }} own={false} routeId="PROF-02" name="@kenji" />);
    const line = screen.getByRole('button', { name: 'Lvl 6 · Familiar Face. Zeigt, was die Level bedeuten' });
    expect(line).toBe(screen.getByTestId('PROF-02.level'));
    expect(line).toHaveTextContent('Lvl 6 · Familiar Face');
    await fireEvent.press(line);
    const ladder = await screen.findByTestId('PROF-02.levelSheet.ladder');
    expect(within(ladder).getByTestId('PROF-02.levelSheet.ladder.6')).toHaveTextContent('Lvl 6 · Familiar FaceHier steht @kenjiab 2.000 XP');
    // Another member's XP are theirs: no "to go" line, no ring, no today line.
    expect(screen.queryByTestId('PROF-02.levelSheet.ladder.left')).toBeNull();
    expect(screen.queryByTestId('PROF-02.levelSheet.today')).toBeNull();
    expect(screen.getByTestId('PROF-02.levelSheet.never')).toBeTruthy();
  });

  it('R4DQ-45: tabular figures on the level number only, so a title\'s hyphen keeps its own width ("Schrauber-Azubi")', async () => {
    stubApi({});
    await renderScreen(<LevelLine level={{ level: 3, title: 'Schrauber-Azubi' }} own={false} routeId="PROF-02" name="@kai" />);
    const tabular = (style: unknown) => (StyleSheet.flatten(style as TextStyle)?.fontVariant ?? []).includes('tabular-nums');
    const line = screen.getByTestId('PROF-02.level.text');
    expect(line).toHaveTextContent('Lvl 3 · Schrauber-Azubi');
    expect(tabular(line.props.style)).toBe(false);
    const number = screen.getByTestId('PROF-02.level.number');
    expect(number).toHaveTextContent('3');
    expect(tabular(number.props.style)).toBe(true);
  });

  it('reads the ladder tolerantly: valid rungs only, one per level, ascending', () => {
    const ladder = parseLadder([{ level: 2, title: 'Garage Regular', from_xp: 100 }, { level: 1, title: 'Street Rookie', from_xp: 0 }, { level: 2, title: 'x', from_xp: 1 }, { level: 3, title: '', from_xp: 250 }, 'x']);
    expect(ladder).toEqual([
      { level: 1, title: 'Street Rookie', from_xp: 0 },
      { level: 2, title: 'Garage Regular', from_xp: 100 },
    ]);
    expect(nextStep(ladder, 1)?.title).toBe('Garage Regular');
    expect(nextStep(ladder, 2)).toBeNull();
    // A server before the ladder: empty, the sheet keeps its old lines.
    expect(parseMyLevel(LEVEL)?.ladder).toEqual([]);
  });

  it('shows the next level by name, the ladder with "Du bist hier", and the badges still to earn (CR2-4)', async () => {
    stubApi({ 'GET /me/level': { body: { data: { ...LEVEL, ladder: LADDER } } }, 'GET /me/badges': { body: { data: BADGES } } });
    await renderScreen(<LevelLine level={{ level: 4, title: 'Parts Hunter' }} own routeId="PROF-01" />);
    await fireEvent.press(screen.getByTestId('PROF-01.level'));
    expect(await screen.findByTestId('PROF-01.levelSheet.toNext')).toHaveTextContent('Noch 360 XP bis Lvl 5 · Build Crafter');
    expect(screen.getByTestId('PROF-01.levelSheet.ladder.4')).toHaveTextContent('Lvl 4 · Parts HunterDu bist hierab 500 XP');
    expect(screen.getByTestId('PROF-01.levelSheet.ladder.5')).toHaveTextContent('Lvl 5 · Build CrafterNoch 360 XPab 1.600 XP');
    expect(screen.getByTestId('PROF-01.levelSheet.ladder.10')).toHaveTextContent('Lvl 10 · Kaido Legendab 7.500 XP');
    expect(screen.getByTestId('PROF-01.levelSheet.ladderNote')).toHaveTextContent('Jedes Level bringt einen neuen Titel. Alle Funktionen hast du vom ersten Tag an.');
    const badges = await screen.findByTestId('PROF-01.levelSheet.badges');
    expect(within(badges).getByTestId('PROF-01.levelSheet.badge.street_famous_10')).toHaveTextContent('Street FamousZehn Leute haben dein Auto gespottet.');
    expect(within(badges).getByTestId('PROF-01.levelSheet.badge.hidden_night')).toHaveTextContent('???Hat etwas mit deinem Sticker zu tun.');
    expect(within(badges).queryByTestId('PROF-01.levelSheet.badge.founding_member')).toBeNull();
    await fireEvent.press(screen.getByTestId('PROF-01.levelSheet.badgesAll'));
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/badges');
  });

  it('names at most three badges still to earn, visible ones first', () => {
    const many = parseBadges({ data: [...BADGES, { ...BADGES[2], key: 'a', sort: 9 }, { ...BADGES[2], key: 'b', sort: 10 }] });
    expect(badgesToEarn(many).map((badge) => badge.key)).toEqual(['street_famous_10', 'a', 'b']);
    expect(badgesToEarn(undefined)).toEqual([]);
  });

  it('opens the sheet on the own profile: ring, XP, today against the cap and the fixed rules', async () => {
    stubApi({ 'GET /me/level': { body: { data: LEVEL } } });
    await renderScreen(<LevelLine level={{ level: 4, title: 'Parts Hunter' }} own routeId="PROF-01" />);
    // WCAG 2.5.3: the button's name starts with the line it shows, then says what it does.
    expect(screen.getByRole('button', { name: 'Lvl 4 · Parts Hunter. Zeigt, was als Nächstes kommt und wie du XP sammelst' })).toBe(screen.getByTestId('PROF-01.level'));
    await fireEvent.press(screen.getByTestId('PROF-01.level'));
    const sheet = await screen.findByTestId('PROF-01.levelSheet.hero');
    expect(within(sheet).getByTestId('PROF-01.levelSheet.xp')).toHaveTextContent('1.240 / 1.600 XP');
    expect(within(sheet).getByTestId('PROF-01.levelSheet.toNext')).toHaveTextContent('Noch 360 XP bis Lvl 5');
    expect(screen.getByTestId('PROF-01.levelSheet.today')).toHaveTextContent('Heute: 40 von 200 XPMehr als 200 XP am Tag gibt es nicht.');
    expect(screen.getByLabelText('Level 4, 60 Prozent auf dem Weg zu Level 5')).toBeTruthy();
    expect(screen.getByTestId('PROF-01.levelSheet.rule.documented_mod')).toHaveTextContent('Einen Mod mit Marke, Foto und Datum dokumentieren+20 XP');
    expect(screen.getByTestId('PROF-01.levelSheet.never')).toHaveTextContent('Für Likes, Reaktionen, viele Beiträge oder das Anmelden gibt es keine XP.');
    // Forum and check-in rules wait for their features (09 §7.15): no promise for something the app does not run yet.
    expect(screen.queryByTestId('PROF-01.levelSheet.rule.forum_solution')).toBeNull();
    expect(screen.queryByTestId('PROF-01.levelSheet.rule.event_checkin')).toBeNull();
  });

  it('takes the server\'s rules when it sends them, else the defaults whose feature is on', () => {
    expect(visibleXpRules({ rules: [{ type: 'build_update', points: 15, daily_max: null }] }, {}).map((rule) => rule.type)).toEqual(['build_update']);
    expect(visibleXpRules(undefined, { forum: true }).map((rule) => rule.type)).toContain('helpful_received');
    expect(visibleXpRules(undefined, {}).map((rule) => rule.type)).not.toContain('helpful_received');
  });

  it('shows the error state with retry when the level cannot be read', async () => {
    stubApi({ 'GET /me/level': { status: 403, body: { message: 'Nicht erlaubt', code: 'forbidden', errors: {} } } });
    await renderScreen(<LevelLine level={{ level: 4, title: 'Parts Hunter' }} own routeId="PROF-01" />);
    await fireEvent.press(screen.getByTestId('PROF-01.level'));
    expect(await screen.findByTestId('PROF-01.levelSheet.error')).toBeTruthy();
  });
});

describe('founding line', () => {
  it('prints "Founding Member #0042" in four tabular digits, only for 1–1000', async () => {
    expect(foundingNumberOf({ founding_number: 42 })).toBe(42);
    expect(foundingNumberOf({ founding_number: 1001 })).toBeNull();
    expect(foundingNumberOf({ founding_number: null })).toBeNull();
    await renderScreen(<FoundingLine number={42} routeId="PROF-01" />);
    expect(screen.getByTestId('PROF-01.founding')).toHaveTextContent('Founding Member #0042');
  });
});

describe('badge row', () => {
  const badges = parseBadges({ data: BADGES });

  it('reads tiers and hides the name of an unearned hidden badge', () => {
    expect(badges.find((badge) => badge.key === 'founding_member')?.tier).toBe(3);
    const hidden = badges.find((badge) => badge.key === 'hidden_night');
    expect(hidden).toMatchObject({ hidden: true, name: null, hint: 'Hat etwas mit deinem Sticker zu tun.' });
    expect(orderBadges(badges).map((badge) => badge.key)).toEqual(['crew_starter', 'founding_member', 'street_famous_10', 'hidden_night']);
    expect(publicBadges(badges).map((badge) => badge.key)).toEqual(['crew_starter', 'founding_member']);
  });

  it('own profile: only the earned badges, with the count and the way to the rest (DQ-P5G-26)', async () => {
    await renderScreen(<BadgeRowView badges={badges} own username="lukas.sc" routeId="PROF-01" />);
    expect(screen.getByTestId('PROF-01.badges.count')).toHaveTextContent('2 von 4');
    expect(screen.getByTestId('PROF-01.badge.crew_starter')).toBeTruthy();
    expect(screen.getByTestId('PROF-01.badge.founding_member')).toBeTruthy();
    expect(screen.queryByTestId('PROF-01.badge.hidden_night')).toBeNull();
    expect(screen.queryByTestId('PROF-01.badge.street_famous_10')).toBeNull();
    await fireEvent.press(screen.getByTestId('PROF-01.badges.all'));
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/badges');
  });

  it.each([
    ['with earned badges', () => badges],
    ['without an earned badge', () => badges.filter((badge) => !badge.earned_at)],
  ])('the row is a list of list items only, "Alle" the last one, %s (axe aria-required-children)', async (_case, shown) => {
    await renderScreen(<BadgeRowView badges={shown()} own username="lukas.sc" routeId="PROF-01" />);
    const list = screen.getByTestId('PROF-01.badges.list');
    expect(list).toHaveProp('role', 'list');
    const items = list.children.filter((child) => typeof child !== 'string');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).toHaveProp('role', 'listitem');
    expect(within(items[items.length - 1] as never).getByTestId('PROF-01.badges.all')).toBeTruthy();
  });

  it('another member: earned badges only, never a hidden one or one still to earn', async () => {
    await renderScreen(<BadgeRowView badges={badges} own={false} username="jonas.ek9" routeId="PROF-02" />);
    expect(screen.getByTestId('PROF-02.badge.founding_member')).toBeTruthy();
    expect(screen.queryByTestId('PROF-02.badge.hidden_night')).toBeNull();
    expect(screen.queryByTestId('PROF-02.badge.street_famous_10')).toBeNull();
    expect(screen.queryByTestId('PROF-02.badges.count')).toBeNull();
    await fireEvent.press(screen.getByTestId('PROF-02.badges.all'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/u/[username]/badges', params: { username: 'jonas.ek9' } });
  });

  it('opens the detail sheet: name, tier and category, description, earned date', async () => {
    await renderScreen(<BadgeRowView badges={badges} own username="lukas.sc" routeId="PROF-01" />);
    await fireEvent.press(screen.getByTestId('PROF-01.badge.founding_member'));
    await waitFor(() => expect(screen.getByTestId('PROF-01.badgeSheet.earned')).toHaveTextContent('Erhalten am 2. Oktober 2026'));
    expect(screen.getByText('Gold')).toBeTruthy();
    expect(screen.getByTestId('PROF-01.badgeSheet.description')).toHaveTextContent('Eines der ersten 1.000 Konten.');
  });

  it('a hidden badge shows only its hint', async () => {
    const hidden = badges.find((badge) => badge.key === 'hidden_night') ?? null;
    await renderScreen(<BadgeSheet badge={hidden} onClose={() => undefined} testID="BDG-01.badgeSheet" />);
    expect(await screen.findByTestId('BDG-01.badgeSheet.hint')).toHaveTextContent('Hinweis: Hat etwas mit deinem Sticker zu tun.');
    expect(screen.getByTestId('BDG-01.badgeSheet.earned')).toHaveTextContent('Noch nicht erhalten');
  });

  it('shows no row on another profile without earned badges', async () => {
    await renderScreen(<BadgeRowView badges={badges.filter((badge) => !badge.earned_at)} own={false} username="jonas.ek9" routeId="PROF-02" />);
    expect(screen.queryByTestId('PROF-02.badges')).toBeNull();
  });
});
