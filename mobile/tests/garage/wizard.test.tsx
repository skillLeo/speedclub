/**
 * GAR-03 after the bug hunt: a draft without a name reaches Prüfen (BH-00), the review's visibility saves on change (BH-08), a
 * lost answer is recovered (BH-03/12), the limit is explained (BH-02/09), the year of a draft is checked (BH-05), leaving during
 * a save sticks (BH-14) and the wizard's mark never moves back (BH-18).
 */
import NetInfo from '@react-native-community/netinfo';
import { IsRestoringProvider, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Text } from 'react-native';

import { garageKeys } from '@/api/queries/garage';
import { myVehiclesKey } from '@/api/queries/profile';
import { WizardPhotosScreen } from '@/features/garage/screens/wizard/WizardPhotosScreen';
import { WizardReviewScreen } from '@/features/garage/screens/wizard/WizardReviewScreen';
import { WizardSpecsScreen } from '@/features/garage/screens/wizard/WizardSpecsScreen';
import { WizardVehicleScreen } from '@/features/garage/screens/wizard/WizardVehicleScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, ThemeProvider } from '@/theme';
import { dismissToast, useCurrentToast } from '@/ui/toast';

import { card, draftCard, vehicle } from './fixtures';
import { flushQueryNotifications, list, ME, newQueryClient, renderScreen, signIn, stubFetch, type Answer, type Call } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/add-vehicle',
  useNavigation: () => ({ getParent: () => undefined, canGoBack: () => true, goBack: jest.fn(), getState: () => undefined }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  usePreventRemove: jest.fn(),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => {
  let next = 0;
  return {
    randomUUID: jest.fn(() => {
      next += 1;
      return `uuid-${next}`;
    }),
  };
});
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

jest.setTimeout(60_000);
configure({ asyncUtilTimeout: 15_000 });

const DRAFT_ID = '01new';
const MAKES = list([{ id: 34, name: 'Nissan', slug: 'nissan', country: 'JP', is_popular: true }]);
const MODELS = list([{ id: 254, make_id: 34, name: 'Skyline GT-R', slug: 'skyline-gt-r' }]);
const CATALOG = {
  '/api/v1/auth/me': ME,
  '/api/v1/catalog/makes': MAKES,
  '/api/v1/catalog/makes/34/models': MODELS,
  '/api/v1/catalog/models/254/generations': list([]),
};
const RESTRICTED_ME = {
  body: {
    data: {
      ...ME.body.data,
      restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: true, until: null } },
    },
  },
};
const draftVehicle = (overrides: Parameters<typeof vehicle>[0] = {}) => vehicle({ id: DRAFT_ID, status: 'draft', qr: null, wizard: { step: 4, total_steps: 4 }, ...overrides });

function ToastProbe() {
  const current = useCurrentToast();
  return current ? <Text testID={current.testID ?? 'toast'}>{current.message}</Text> : null;
}

function connectivity(isConnected: boolean) {
  for (const [listener] of jest.mocked(NetInfo.addEventListener).mock.calls) (listener as (state: { isConnected: boolean }) => void)({ isConnected });
}

/** Lets a chosen request wait until the test releases it, so a screen can be read and left while it is on its way. */
function holdRequests(answers: Record<string, Answer | ((call: Call) => Answer)>, held: (method: string, path: string) => boolean) {
  const stub = stubFetch(answers);
  const inner = globalThis.fetch;
  const gates: (() => void)[] = [];
  globalThis.fetch = (async (input: Request | string, init?: RequestInit) => {
    const request = typeof input === 'string' ? new Request(input, init) : input;
    if (held(request.method, new URL(request.url).pathname)) await new Promise<void>((resolve) => gates.push(resolve));
    return inner(request);
  }) as typeof fetch;
  return { ...stub, waiting: () => gates.length, release: () => gates.shift()?.() };
}

function connectionDrops(): never {
  throw new TypeError('Network request failed');
}

async function fillVehicle(year: string) {
  await fireEvent.press(screen.getByTestId('GAR-03.make'));
  await waitFor(() => expect(screen.getByTestId('GAR-03.makeSheet.option.34')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('GAR-03.makeSheet.option.34.body'));
  await fireEvent.press(screen.getByTestId('GAR-03.model'));
  await waitFor(() => expect(screen.getByTestId('GAR-03.modelSheet.option.254')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('GAR-03.modelSheet.option.254.body'));
  await fireEvent.changeText(screen.getByTestId('GAR-03.year'), year);
}

async function showStepOne(client?: QueryClient) {
  mockParams = { draftId: 'new' };
  return renderScreen(
    <>
      <WizardVehicleScreen />
      <ToastProbe />
    </>,
    client,
  );
}

const posts = (calls: Call[]) => calls.filter((call) => call.method === 'POST' && call.path.endsWith('/vehicles'));
const patches = (calls: Call[]) => calls.filter((call) => call.method === 'PATCH' && call.path.endsWith(`/vehicles/${DRAFT_ID}`));
const firstBody = { make_id: 34, model_id: 254, generation_id: null, model_year: 2002, nickname: null, color: null, description: null };

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  signIn();
  dismissToast();
});
afterAll(() => useSessionStore.setState({ status: 'loading', member: null }));

