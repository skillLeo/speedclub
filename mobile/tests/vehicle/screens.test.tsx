import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { GalleryScreen } from '@/features/vehicle/screens/GalleryScreen';
import { ModDetailScreen } from '@/features/vehicle/screens/ModDetailScreen';
import { UpdateDetailScreen } from '@/features/vehicle/screens/UpdateDetailScreen';
import { ViewerScreen } from '@/features/vehicle/screens/ViewerScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { R34, R34_WHEELS } from './fixtures';
import { renderWithProviders, stubFetch } from './harness';

const SLUG = R34.slug;
const mockParams: Record<string, string | undefined> = {};
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/v/test',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
// Items render in place: virtualisation is FlashList's own business and needs a layout Jest does not have.
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  ListHeaderComponent?: ReactNode;
};
jest.mock('@shopify/flash-list', () => {
  const { forwardRef } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList({ data, renderItem, ListHeaderComponent }, _ref) {
    return (
      <>
        {ListHeaderComponent}
        {data.map((item, index) => renderItem({ item, index }))}
      </>
    );
  });
  return { FlashList };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const text = (testID: string) => screen.getByTestId(testID);
const setParams = (next: Record<string, string>) => {
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  Object.assign(mockParams, next);
};

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('VEH-02 modification detail', () => {
  beforeEach(() => setParams({ slug: SLUG, modId: R34_WHEELS.id }));

  it('shows the category, the spec table and the owner disclaimer, without notes or a legal status field', async () => {
    stubFetch({ [`/mods/${R34_WHEELS.id}`]: { body: { data: R34_WHEELS } } });
    await renderWithProviders(<ModDetailScreen />);
    expect(await screen.findByTestId('VEH-02.spec.diameter')).toHaveTextContent('Durchmesser18″');
    expect(text('VEH-02.title')).toHaveTextContent('Rays Volk Racing TE37 Saga');
    // DQ-177: the server writes it for the reader (ModPresenter); the screen shows what it sends.
    expect(text('VEH-02.spec.bolt_pattern')).toHaveTextContent('Lochkreis5×114,3');
    expect(text('VEH-02.status')).toHaveTextContent('Verbaut');
    expect(text('VEH-02.header.title')).toHaveTextContent('Räder & Reifen');
    expect(text('VEH-02.legalDisclaimer')).toHaveTextContent('Angaben des Besitzers, keine rechtliche Prüfung');
    // The brand is in the category table already ("Felgenmarke: Rays").
    expect(screen.queryByTestId('VEH-02.general.brand')).toBeNull();
    expect(screen.queryByText('Unbekannt')).toBeNull();
    // M2.3: "Ähnliche suchen" opens DISC-02 with the part's own filters (ModificationResource.search).
    await fireEvent.press(screen.getByTestId('VEH-02.searchSimilar'));
    expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/discover/search', params: { wheel_diameter: '18', wheel_brand: 'rays' } });
  });

  it('says a removed mod is gone and leads back to its vehicle', async () => {
    stubFetch({ [`/mods/${R34_WHEELS.id}`]: { status: 404, body: { message: 'Nicht gefunden.', code: 'not_found' } } });
    await renderWithProviders(<ModDetailScreen />);
    expect(await screen.findByTestId('VEH-02.notFound')).toHaveTextContent(/Diese Modifikation gibt es nicht mehr/);
    await fireEvent.press(text('VEH-02.notFound.action'));
    expect(mockRouter.replace).toHaveBeenCalledWith(`/v/${SLUG}`);
  });

  it('opens the mod photos in the viewer: the first as the 4:5 hero (DQ-1070), the rest from the wall', async () => {
    const [first, second] = [R34.photos[0]!, R34.photos[1]!];
    stubFetch({ [`/mods/${R34_WHEELS.id}`]: { body: { data: { ...R34_WHEELS, photos: [first, second] } } } });
    await renderWithProviders(<ModDetailScreen />);
    await fireEvent.press(await screen.findByTestId('VEH-02.hero'));
    expect(await screen.findByTestId('VEH-04.viewer.counter')).toHaveTextContent('1/2');
    expect(screen.getByTestId('VEH-02.photo.1')).toBeTruthy();
  });

  it('draws a glyph header for a mod without photos and never a cost (DQ-1070, GAR-10 ruling)', async () => {
    stubFetch({ [`/mods/${R34_WHEELS.id}`]: { body: { data: { ...R34_WHEELS, photos: [], cost: { cents: 120000, label: '1.200 €' } } } } });
    await renderWithProviders(<ModDetailScreen />);
    expect(await screen.findByTestId('VEH-02.glyphHeader')).toBeTruthy();
    expect(screen.queryByText('1.200 €')).toBeNull();
  });
});

describe('VEH-03 gallery', () => {
  beforeEach(() => setParams({ slug: SLUG }));

  it('shows every photo, filters by the categories that hold photos, and opens the filtered set', async () => {
    stubFetch({ [`/public/vehicles/${SLUG}`]: { body: { data: R34 } } });
    await renderWithProviders(<GalleryScreen />);
    expect(await screen.findByTestId('VEH-03.count')).toHaveTextContent('3 Fotos');
    expect(text('VEH-03.filter.all')).toBeTruthy();
    expect(screen.queryByTestId('VEH-03.filter.wheels')).toBeNull();
    await fireEvent.press(text('VEH-03.filter.interior'));
    expect(text('VEH-03.count')).toHaveTextContent('1 Foto');
    await fireEvent.press(text('VEH-03.photo.0'));
    expect(await screen.findByTestId('VEH-04.viewer.counter')).toHaveTextContent('1/1');
  });

  it('has a designed empty state', async () => {
    stubFetch({ [`/public/vehicles/${SLUG}`]: { body: { data: { ...R34, photos: [], photo_count: 0 } } } });
    await renderWithProviders(<GalleryScreen />);
    expect(await screen.findByTestId('VEH-03.empty')).toHaveTextContent(/Noch keine Fotos/);
  });
});

describe('VEH-04 viewer route', () => {
  it('opens on the photo in the link, and drag to dismiss goes back', async () => {
    setParams({ slug: SLUG, index: '2' });
    stubFetch({ [`/public/vehicles/${SLUG}`]: { body: { data: R34 } } });
    await renderWithProviders(<ViewerScreen />);
    expect(await screen.findByTestId('VEH-04.viewer.counter')).toHaveTextContent('3/3');
    // One event: the helper repeats it for begin, activate and end. Activated with a mostly vertical distance, the drag
    // dismisses past 120 (imageViewerMath).
    await act(async () => {
      fireGestureHandler(getByGestureTestId('VEH-04.viewer.pan'), [{ translationX: 0, translationY: 200, velocityX: 0, velocityY: 0 }]);
    });
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });

  it('keeps an index from a link inside the photos, and closes to the vehicle without history', async () => {
    setParams({ slug: SLUG, index: '99' });
    mockRouter.canGoBack.mockReturnValue(false);
    stubFetch({ [`/public/vehicles/${SLUG}`]: { body: { data: R34 } } });
    await renderWithProviders(<ViewerScreen />);
    expect(await screen.findByTestId('VEH-04.viewer.counter')).toHaveTextContent('3/3');
    await fireEvent.press(text('VEH-04.viewer.close'));
    expect(mockRouter.replace).toHaveBeenCalledWith(`/v/${SLUG}`);
    mockRouter.canGoBack.mockReturnValue(true);
  });

  it('shows the unavailable state for a hidden vehicle', async () => {
    setParams({ slug: 'toyota-gr86-zn8-6g12gv4h' });
    stubFetch({ '/public/vehicles/toyota-gr86-zn8-6g12gv4h': { status: 404, body: { message: 'Fahrzeug nicht verfügbar.', code: 'vehicle_unavailable' } } });
    await renderWithProviders(<ViewerScreen />);
    expect(await screen.findByTestId('VEH-04.unavailable')).toBeTruthy();
  });
});

describe('VEH-05 build update detail', () => {
  const brakes = R34.updates[1]!;
  const detailed = {
    ...brakes,
    type: 'mod_changed' as const,
    type_label: 'Modifikation geändert',
    changes: [
      {
        ...brakes.changes[0]!,
        kind: 'mod_changed',
        details: [{ label: 'Scheibe vorne', before: '324 mm', after: '356 mm' }],
      },
    ],
  };

  beforeEach(() => setParams({ slug: SLUG, updateId: brakes.id }));

  it('shows each change before → after with its fields, and opens the mod; the kind once (DQ-1059)', async () => {
    stubFetch({ [`/updates/${brakes.id}`]: { body: { data: detailed } } });
    await renderWithProviders(<UpdateDetailScreen />);
    // The title names the change, the meta carries its system, and the card does not repeat "Bremsen".
    expect(await screen.findByTestId('VEH-05.change.0')).toHaveTextContent(
      'VorherBrembo SerieNachherAP Racing Radi-CAL · 356 mmScheibe vorne324 mm → 356 mmModifikation ansehen',
      { exact: true },
    );
    expect(text('VEH-05.title')).toHaveTextContent('AP Racing Radi-\u2060CAL statt Brembo Serie');
    expect(text('VEH-05.meta')).toHaveTextContent('Bremsen · 03.09.2024');
    await fireEvent.press(text('VEH-05.openMod.0'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${SLUG}/mods/${brakes.changes[0]!.modification_id}`);
  });

  it('offers no way to a removed mod', async () => {
    const removed = { ...detailed, changes: [{ ...detailed.changes[0]!, kind: 'mod_removed' }] };
    stubFetch({ [`/updates/${brakes.id}`]: { body: { data: removed } } });
    await renderWithProviders(<UpdateDetailScreen />);
    expect(await screen.findByTestId('VEH-05.change.0')).toBeTruthy();
    expect(screen.queryByTestId('VEH-05.openMod.0')).toBeNull();
  });

  it('shows a note entry with its text', async () => {
    const note = R34.updates[0]!;
    setParams({ slug: SLUG, updateId: note.id });
    stubFetch({ [`/updates/${note.id}`]: { body: { data: note } } });
    await renderWithProviders(<UpdateDetailScreen />);
    expect(await screen.findByTestId('VEH-05.note')).toHaveTextContent(/^Saisonstart/);
    expect(text('VEH-05.title')).toHaveTextContent('Notiz');
    expect(screen.queryByTestId('VEH-05.changes')).toBeNull();
  });

  it('says a hidden or removed entry is gone', async () => {
    stubFetch({ [`/updates/${brakes.id}`]: { status: 404, body: { message: 'Nicht gefunden.', code: 'not_found' } } });
    await renderWithProviders(<UpdateDetailScreen />);
    expect(await screen.findByTestId('VEH-05.notFound')).toHaveTextContent(/Diesen Eintrag gibt es nicht mehr/);
  });
});
