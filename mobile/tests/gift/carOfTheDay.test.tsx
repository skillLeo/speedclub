/** M5.9d Car of the Day (contract §3, §8): Start's lead, the sample badge, the owner's story editor, and the one-lead rule. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { carOfTheDayOf, ownsCarOfTheDay, type CarOfTheDay } from '@/api/queries/carOfTheDay';
import type { FeedVehicle } from '@/api/queries/home';
import { CarOfTheDayModule } from '@/features/gift/components/CarOfTheDayModule';
import { forYouRows } from '@/features/home/screens/HomeScreen';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, signIn, stubApi } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}), usePathname: () => '/' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

function vehicle(id: string, extra: Partial<FeedVehicle> = {}): FeedVehicle {
  return {
    id,
    public_id: id,
    slug: `slug-${id}`,
    status: 'published',
    visibility: 'public',
    is_main: true,
    eyebrow: null,
    make: 'Honda',
    model: 'Civic Type R',
    generation: 'EK9',
    title: 'Civic Type R EK9',
    full_title: 'Honda Civic Type R EK9',
    nickname: null,
    color: null,
    model_year: 1998,
    subline_parts: [],
    spec_strip: [{ key: 'power', value: '185', unit: 'PS', label: 'Leistung' }],
    cover: null,
    photo_count: 8,
    mod_count: 6,
    updates_count: 2,
    is_sample: false,
    published_at: null,
    updated_at: null,
    wizard: null,
    completeness: null,
    qr: null,
    owner: null,
    latest_update: null,
    viewer: null,
    ...extra,
  } as FeedVehicle;
}

const OWNER = { username: 'jonas.ek9', display_name: 'Jonas', city: 'Köln', avatar: null, is_sample: false, is_editorial: false };

function pick(extra: Partial<CarOfTheDay> = {}): CarOfTheDay {
  return { day: '2026-11-14', vehicle: vehicle('01ek9'), story_line: 'Seit 2019 in meiner Hand, jedes Teil selbst verbaut.', owner: OWNER, ...extra };
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
});

describe('Car of the Day data', () => {
  it('reads the module from GET home/modules, and nothing without a day or a car', () => {
    expect(carOfTheDayOf({ car_of_the_day: { day: '2026-11-14', vehicle: vehicle('01ek9'), story_line: ' ', owner: OWNER } })).toMatchObject({
      day: '2026-11-14',
      story_line: null,
      owner: { username: 'jonas.ek9' },
    });
    expect(carOfTheDayOf({ car_of_the_day: null })).toBeNull();
    expect(carOfTheDayOf({ car_of_the_day: { day: 'heute', vehicle: vehicle('01ek9') } })).toBeNull();
    expect(carOfTheDayOf({})).toBeNull();
    expect(ownsCarOfTheDay(pick(), 'jonas.ek9')).toBe(true);
    expect(ownsCarOfTheDay(pick(), 'lukas.sc')).toBe(false);
  });

  it('takes the lead in place of the curated hero: Start shows one lead, never two', () => {
    const hero = vehicle('01hero');
    const weekly = vehicle('01weekly');
    const rows = forYouRows({ hero, carOfTheDay: pick(), newBuilds: [hero], weekly, members: [], mods: [], stream: [] });
    expect(rows[0]).toMatchObject({ kind: 'cotd' });
    expect(rows.some((row) => row.kind === 'hero')).toBe(false);
    // The curated hero is not lost: it stays in "Neu in der Garage"; Build der Woche keeps its module slot further down.
    expect(rows.some((row) => row.kind === 'rail' && row.vehicles.some((item) => item.id === '01hero'))).toBe(true);
    expect(rows.some((row) => row.kind === 'weekly')).toBe(true);
    // Without a pick Start is as before.
    expect(forYouRows({ hero, newBuilds: [], members: [], mods: [], stream: [] })[0]).toMatchObject({ kind: 'hero' });
  });

  it('never repeats the car of the day as Build der Woche', () => {
    const rows = forYouRows({ hero: undefined, carOfTheDay: pick(), newBuilds: [], weekly: vehicle('01ek9'), members: [], mods: [], stream: [] });
    expect(rows.filter((row) => row.kind === 'weekly')).toHaveLength(0);
  });
});

describe('HOME-01 Car of the Day module', () => {
  it('shows the label with the day, the car, the owner and the story line in quotes', async () => {
    await renderScreen(<CarOfTheDayModule pick={pick()} width={390} own={false} onOpen={jest.fn()} testID="HOME-01.cotd" />);
    expect(screen.getByTestId('HOME-01.cotd.label')).toHaveTextContent('Car of the Day· 14. Nov.');
    expect(screen.getByLabelText('Car of the Day am 14. November 2026')).toBeTruthy();
    expect(screen.getByText('Honda Civic Type R EK9')).toBeTruthy();
    expect(screen.getByTestId('HOME-01.cotd.story')).toHaveTextContent('„Seit 2019 in meiner Hand, jedes Teil selbst verbaut.“');
    expect(screen.queryByTestId('HOME-01.cotd.edit')).toBeNull();
    expect(screen.queryByText('Beispiel')).toBeNull();
  });

  it('badges a sample car "Beispiel"', async () => {
    await renderScreen(<CarOfTheDayModule pick={pick({ vehicle: vehicle('01s', { is_sample: true }) })} width={390} own={false} onOpen={jest.fn()} testID="HOME-01.cotd" />);
    expect(screen.getByText('Beispiel')).toBeTruthy();
  });

  it('opens the build', async () => {
    const onOpen = jest.fn();
    await renderScreen(<CarOfTheDayModule pick={pick()} width={390} own={false} onOpen={onOpen} testID="HOME-01.cotd" />);
    await fireEvent.press(screen.getByTestId('HOME-01.cotd.card'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: '01ek9' }));
  });
});

describe('owner story editor', () => {
  it('is the owner\'s only, and saves a line with PATCH vehicles/{id}/car-of-the-day', async () => {
    const { calls } = stubApi({ 'PATCH /vehicles/01ek9/car-of-the-day': { body: { data: { story_line: 'Neu lackiert, alles original.' } } } });
    await renderScreen(<CarOfTheDayModule pick={pick({ story_line: null })} width={390} own onOpen={jest.fn()} testID="HOME-01.cotd" />);
    expect(screen.getByTestId('HOME-01.cotd.ownerNote')).toHaveTextContent('Dein Auto ist heute Car of the Day. Alle sehen es bis morgen 18 Uhr hier oben.');
    await fireEvent.press(screen.getByTestId('HOME-01.cotd.edit'));
    const input = await screen.findByTestId('HOME-01.cotd.editor.story');
    await fireEvent.changeText(input, 'Neu lackiert, alles original.');
    await fireEvent.press(screen.getByTestId('HOME-01.cotd.editor.save'));
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ story_line: 'Neu lackiert, alles original.' });
    expect(await screen.findByText('Story gespeichert')).toBeTruthy();
  });

  it('holds a line longer than 140 characters on the field and sends nothing', async () => {
    const { calls } = stubApi({});
    await renderScreen(<CarOfTheDayModule pick={pick()} width={390} own onOpen={jest.fn()} testID="HOME-01.cotd" />);
    await fireEvent.press(screen.getByTestId('HOME-01.cotd.edit'));
    await fireEvent.changeText(await screen.findByTestId('HOME-01.cotd.editor.story'), 'x'.repeat(141));
    await fireEvent.press(screen.getByTestId('HOME-01.cotd.editor.save'));
    expect(await screen.findByText('Höchstens 140 Zeichen.')).toBeTruthy();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('puts the server\'s 422 on the field (keyword rules)', async () => {
    stubApi({
      'PATCH /vehicles/01ek9/car-of-the-day': {
        status: 422,
        body: { message: 'Bitte formuliere die Story anders.', code: 'validation_failed', errors: { story_line: ['Bitte formuliere die Story anders.'] } },
      },
    });
    await renderScreen(<CarOfTheDayModule pick={pick()} width={390} own onOpen={jest.fn()} testID="HOME-01.cotd" />);
    await fireEvent.press(screen.getByTestId('HOME-01.cotd.edit'));
    await fireEvent.changeText(await screen.findByTestId('HOME-01.cotd.editor.story'), 'Eine andere Zeile.');
    await fireEvent.press(screen.getByTestId('HOME-01.cotd.editor.save'));
    expect(await screen.findByText('Bitte formuliere die Story anders.')).toBeTruthy();
  });

  it('asks before a changed line is closed away', async () => {
    stubApi({});
    await renderScreen(<CarOfTheDayModule pick={pick()} width={390} own onOpen={jest.fn()} testID="HOME-01.cotd" />);
    await fireEvent.press(screen.getByTestId('HOME-01.cotd.edit'));
    await fireEvent.changeText(await screen.findByTestId('HOME-01.cotd.editor.story'), 'Halb geschrieben');
    await fireEvent.press(screen.getByTestId('HOME-01.cotd.editor.scrim'));
    expect(await screen.findByText('Änderungen verwerfen?')).toBeTruthy();
  });
});