describe('Prüfen with a draft without a name (BH-00)', () => {
  async function showReview(overrides: Parameters<typeof vehicle>[0]) {
    mockParams = { draftId: DRAFT_ID };
    stubFetch({ '/api/v1/auth/me': ME, [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle({ full_title: 'Mercedes-Benz', ...overrides }) } } });
    await renderScreen(<WizardReviewScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.card')).toBeTruthy());
  }

  it('opens and lists the missing model, with its way back to step 1', async () => {
    await showReview({ model: null, model_id: null, model_text: null, generation: null, generation_id: null });
    expect(screen.getByTestId('GAR-03.review.missing.model')).toBeTruthy();
    expect(screen.queryByTestId('GAR-03.review.missing.make')).toBeNull();
    await fireEvent.press(screen.getByTestId('GAR-03.review.missing.model.body'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith(`/add-vehicle/${DRAFT_ID}/vehicle`);
  });

  it('keeps Veröffentlichen closed while something is missing and says why above it (DQ-1069)', async () => {
    await showReview({ model: null, model_id: null, model_text: null, generation: null, generation_id: null });
    const publish = screen.getByTestId('GAR-03.review.cta.primary');
    expect(publish.props['aria-disabled'] ?? publish.props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByTestId('GAR-03.review.publishNote')).toHaveTextContent(/Zum Veröffentlichen fehlt noch: Modell/);
  });

  it('lists a missing make too', async () => {
    await showReview({ make: null, make_id: null, make_text: null, model: null, model_id: null, model_text: null, eyebrow: null });
    expect(screen.getByTestId('GAR-03.review.missing.make')).toBeTruthy();
    expect(screen.getByTestId('GAR-03.review.missing.model')).toBeTruthy();
  });
});

describe('the limit of 20 vehicles (BH-02, BH-09)', () => {
  const LIMIT = 'Du hast schon 20 Fahrzeuge in deiner Garage. Lösche eins, bevor du ein neues anlegst.';

  it('names the reason in GAR-03.notice, from the real 422 body', async () => {
    const { calls } = stubFetch({
      ...CATALOG,
      'POST /api/v1/vehicles': { status: 422, body: { message: LIMIT, code: 'validation_failed', errors: { vehicle: [LIMIT] } } },
    });
    await showStepOne();
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent(LIMIT));
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(posts(calls)).toHaveLength(1);
  });

  const fullGarage = () => Array.from({ length: 20 }, (_, index) => (index % 2 ? card({ id: `01v${index}` }) : draftCard({ id: `01v${index}` })));

  it('a garage that is still full blocks the form, with one way to the garage and nothing to fill in', async () => {
    const { calls } = stubFetch({ ...CATALOG, '/api/v1/me/vehicles': list(fullGarage()) });
    const client = newQueryClient();
    client.setQueryData(myVehiclesKey, fullGarage());
    await showStepOne(client);
    await waitFor(() => expect(screen.getByTestId('GAR-03.limit')).toBeTruthy());
    // Decided on a fresh read, not on the cache alone.
    expect(calls.some((call) => call.method === 'GET' && call.path.endsWith('/me/vehicles'))).toBe(true);
    expect(screen.getByTestId('GAR-03.limit')).toHaveTextContent(/Deine Garage ist voll/);
    // §8: one line of body; the title already says the garage is full (DQ-254).
    expect(screen.getByTestId('GAR-03.limit.body')).toHaveTextContent('Lösche ein Fahrzeug oder einen Entwurf, um ein neues anzulegen.');
    // A flow that cannot start shows no step of it (DQ-254).
    expect(screen.queryByTestId('GAR-03.progress')).toBeNull();
    expect(screen.queryByTestId('GAR-03.make')).toBeNull();
    expect(screen.queryByTestId('GAR-03.vehicle.cta.primary')).toBeNull();
    expect(screen.queryByTestId('GAR-03.vehicle.saveDraft')).toBeNull();
    await fireEvent.press(screen.getByText('Zur Garage'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/garage');
    expect(posts(calls)).toHaveLength(0);
  });

  it('a cached full garage that has room again on the server shows the form, without a notice', async () => {
    stubFetch({ ...CATALOG, '/api/v1/me/vehicles': list(fullGarage().slice(1)) });
    const client = newQueryClient();
    client.setQueryData(myVehiclesKey, fullGarage());
    await showStepOne(client);
    await waitFor(() => expect(screen.getByTestId('GAR-03.make')).toBeTruthy());
    expect(screen.queryByTestId('GAR-03.limit')).toBeNull();
    expect(screen.getByTestId('GAR-03.vehicle.cta.primary')).not.toBeDisabled();
  });

  it('stays quiet below the limit, and on a draft that exists', async () => {
    stubFetch({ ...CATALOG, [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle({ model_id: null, wizard: { step: 1, total_steps: 4 } }) } } });
    const below = newQueryClient();
    below.setQueryData(myVehiclesKey, Array.from({ length: 19 }, (_, index) => card({ id: `01v${index}` })));
    const first = await showStepOne(below);
    await waitFor(() => expect(screen.getByTestId('GAR-03.make')).toBeTruthy());
    expect(screen.queryByTestId('GAR-03.limit')).toBeNull();
    await first.unmount();

    const full = newQueryClient();
    full.setQueryData(myVehiclesKey, Array.from({ length: 20 }, (_, index) => card({ id: `01v${index}` })));
    mockParams = { draftId: DRAFT_ID };
    await renderScreen(<WizardVehicleScreen />, full);
    await waitFor(() => expect(screen.getByTestId('GAR-03.make')).toBeTruthy());
    expect(screen.queryByTestId('GAR-03.limit')).toBeNull();
  });
});

describe('a lost answer on the first save (BH-03, BH-12)', () => {
  /** The first POST reaches the server and its answer is lost; every later one replays or creates. */
  function lostOnce(after: Answer = { status: 201, body: { data: draftVehicle({ wizard: { step: 2, total_steps: 4 } }) } }) {
    let sent = 0;
    return stubFetch({
      ...CATALOG,
      'POST /api/v1/vehicles': () => {
        sent += 1;
        return sent === 1 ? connectionDrops() : after;
      },
      [`PATCH /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle({ wizard: { step: 2, total_steps: 4 } }) } },
    });
  }

  it('does not claim it failed, and an unchanged retry replays with the same key', async () => {
    const { calls } = lostOnce();
    await showStepOne();
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent(/Vielleicht kam es trotzdem an/));
    expect(screen.getByTestId('GAR-03.notice')).not.toHaveTextContent(/nicht gespeichert/);
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/add-vehicle/${DRAFT_ID}/specs`));
    const [first, second] = posts(calls);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect(second?.body).toEqual(first?.body);
    expect(patches(calls)).toHaveLength(0);
  });

  it('after a changed year re-sends what was sent with the same key, then PATCHes the change', async () => {
    const { calls } = lostOnce();
    await showStepOne();
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-03.year'), '2001');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/add-vehicle/${DRAFT_ID}/specs`));
    const [first, second] = posts(calls);
    expect(posts(calls)).toHaveLength(2);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect(second?.body).toEqual({ ...firstBody, wizard_step: 2 });
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]?.body).toMatchObject({ model_year: 2001 });
    expect(screen.queryByTestId('GAR-03.notice')).toBeNull();
  });

  it('Entwurf speichern after the lost answer adopts the draft instead of a 409', async () => {
    const { calls } = lostOnce();
    await showStepOne();
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.saveDraft'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.toast')).toHaveTextContent('Entwurf gespeichert'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/garage'));
    expect(posts(calls)).toHaveLength(2);
    expect(posts(calls)[1]?.body).toEqual({ ...firstBody, wizard_step: 2 });
    // The mark of the replay stays: Entwurf speichern never moves it back.
    for (const patch of patches(calls)) expect(patch.body).not.toHaveProperty('wizard_step');
  });

  it('takes a new key once the server refused the body', async () => {
    let sent = 0;
    const { calls } = stubFetch({
      ...CATALOG,
      'POST /api/v1/vehicles': () => {
        sent += 1;
        return sent === 1
          ? { status: 403, body: { message: 'Dazu hast du keine Berechtigung.', code: 'forbidden', errors: {} } }
          : { status: 201, body: { data: draftVehicle({ wizard: { step: 2, total_steps: 4 } }) } };
      },
    });
    await showStepOne();
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-03.year'), '2001');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalled());
    const [first, second] = posts(calls);
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
    expect(second?.body).toMatchObject({ model_year: 2001 });
    expect(patches(calls)).toHaveLength(0);
  });

  it.each([
    ['a 500', { status: 500, body: { message: 'Fehler', code: 'server', errors: {} } }],
    ['a 429', { status: 429, body: { message: 'Zu viele Anfragen.', code: 'rate_limited', errors: {} } }],
    ['a 503', { status: 503, body: { message: 'Wartung', code: 'server', errors: {} } }],
  ] as const)('after a lost answer, %s says nothing about it: the retry keeps the key and nothing is created twice', async (_name, answer) => {
    let sent = 0;
    const { calls } = stubFetch({
      ...CATALOG,
      'POST /api/v1/vehicles': () => {
        sent += 1;
        if (sent === 1) return connectionDrops();
        return sent === 2 ? answer : { status: 201, body: { data: draftVehicle({ wizard: { step: 2, total_steps: 4 } }) } };
      },
      [`PATCH /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle({ wizard: { step: 2, total_steps: 4 } }) } },
    });
    await showStepOne();
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent(/kam es trotzdem an/));
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(posts(calls)).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('GAR-03.vehicle.cta.primary')).not.toBeBusy());
    await fireEvent.changeText(screen.getByTestId('GAR-03.year'), '2001');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/add-vehicle/${DRAFT_ID}/specs`));
    const keys = posts(calls).map((call) => call.headers.get('Idempotency-Key'));
    expect(posts(calls)).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    // The replay carries what the lost attempt sent; the change goes on top.
    expect(posts(calls)[2]?.body).toEqual({ ...firstBody, wizard_step: 2 });
    expect(patches(calls)[0]?.body).toMatchObject({ model_year: 2001 });
  });

  it('a field emptied after the lost answer is emptied on the draft too', async () => {
    const { calls } = lostOnce();
    await showStepOne();
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-03.year'), '');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.saveDraft'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.toast')).toHaveTextContent('Entwurf gespeichert'));
    expect(posts(calls)[1]?.body).toMatchObject({ model_year: 2002 });
    expect(patches(calls)).toHaveLength(1);
    // Only what differs from the replayed body: the year, now empty.
    expect(patches(calls)[0]?.body).toEqual({ model_year: null });
  });

  it('keeps the key on a 409 in flight, because the first attempt is still running', async () => {
    let sent = 0;
    const { calls } = stubFetch({
      ...CATALOG,
      'POST /api/v1/vehicles': () => {
        sent += 1;
        if (sent === 1) return connectionDrops();
        return sent === 2
          ? { status: 409, body: { message: 'Diese Anfrage läuft noch. Warte kurz und versuch es noch einmal.', code: 'conflict', errors: {} } }
          : { status: 201, body: { data: draftVehicle({ wizard: { step: 2, total_steps: 4 } }) } };
      },
    });
    await showStepOne();
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent(/kam es trotzdem an/));
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent(/läuft noch/));
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalled());
    const keys = posts(calls).map((call) => call.headers.get('Idempotency-Key'));
    expect(new Set(keys).size).toBe(1);
  });

  it('sends the current values with a new key when the replay is refused: nothing was stored', async () => {
    let sent = 0;
    const { calls } = stubFetch({
      ...CATALOG,
      'POST /api/v1/vehicles': () => {
        sent += 1;
        if (sent === 1) return connectionDrops();
        return sent === 2
          ? { status: 422, body: { message: 'Bitte prüfe deine Eingaben.', code: 'validation_failed', errors: { model_year: ['Baujahr passt nicht.'] } } }
          : { status: 201, body: { data: draftVehicle({ wizard: { step: 2, total_steps: 4 } }) } };
      },
    });
    await showStepOne();
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-03.year'), '2001');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalled());
    const all = posts(calls);
    expect(all).toHaveLength(3);
    expect(all[2]?.body).toMatchObject({ model_year: 2001 });
    expect(all[2]?.headers.get('Idempotency-Key')).not.toBe(all[1]?.headers.get('Idempotency-Key'));
    expect(screen.queryByText('Baujahr passt nicht.')).toBeNull();
  });

  it('never shows jargon for a reused key', async () => {
    stubFetch({
      ...CATALOG,
      'POST /api/v1/vehicles': { status: 409, body: { message: 'Dieser Idempotency-Key gehört zu einer anderen Anfrage.', code: 'idempotency_key_reused', errors: {} } },
    });
    await showStepOne();
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent('Das wurde schon einmal mit anderen Angaben abgeschickt. Schau nach, was gespeichert ist.'));
  });

  it('reads the garage again after a lost answer, so a stored draft shows after a discard', async () => {
    const { calls } = lostOnce();
    const client = newQueryClient();
    client.setQueryData(myVehiclesKey, []);
    await showStepOne(client);
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toBeTruthy());
    expect(client.getQueryState(myVehiclesKey)?.isInvalidated).toBe(true);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });
});

