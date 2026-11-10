import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { VehicleScreen } from '@/features/vehicle/screens/VehicleScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, themes } from '@/theme';

import { R34 } from './fixtures';
import { visualOf } from '../ui/helpers';
import { newQueryClient, renderWithProviders, stubFetch } from './harness';

const SLUG = R34.slug;
const mockParams: { slug: string; tab?: string } = { slug: SLUG };
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
  usePathname: () => `/v/${mockParams.slug}`,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const text = (testID: string) => screen.getByTestId(testID);
const signIn = () =>
  useSessionStore.setState({ status: 'member', member: { id: 'viewer', username: 'max.e46', displayName: 'Max', avatarUrl: null } });

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams.slug = SLUG;
  delete mockParams.tab;
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('VEH-01 composition (FS-3)', () => {
  it('stacks hero, eyebrow, title, sub-line, strip and owner row as WEB-01 does', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    expect(text('VEH-01.root')).toBeTruthy();
    expect(text('VEH-01.photoCount')).toHaveTextContent('1/3');
    expect(text('VEH-01.eyebrow')).toHaveTextContent('NISSAN');
    expect(text('VEH-01.title')).toHaveTextContent('Skyline GT-R R34');
    expect(text('VEH-01.subline')).toHaveTextContent('2002 · 2,6 l R6 Biturbo (RB26DETT) · Bayside Blue');
    expect(text('VEH-01.specStrip')).toHaveTextContent('500PS540Nm2002BaujahrAWDAntrieb');
    expect(text('VEH-01.ownerRow')).toHaveTextContent('LSLukas Scholz@lukas.sc · StuttgartFolgenNachricht');
    // Parity regions sit in the order of WEB-01.
    const ids = screen.getAllByTestId(/^VEH-01\.(hero|title|specStrip|ownerRow)$/).map((node) => node.props.testID as string);
    expect(ids).toEqual(['VEH-01.hero', 'VEH-01.title', 'VEH-01.specStrip', 'VEH-01.ownerRow']);
    // The tab row's name is WEB-01's nav label (public.vehicle.nav_label), word for word.
    expect(text('VEH-01.tabs.list').props['aria-label']).toBe('Abschnitte');
  });

  it('opens Übersicht with the description, three highlights, the photo preview and the closing owner card', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    expect(text('VEH-01.description')).toHaveTextContent(/^Skyline GT-R V-Spec II aus Japan/);
    expect(within(text('VEH-01.highlights')).getByText('Rays Volk Racing TE37 Saga')).toBeTruthy();
    expect(text('VEH-01.highlights.header.action')).toHaveTextContent('Alle Mods (14)');
    expect(text('VEH-01.photoPreview.header.action')).toHaveTextContent('Alle Fotos (3)');
    expect(screen.getByTestId('VEH-01.photoPreview.tile.0')).toBeTruthy();
    expect(text('VEH-01.closingOwner')).toHaveTextContent(/^Fragen an Lukas Scholz\?/);
  });

  it('sends a guest to the auth-required sheet and back here, from the owner row and the owner card', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.ownerRow.follow'));
    expect(useSessionStore.getState()).toMatchObject({ promptOpen: true, intent: { returnTo: `/v/${SLUG}` } });
    await act(() => useSessionStore.setState({ promptOpen: false, intent: null }));
    await fireEvent.press(text('VEH-01.closingMessage'));
    expect(useSessionStore.getState().promptOpen).toBe(true);
  });

  it('lets a member follow the owner (M2.1) and write about this vehicle (M2.4)', async () => {
    signIn();
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    expect(text('VEH-01.ownerRow')).toBeTruthy();
    expect(text('VEH-01.ownerRow.follow')).toHaveTextContent('Folgen');
    await fireEvent.press(text('VEH-01.ownerRow.message'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/new-message', params: { to: 'lukas.sc', about: R34.slug } });
  });

  it('shows a member no Nachricht when the owner does not take messages from them', async () => {
    signIn();
    const closed = { ...R34, owner: R34.owner ? { ...R34.owner, can_message: false } : null };
    await renderWithProviders(<VehicleProfile vehicle={closed} onBack={jest.fn()} />);
    expect(text('VEH-01.ownerRow.follow')).toBeTruthy();
    expect(screen.queryByTestId('VEH-01.ownerRow.message')).toBeNull();
  });

  it('leaves the owner out entirely when the owner is hidden (ADR-148)', async () => {
    await renderWithProviders(<VehicleProfile vehicle={{ ...R34, owner: null }} onBack={jest.fn()} />);
    expect(screen.queryByTestId('VEH-01.ownerRow')).toBeNull();
    expect(screen.queryByTestId('VEH-01.closingOwner')).toBeNull();
  });

  it('designs the photo-less hero and names the owner in it', async () => {
    const bare = { ...R34, photos: [], cover: null, photo_count: 0 };
    const view = await renderWithProviders(<VehicleProfile vehicle={bare} onBack={jest.fn()} />);
    expect(text('VEH-01.heroEmpty')).toHaveTextContent('Noch keine Fotos@lukas.sc hat für dieses Fahrzeug noch keine Bilder hochgeladen.');
    expect(screen.queryByTestId('VEH-01.photoCount')).toBeNull();
    // No photo to float over: the header is a bar above the content.
    expect(screen.getByTestId('VEH-01.header')).toBeTruthy();
    await view.unmount();
    await renderWithProviders(<VehicleProfile vehicle={{ ...bare, owner: null }} onBack={jest.fn()} />);
    expect(text('VEH-01.heroEmpty')).toHaveTextContent('Noch keine FotosFür dieses Fahrzeug gibt es noch keine Bilder.');
  });

  it('shows Technik as spec tables with provenance under measured values', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.tabs.specs'));
    expect(text('VEH-01.panel.specs')).toBeTruthy();
    expect(text('VEH-01.spec.power.value')).toHaveTextContent('500 PS (368 kW)');
    expect(text('VEH-01.spec.power.provenance')).toHaveTextContent('Gemessen');
    expect(screen.queryByTestId('VEH-01.spec.make.provenance')).toBeNull();
    expect(text('VEH-01.tabs.specs').props.accessibilityState.selected).toBe(true);
  });

  it('groups Mods by category with glyph and count, opens VEH-02 and ends with the owner disclaimer', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.tabs.mods'));
    expect(text('VEH-01.mods.exhaust')).toHaveTextContent(/^Abgasanlage\s3/);
    expect(text('VEH-01.legalDisclaimer')).toHaveTextContent('Angaben des Besitzers, keine rechtliche Prüfung');
    // ADR-153: no legal status in Phase 1, even where an answer still carries a label.
    for (const label of ['Teilegutachten', 'Nicht erforderlich', 'Einzelabnahme', 'Unbekannt']) expect(screen.queryByText(label)).toBeNull();
    const wheels = R34.mods.groups[0]!.items[0]!;
    await fireEvent.press(text(`VEH-01.mod.${wheels.id}.body`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${SLUG}/mods/${wheels.id}`);
  });

  it('shows a stated legal status as the mod row’s second pill with the disclaimer, never "Unbekannt" (sig.mod_legal_status, M2.8)', async () => {
    const client = newQueryClient();
    client.setQueryData(appConfigKey, {
      config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, 'sig.mod_legal_status': true } },
      confirmed: true,
    });
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />, client);
    // Übersicht: the highlight with a Teilegutachten carries the pill, and the highlights end with the owner disclaimer.
    const highlight = R34.highlights.findIndex((mod) => mod.legal_status === 'parts_certificate');
    expect(text(`VEH-01.highlight.${highlight}.legalStatus`)).toHaveTextContent('Teilegutachten');
    expect(text('VEH-01.highlights.legalDisclaimer')).toHaveTextContent('Angaben des Besitzers, keine rechtliche Prüfung');
    // The value line no longer carries the label.
    expect(screen.queryByText(/· Teilegutachten/)).toBeNull();
    await fireEvent.press(text('VEH-01.tabs.mods'));
    const stated = R34.mods.groups.flatMap((group) => group.items).filter((mod) => mod.legal_status === 'individual_approval');
    for (const mod of stated) expect(text(`VEH-01.mod.${mod.id}.legalStatus`)).toHaveTextContent('Einzelabnahme');
    expect(screen.queryByText('Unbekannt')).toBeNull();
    expect(text('VEH-01.legalDisclaimer')).toBeTruthy();
  });

  it('leaves the disclaimer out of an empty mod list, as WEB-01 does (ADR-153)', async () => {
    await renderWithProviders(<VehicleProfile vehicle={{ ...R34, mods: { ...R34.mods, count: 0, groups: [] } }} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.tabs.mods'));
    expect(text('VEH-01.modsEmpty')).toHaveTextContent('Noch keine Mods eingetragen.');
    expect(screen.queryByTestId('VEH-01.legalDisclaimer')).toBeNull();
  });

  it('shows Verlauf by month and opens VEH-05', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.tabs.history'));
    expect(text('VEH-01.month.0')).toHaveTextContent(/^Mai 2026Notiz/);
    expect(text('VEH-01.month.3')).toHaveTextContent(/^März 2023/);
    const brakes = R34.updates[1]!;
    expect(text(`VEH-01.update.${brakes.id}`)).toHaveTextContent(/Bremsen/);
    await fireEvent.press(text(`VEH-01.update.${brakes.id}`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${SLUG}/updates/${brakes.id}`);
    expect(screen.queryByTestId('VEH-01.history.loadOlder')).toBeNull();
  });

  it('loads older entries from the list route on request', async () => {
    const { calls } = stubFetch({
      '/updates': { body: { data: [{ ...R34.updates[0]!, id: 'older', month_label: 'Januar 2022' }], links: {}, meta: { next_cursor: null, per_page: 30, path: null, prev_cursor: null } } },
    });
    await renderWithProviders(<VehicleProfile vehicle={{ ...R34, updates_count: 8 }} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.tabs.history'));
    expect(text('VEH-01.history.loadOlder')).toHaveTextContent('1 älteren Eintrag laden');
    await fireEvent.press(text('VEH-01.history.loadOlder'));
    await waitFor(() => expect(text('VEH-01.update.older')).toBeTruthy());
    expect(new URL(calls[0]!.url).search).toBe('?per_page=30');
    expect(screen.queryByTestId('VEH-01.history.loadOlder')).toBeNull();
  });

  it('opens the viewer on the hero photo and on a preview tile', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.hero.0'));
    expect(await screen.findByTestId('VEH-04.viewer.counter')).toHaveTextContent('1/3');
    await fireEvent.press(text('VEH-04.viewer.close'));
    await waitFor(() => expect(screen.queryByTestId('VEH-04.viewer')).toBeNull());
    await fireEvent.press(text('VEH-01.photoPreview.tile.1'));
    expect(await screen.findByTestId('VEH-04.viewer.counter')).toHaveTextContent('3/3');
  });

  it('shares the canonical page and copies it from the more sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.share'));
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: R34.canonical_url })));
    await fireEvent.press(text('VEH-01.moreActions'));
    expect(screen.queryByTestId('VEH-01.moreSheet.garage')).toBeNull();
    await fireEvent.press(await screen.findByTestId('VEH-01.moreSheet.copyLink'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(R34.canonical_url));
  });

  it('gives the owner the way to the garage and the QR code instead of follow and message', async () => {
    signIn();
    const own = { ...R34, is_owner: true, qr: { code: '8TR0Q3MC', url: 'https://speedclub.test/C/8TR0Q3MC' }, owner: { ...R34.owner!, is_self: true } };
    await renderWithProviders(<VehicleProfile vehicle={own} onBack={jest.fn()} />);
    expect(screen.queryByTestId('VEH-01.ownerRow.follow')).toBeNull();
    await fireEvent.press(text('VEH-01.moreActions'));
    await fireEvent.press(await screen.findByTestId('VEH-01.moreSheet.qr'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/qr/${R34.id}`);
  });

  it('renders the slots GAR-02 fills', async () => {
    const { Text } = jest.requireActual<typeof import('@/ui')>('@/ui');
    signIn();
    await renderWithProviders(
      <VehicleProfile
        vehicle={{ ...R34, is_owner: true }}
        routeId="GAR-02"
        onBack={jest.fn()}
        ownerToolbar={<Text testID="toolbar">Bearbeiten</Text>}
        ownerContent={<Text testID="hints">Noch 3 Angaben</Text>}
      />,
    );
    expect(text('GAR-02.ownerToolbar')).toHaveTextContent('Bearbeiten');
    expect(text('GAR-02.panel.overview')).toHaveTextContent(/^Noch 3 Angaben/);
    expect(text('GAR-02.title')).toHaveTextContent('Skyline GT-R R34');
  });
});

describe('VEH-01 route states', () => {
  it('loads the page for the slug and shows it', async () => {
    const { calls } = stubFetch({ [`/public/vehicles/${SLUG}`]: { body: { data: R34 } } });
    await renderWithProviders(<VehicleScreen />);
    expect(await screen.findByTestId('VEH-01.title')).toHaveTextContent('Skyline GT-R R34');
    expect(new URL(calls[0]!.url).pathname).toBe(`/api/v1/public/vehicles/${SLUG}`);
  });

  it('answers every hidden vehicle with one calm state and no reason', async () => {
    stubFetch({ '/public/vehicles/toyota-gr86-zn8-6g12gv4h': { status: 404, body: { message: 'Fahrzeug nicht verfügbar.', code: 'vehicle_unavailable', errors: {} } } });
    mockParams.slug = 'toyota-gr86-zn8-6g12gv4h';
    await renderWithProviders(<VehicleScreen />);
    expect(await screen.findByTestId('VEH-01.unavailable')).toHaveTextContent(
      'Fahrzeug nicht verfügbarEs wurde entfernt oder ist gerade nicht öffentlich.Builds entdecken',
    );
    // DQ-226: an action that leaves the page is Secondary.
    expect(visualOf('VEH-01.unavailable.action').backgroundColor).toBe(themes.carbon.color.bg.raised);
    await fireEvent.press(text('VEH-01.unavailable.action'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/discover');
  });

  it('offers a retry after a server error', async () => {
    let fail = true;
    stubFetch({ [`/public/vehicles/${SLUG}`]: () => (fail ? { status: 500, body: { message: 'Fehler', code: 'server' } } : { body: { data: R34 } }) });
    await renderWithProviders(<VehicleScreen />);
    // A 5xx is retried twice (1 s, then 2 s) before the state shows.
    expect(await screen.findByTestId('VEH-01.error', {}, { timeout: 6000 })).toHaveTextContent(/Das Fahrzeug konnte nicht geladen werden/);
    fail = false;
    await fireEvent.press(text('VEH-01.error.action'));
    expect(await screen.findByTestId('VEH-01.title')).toBeTruthy();
  }, 15000);

  it('moves an old slug to the canonical one', async () => {
    stubFetch({ '/public/vehicles/nissan-alt-5tf974vj': { body: { data: R34 } } });
    mockParams.slug = 'nissan-alt-5tf974vj';
    await renderWithProviders(<VehicleScreen />);
    await waitFor(() => expect(mockRouter.setParams).toHaveBeenCalledWith({ slug: SLUG }));
  });

  it('opens the tab named in the URL and writes the chosen one back', async () => {
    stubFetch({ [`/public/vehicles/${SLUG}`]: { body: { data: R34 } } });
    mockParams.tab = 'history';
    await renderWithProviders(<VehicleScreen />);
    expect(await screen.findByTestId('VEH-01.panel.history')).toBeTruthy();
    await fireEvent.press(text('VEH-01.tabs.overview'));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ tab: undefined });
  });
});