describe('Entwurf speichern checks an entered year (BH-05)', () => {
  it.each(['2099', '1500', '20x'])('refuses %s with the app’s own wording, without a request', async (year) => {
    const { calls } = stubFetch(CATALOG);
    await showStepOne();
    await fireEvent.changeText(screen.getByTestId('GAR-03.year'), year);
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.saveDraft'));
    await waitFor(() => expect(screen.getByText(/Gib ein Baujahr zwischen 1886 und \d{4} ein\./)).toBeTruthy());
    expect(posts(calls)).toHaveLength(0);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('stays lenient about what is missing', async () => {
    const { calls } = stubFetch({ ...CATALOG, 'POST /api/v1/vehicles': { status: 201, body: { data: draftVehicle({ model: null, wizard: { step: 1, total_steps: 4 } }) } } });
    await showStepOne();
    await fireEvent.press(screen.getByTestId('GAR-03.make'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.makeSheet.option.34')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-03.makeSheet.option.34.body'));
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.saveDraft'));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]?.body).toMatchObject({ make_id: 34, model_id: null, model_year: null, wizard_step: 1 });
  });
});

describe('the review’s visibility saves on change (BH-08)', () => {
  const VISIBILITY = `/api/v1/vehicles/${DRAFT_ID}/visibility`;
  const visibilityCalls = (calls: Call[]) => calls.filter((call) => call.method === 'PATCH' && call.path.endsWith('/visibility'));
  const answerWith = (visibility: string) => ({ body: { data: draftVehicle({ visibility: visibility as 'public' }) } });

  function serving(extra: Record<string, Answer | ((call: Call) => Answer)> = {}) {
    return {
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle() } },
      [`PATCH ${VISIBILITY}`]: (call: Call) => answerWith((call.body as { visibility: string }).visibility),
      ...extra,
    };
  }

  async function showReview(client?: QueryClient) {
    mockParams = { draftId: DRAFT_ID };
    const result = await renderScreen(
      <>
        <WizardReviewScreen />
        <ToastProbe />
      </>,
      client,
    );
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.card')).toBeTruthy());
    return result;
  }
  const checked = (option: string) => screen.getByTestId(`GAR-03.review.visibility.${option}`).props['aria-checked'] ?? screen.getByTestId(`GAR-03.review.visibility.${option}`).props.accessibilityState?.checked;

  it('sends the choice at once and shows it before the server answered', async () => {
    const { calls, waiting, release } = holdRequests(serving(), (method, path) => method === 'PATCH' && path.endsWith('/visibility'));
    await showReview();
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.private'));
    await waitFor(() => expect(waiting()).toBe(1));
    expect(checked('private')).toBe(true);
    expect(checked('public')).toBe(false);
    // Publish and Entwurf speichern wait for it.
    expect(screen.getByTestId('GAR-03.review.cta.primary')).toBeBusy();
    expect(screen.getByTestId('GAR-03.review.saveDraft')).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(visibilityCalls(calls)[0]?.body).toEqual({ visibility: 'private' }));
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.cta.primary')).not.toBeBusy());
    expect(checked('private')).toBe(true);
    expect(calls.some((call) => call.path.endsWith('/publish'))).toBe(false);
  });

  it('survives leaving the step: a new mount shows what was saved', async () => {
    let stored = 'public';
    stubFetch(
      serving({
        [`GET /api/v1/vehicles/${DRAFT_ID}`]: () => answerWith(stored),
        [`PATCH ${VISIBILITY}`]: (call: Call) => {
          stored = (call.body as { visibility: string }).visibility;
          return answerWith(stored);
        },
      }),
    );
    const client = newQueryClient();
    const first = await showReview(client);
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.private'));
    await waitFor(() => expect(client.getQueryData<{ visibility: string }>(garageKeys.vehicle(DRAFT_ID))?.visibility).toBe('private'));
    await first.unmount();
    await showReview(client);
    expect(checked('private')).toBe(true);
  });

  it('Entwurf speichern then tells the truth: the choice is already stored', async () => {
    const { calls } = stubFetch(serving());
    await showReview();
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.private'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.saveDraft')).not.toBeDisabled());
    await fireEvent.press(screen.getByTestId('GAR-03.review.saveDraft'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.toast')).toHaveTextContent('Entwurf gespeichert'));
    expect(visibilityCalls(calls)).toHaveLength(1);
  });

  it('publishes what was picked, after the save has landed', async () => {
    const { calls, waiting, release } = holdRequests(
      serving({ [`POST /api/v1/vehicles/${DRAFT_ID}/publish`]: { body: { data: draftVehicle({ status: 'published', visibility: 'private', qr: { code: '8TR0Q3MC', url: 'https://speedclub.test/C/8TR0Q3MC' } }) } } }),
      (method, path) => method === 'PATCH' && path.endsWith('/visibility'),
    );
    await showReview();
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.private'));
    await waitFor(() => expect(waiting()).toBe(1));
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    expect(calls.some((call) => call.path.endsWith('/publish'))).toBe(false);
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.cta.primary')).not.toBeBusy());
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/published/[vehicleId]', params: { vehicleId: DRAFT_ID } }));
    expect(calls.find((call) => call.path.endsWith('/publish'))?.body).toEqual({ visibility: 'private' });
  });

  it('sends the last of two quick picks, one after the other', async () => {
    const { calls, waiting, release } = holdRequests(serving(), (method, path) => method === 'PATCH' && path.endsWith('/visibility'));
    const client = newQueryClient();
    await showReview(client);
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.private'));
    await waitFor(() => expect(waiting()).toBe(1));
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.unlisted'));
    expect(checked('unlisted')).toBe(true);
    await act(async () => release());
    await waitFor(() => expect(waiting()).toBe(1));
    await act(async () => release());
    await waitFor(() => expect(client.getQueryData<{ visibility: string }>(garageKeys.vehicle(DRAFT_ID))?.visibility).toBe('unlisted'));
    expect(visibilityCalls(calls).map((call) => call.body)).toEqual([{ visibility: 'private' }, { visibility: 'unlisted' }]);
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.cta.primary')).not.toBeBusy());
    expect(checked('unlisted')).toBe(true);
  });

  it('goes back to the previous choice and says why when the save fails, with no toast', async () => {
    stubFetch(serving({ [`PATCH ${VISIBILITY}`]: { status: 500, body: { message: 'Fehler', code: 'server', errors: {} } } }));
    await showReview();
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.private'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent('Speichern hat nicht geklappt. Versuche es noch einmal.'));
    await flushQueryNotifications();
    expect(checked('public')).toBe(true);
    expect(checked('private')).toBe(false);
    expect(screen.queryByTestId('GAR-03.toast')).toBeNull();
    expect(screen.getByTestId('GAR-03.review.cta.primary')).not.toBeBusy();
  });

  it('goes back when the connection drops on the way', async () => {
    stubFetch(serving({ [`PATCH ${VISIBILITY}`]: () => connectionDrops() }));
    await showReview();
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.unlisted'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent('Keine Verbindung. Deine Änderungen sind noch nicht gespeichert.'));
    await flushQueryNotifications();
    expect(checked('public')).toBe(true);
  });

  it('stays on the old choice and sends nothing while offline', async () => {
    const { calls } = stubFetch(serving());
    await showReview();
    try {
      await act(async () => connectivity(false));
      await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.private'));
      await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent('Keine Verbindung. Deine Änderungen sind noch nicht gespeichert.'));
      expect(checked('public')).toBe(true);
      expect(visibilityCalls(calls)).toHaveLength(0);
    } finally {
      await act(async () => connectivity(true));
    }
  });

  it('never sends an unchanged value', async () => {
    const { calls } = stubFetch(serving());
    await showReview();
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.public'));
    await flushQueryNotifications();
    expect(visibilityCalls(calls)).toHaveLength(0);
    expect(screen.queryByTestId('GAR-03.notice')).toBeNull();
  });

  it('under a restriction keeps Privat open, and a 403 goes back with its reason', async () => {
    const reason = 'Dein Konto ist eingeschränkt.';
    const { calls } = stubFetch(
      serving({
        '/api/v1/auth/me': RESTRICTED_ME,
        [`PATCH ${VISIBILITY}`]: { status: 403, body: { message: reason, code: 'account_restricted', errors: {} } },
      }),
    );
    await showReview();
    await waitFor(() => expect(screen.getByTestId('GAR-03.restricted')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.public'));
    expect(visibilityCalls(calls)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.private'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent(reason));
    expect(checked('public')).toBe(true);
  });
});

describe('leaving during a slow save sticks (BH-14)', () => {
  const gate = (method: string, path: string) => method !== 'GET' && !path.endsWith('/auth/me');

  it.each([
    ['vehicle', <WizardVehicleScreen key="vehicle" />, 'GAR-03.vehicle.cta.primary'],
    ['specs', <WizardSpecsScreen key="specs" />, 'GAR-03.specs.cta.primary'],
    ['photos', <WizardPhotosScreen key="photos" />, 'GAR-03.photos.cta.primary'],
  ] as const)('step %s keeps the save and skips the navigation once it is gone', async (step, element, cta) => {
    mockParams = { draftId: DRAFT_ID };
    const draft = draftVehicle({ wizard: { step: 1, total_steps: 4 } });
    const { calls, waiting, release } = holdRequests(
      { ...CATALOG, [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draft } }, [`/api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draft } } },
      gate,
    );
    const rendered = await renderScreen(element);
    await waitFor(() => expect(screen.getByTestId(cta)).toBeTruthy());
    await fireEvent.press(screen.getByTestId(cta));
    await waitFor(() => expect(waiting()).toBe(1));
    await rendered.unmount();
    await act(async () => release());
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    await flushQueryNotifications();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(step).toBeTruthy();
  });

  it('still moves on when the step is there', async () => {
    mockParams = { draftId: DRAFT_ID };
    const draft = draftVehicle({ wizard: { step: 1, total_steps: 4 } });
    const { waiting, release } = holdRequests({ ...CATALOG, [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draft } }, [`/api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draft } } }, gate);
    await renderScreen(<WizardSpecsScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-03.specs.cta.primary')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-03.specs.cta.primary'));
    await waitFor(() => expect(waiting()).toBe(1));
    await act(async () => release());
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/add-vehicle/${DRAFT_ID}/photos`));
  });

  it('× during publish does not throw the member to GAR-04', async () => {
    mockParams = { draftId: DRAFT_ID };
    const { calls, waiting, release } = holdRequests(
      {
        '/api/v1/auth/me': ME,
        [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle() } },
        [`POST /api/v1/vehicles/${DRAFT_ID}/publish`]: { body: { data: draftVehicle({ status: 'published' }) } },
      },
      (method, path) => method === 'POST' && path.endsWith('/publish'),
    );
    const rendered = await renderScreen(<WizardReviewScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.card')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(waiting()).toBe(1));
    await rendered.unmount();
    await act(async () => release());
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/publish'))).toBe(true));
    await flushQueryNotifications();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('the wizard’s mark never moves back (BH-18)', () => {
  it('Weiter on step 1 of a new draft reads the mark from the draft it created', async () => {
    const created = draftVehicle({ wizard: { step: 2, total_steps: 4 } });
    const { calls } = stubFetch({
      ...CATALOG,
      'POST /api/v1/vehicles': { status: 201, body: { data: created } },
      [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle({ wizard: { step: 3, total_steps: 4 } }) } },
      [`PATCH /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: created } },
    });
    const client = newQueryClient();
    await showStepOne(client);
    await fillVehicle('2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/add-vehicle/${DRAFT_ID}/specs`));
    // Step 2 saved its Weiter while this screen stayed underneath in the stack, and the member came back with browser back.
    await act(async () => client.setQueryData(garageKeys.vehicle(DRAFT_ID), draftVehicle({ wizard: { step: 3, total_steps: 4 } })));
    await flushQueryNotifications();
    mockRouter.push.mockClear();
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/add-vehicle/${DRAFT_ID}/specs`));
    expect(patches(calls)).toHaveLength(0);
  });
});

/** A copy younger than the 60 s of staleTime, as the persisted cache restores it: on its own it would never be read again. */
function youngClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 }, mutations: { retry: false, gcTime: Infinity } } });
}

const isChecked = (testID: string) => {
  const props = screen.getByTestId(testID).props as { 'aria-checked'?: boolean; accessibilityState?: { checked?: boolean } };
  return props['aria-checked'] ?? props.accessibilityState?.checked;
};

const vehicleGets = (calls: Call[]) => calls.filter((call) => call.method === 'GET' && call.path.endsWith(`/vehicles/${DRAFT_ID}`));

describe('every step reads the draft fresh on open (BH-10 for the wizard)', () => {
  const older = draftVehicle({ wizard: { step: 2, total_steps: 4 }, specs: { ...vehicle().specs, torque_nm: 400, engine_code: 'WOLD', displacement_cc: null } });
  const newer = draftVehicle({ wizard: { step: 2, total_steps: 4 }, specs: { ...vehicle().specs, torque_nm: 555, engine_code: 'WNEW', displacement_cc: null } });

  it('step 2 takes another device’s specs into the untouched fields, keeps the typed one, and PUTs both', async () => {
    mockParams = { draftId: DRAFT_ID };
    const { calls, waiting, release } = holdRequests(
      {
        '/api/v1/auth/me': ME,
        [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: newer } },
        [`PUT /api/v1/vehicles/${DRAFT_ID}/specs`]: { body: { data: newer } },
        [`PATCH /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: newer } },
      },
      (method, path) => method === 'GET' && path.endsWith(`/vehicles/${DRAFT_ID}`),
    );
    const client = youngClient();
    client.setQueryData(garageKeys.vehicle(DRAFT_ID), older);
    await renderScreen(<WizardSpecsScreen />, client);
    await waitFor(() => expect(screen.getByTestId('GAR-03.torque')).toHaveDisplayValue('400'));
    await fireEvent.changeText(screen.getByTestId('GAR-03.displacement'), '2000');
    await waitFor(() => expect(waiting()).toBe(1));
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId('GAR-03.torque')).toHaveDisplayValue('555'));
    expect(screen.getByTestId('GAR-03.engineCode')).toHaveDisplayValue('WNEW');
    expect(screen.getByTestId('GAR-03.displacement')).toHaveDisplayValue('2000');
    await fireEvent.press(screen.getByTestId('GAR-03.specs.cta.primary'));
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ torque_nm: 555, engine_code: 'WNEW', displacement_cc: 2000 });
  });

  it('the review shows and publishes the visibility another device stored', async () => {
    mockParams = { draftId: DRAFT_ID };
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle({ visibility: 'private' }) } },
      [`POST /api/v1/vehicles/${DRAFT_ID}/publish`]: { body: { data: draftVehicle({ status: 'published', visibility: 'private' }) } },
    });
    const client = youngClient();
    client.setQueryData(garageKeys.vehicle(DRAFT_ID), draftVehicle({ visibility: 'public' }));
    await renderScreen(<WizardReviewScreen />, client);
    await waitFor(() => expect(isChecked('GAR-03.review.visibility.private')).toBe(true));
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/publish'))).toBe(true));
    expect(calls.find((call) => call.path.endsWith('/publish'))?.body).toEqual({ visibility: 'private' });
    expect(vehicleGets(calls).length).toBeGreaterThan(0);
  });
});

describe('the fresh read waits for the persisted cache (BH-08, BH-10)', () => {
  function tree(client: QueryClient, restoring: boolean) {
    return (
      <GestureHandlerRootView>
        <QueryClientProvider client={client}>
          <IsRestoringProvider value={restoring}>
            <ThemeProvider>
              <WizardReviewScreen />
            </ThemeProvider>
          </IsRestoringProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    );
  }

  it('reads once the restore is done, so a copy that missed the last save does not stand for a minute', async () => {
    mockParams = { draftId: DRAFT_ID };
    const { calls } = stubFetch({ '/api/v1/auth/me': ME, [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle({ visibility: 'private' }) } } });
    const client = youngClient();
    const view = await render(tree(client, true));
    await flushQueryNotifications();
    expect(vehicleGets(calls)).toHaveLength(0);
    // The restore brings back the copy written before the last save (the persister writes at most once a second).
    await act(async () => client.setQueryData(garageKeys.vehicle(DRAFT_ID), draftVehicle({ visibility: 'public' })));
    await view.rerender(tree(client, false));
    await waitFor(() => expect(vehicleGets(calls)).toHaveLength(1));
    await waitFor(() => expect(isChecked('GAR-03.review.visibility.private')).toBe(true));
  });
});

describe('Veröffentlichen after a lost answer (BH-08 rest, ADR-176 a)', () => {
  const PUBLISH = `/api/v1/vehicles/${DRAFT_ID}/publish`;
  const publishes = (calls: Call[]) => calls.filter((call) => call.method === 'POST' && call.path.endsWith('/publish'));
  const published = (visibility: string) => ({ body: { data: draftVehicle({ status: 'published', visibility: visibility as 'public' }) } });

  async function showReview() {
    mockParams = { draftId: DRAFT_ID };
    await renderScreen(<WizardReviewScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.card')).toBeTruthy());
  }

  it('a changed choice takes a new key, the server answers 200 for the car it already published, and GAR-04 opens', async () => {
    let sent = 0;
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle() } },
      [`PATCH /api/v1/vehicles/${DRAFT_ID}/visibility`]: { body: { data: draftVehicle({ visibility: 'private' }) } },
      [`POST ${PUBLISH}`]: () => {
        sent += 1;
        return sent === 1 ? connectionDrops() : published('private');
      },
    });
    await showReview();
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent(/Vielleicht kam es trotzdem an/));
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.private'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.cta.primary')).not.toBeBusy());
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/published/[vehicleId]', params: { vehicleId: DRAFT_ID } }));
    const [first, second] = publishes(calls);
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
    expect(second?.body).toEqual({ visibility: 'private' });
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 429', { status: 429, body: { message: 'Zu viele Anfragen.', code: 'rate_limited', errors: {} } }],
    ['a 500', { status: 500, body: { message: 'Fehler', code: 'server', errors: {} } }],
    ['a 401', { status: 401, body: { message: 'Bitte melde dich an.', code: 'unauthenticated', errors: {} } }],
  ] as const)('keeps the key after a lost answer and then %s', async (_name, answer) => {
    let sent = 0;
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle() } },
      [`POST ${PUBLISH}`]: () => {
        sent += 1;
        if (sent === 1) return connectionDrops();
        return sent === 2 ? answer : published('public');
      },
    });
    await showReview();
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(publishes(calls)).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.cta.primary')).not.toBeBusy());
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(publishes(calls)).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.cta.primary')).not.toBeBusy());
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/published/[vehicleId]', params: { vehicleId: DRAFT_ID } }));
    expect(new Set(publishes(calls).map((call) => call.headers.get('Idempotency-Key'))).size).toBe(1);
  });

  it('takes a new key after an answer that refuses the publish', async () => {
    let sent = 0;
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle() } },
      [`POST ${PUBLISH}`]: () => {
        sent += 1;
        return sent === 1 ? { status: 422, body: { message: 'Füge mindestens ein fertiges Foto hinzu.', code: 'validation_failed', errors: {} } } : published('public');
      },
    });
    await showReview();
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.notice')).toHaveTextContent('Füge mindestens ein fertiges Foto hinzu.'));
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(publishes(calls)).toHaveLength(2));
    const [first, second] = publishes(calls);
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
  });

  it('a vehicle that is already published leaves the wizard for GAR-04 when the review opens', async () => {
    const { calls } = stubFetch({ '/api/v1/auth/me': ME, [`GET /api/v1/vehicles/${DRAFT_ID}`]: published('public') });
    mockParams = { draftId: DRAFT_ID };
    await renderScreen(<WizardReviewScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/published/[vehicleId]', params: { vehicleId: DRAFT_ID } }));
    expect(screen.queryByTestId('GAR-03.review.card')).toBeNull();
    expect(screen.queryByTestId('GAR-03.review.cta.primary')).toBeNull();
    expect(publishes(calls)).toHaveLength(0);
  });
});

describe('a photo the server could not process, on step 3 (BH-46)', () => {
  it('stays as a tile, as on GAR-07, instead of vanishing from the count', async () => {
    mockParams = { draftId: DRAFT_ID };
    const failed = vehicle().photos[0] && { ...vehicle().photos[0]!, id: '01bad', status: 'failed' as const, variants: [], width: null, height: null, blurhash: null };
    stubFetch({ '/api/v1/auth/me': ME, [`GET /api/v1/vehicles/${DRAFT_ID}`]: { body: { data: draftVehicle({ wizard: { step: 3, total_steps: 4 }, failed_photos: failed ? [failed] : [] }) } } });
    await renderScreen(<WizardPhotosScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-03.photos')).toBeTruthy());
    await act(async () => {
      fireEvent(screen.getByTestId('GAR-03.photos'), 'layout', { nativeEvent: { layout: { width: 360, height: 400, x: 0, y: 0 } } });
    });
    expect(screen.getByTestId('GAR-03.photos.failed.01bad')).toHaveAccessibleName(/konnte nicht verarbeitet werden/);
    expect(screen.getByTestId('GAR-03.photos.failed.01bad.status')).toBeTruthy();
  });
});
