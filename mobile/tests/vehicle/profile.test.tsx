import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import type { ReactNode } from 'react';
import { Share } from 'react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { VehicleScreen } from '@/features/vehicle/screens/VehicleScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, themes } from '@/theme';
import { vehicleTitleText } from '@/ui/textBreaks';

import { R34 } from './fixtures';
import { visualOf } from '../ui/helpers';
import { newQueryClient, renderWithProviders, stubFetch } from './harness';

/** DQ-802: the title is set as a car name, so "GT-R" carries its word joiner on native (web keeps it whole with a span). */
const R34_TITLE = vehicleTitleText('Skyline GT-R R34');

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
// Rows render in place: virtualisation needs a layout Jest does not have. The handle answers every row 1000 high, so a section's
// top is its row index × 1000 (stage 0, summary 1, index 2, Überblick 3, Daten 4, Mods 5, …).
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown) => string;
  horizontal?: boolean;
  ListFooterComponent?: ReactNode;
  onLayout?: (event: { nativeEvent: { layout: { height: number } } }) => void;
  onContentSizeChange?: (width: number, height: number) => void;
};
const mockList: { props: MockListProps | null; scrollToOffset: jest.Mock; scrollToIndex: jest.Mock } = {
  props: null,
  scrollToOffset: jest.fn(),
  scrollToIndex: jest.fn(() => Promise.resolve()),
};
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({
      scrollToOffset: mockList.scrollToOffset,
      scrollToIndex: mockList.scrollToIndex,
      getLayout: (index: number) => ({ x: 0, y: index * 1000, width: 390, height: 1000 }),
      getFirstItemOffset: () => 0,
      getScrollableNode: () => null,
    }));
    if (!props.horizontal) mockList.props = props;
    const items = props.data.map((item, index) => createElement(Fragment, { key: props.keyExtractor ? props.keyExtractor(item) : index }, props.renderItem({ item, index })));
    return createElement(Fragment, null, items, props.ListFooterComponent);
  });
  return { FlashList };
});
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
    expect(text('VEH-01.title')).toHaveTextContent(R34_TITLE);
    expect(text('VEH-01.subline')).toHaveTextContent('2002 · 2,6 l R6 Biturbo (RB26DETT) · Bayside Blue');
    expect(text('VEH-01.specStrip')).toHaveTextContent('Leistung500PSPrüfstandDrehmoment540NmPrüfstandBaujahr2002AntriebAWD');
    // DQ-1047: the owner is a chip on the hero (avatar 32 + @handle); Folgen, Speichern, Teilen, Nachricht are the action row.
    expect(text('VEH-01.ownerRow')).toHaveTextContent('LS@lukas.sc', { exact: true });
    expect(text('VEH-01.actions')).toHaveTextContent('FolgenTeilenNachricht');
    // Parity (parity/compare.mjs folds white space only): no invisible break in the name, the handle or the city, so the
    // handle's "." carries no zero-width space (handleText / identifierText are not for this row), no word joiner, no soft hyphen.
    const ownerTexts = within(text('VEH-01.ownerRow'))
      .getAllByText(/./, { includeHiddenElements: true })
      .flatMap((node) => [node.props.children].flat())
      .filter((child): child is string => typeof child === 'string');
    expect(ownerTexts).toEqual(expect.arrayContaining(['@lukas.sc']));
    expect(ownerTexts.join('')).not.toMatch(/[​⁠­]/);
    // Parity regions sit in the order of WEB-01: the identity on the hero (DQ-1047), then the strip on the canvas.
    const ids = screen.getAllByTestId(/^VEH-01\.(hero|title|specStrip|ownerRow)$/).map((node) => node.props.testID as string);
    expect(ids).toEqual(['VEH-01.hero', 'VEH-01.title', 'VEH-01.ownerRow', 'VEH-01.specStrip']);
    // The identity sits on the hero's stage (DQ-1047), the strip under it.
    expect(within(text('VEH-01.stage')).getByTestId('VEH-01.title')).toBeTruthy();
    // The section index's name is WEB-01's nav label (public.vehicle.nav_label), word for word.
    expect(text('VEH-01.sections').props['aria-label']).toBe('Abschnitte');
  });

  it('opens Überblick with the description, Galerie with the 3-up wall, and ends with the guest line (DQ-1057)', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    expect(text('VEH-01.section.overview.title')).toHaveTextContent('Überblick');
    expect(text('VEH-01.description')).toHaveTextContent(/^Skyline GT-\u2060R V-\u2060Spec II aus Japan/);
    expect(text('VEH-01.photoPreview.header.action')).toHaveTextContent('Alle Fotos');
    expect(screen.getByLabelText('Alle Fotos (3)')).toBeTruthy();
    expect(screen.getByTestId('VEH-01.photoPreview.tile.0')).toBeTruthy();
    expect(text('VEH-01.closingOwner')).toHaveTextContent(/^Melde dich an, um Lukas Scholz zu schreiben\./);
  });

  it('sends a guest to the auth-required sheet and back here, from the action row and the owner card', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.actions.follow'));
    expect(useSessionStore.getState()).toMatchObject({ promptOpen: true, intent: { returnTo: `/v/${SLUG}` } });
    await act(() => useSessionStore.setState({ promptOpen: false, intent: null }));
    await fireEvent.press(text('VEH-01.closingMessage'));
    expect(useSessionStore.getState().promptOpen).toBe(true);
  });

  it('lets a member follow the owner (M2.1) and write about this vehicle (M2.4)', async () => {
    signIn();
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    expect(text('VEH-01.ownerRow')).toBeTruthy();
    // Without the build-follow flag "Folgen" follows the owner, as in M2.1; it is the one filled control.
    expect(text('VEH-01.actions.follow')).toHaveTextContent('Folgen');
    await fireEvent.press(text('VEH-01.actions.message'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/new-message', params: { to: 'lukas.sc', about: R34.slug } });
  });

  it('shows a member no Nachricht when the owner does not take messages from them', async () => {
    signIn();
    const closed = { ...R34, owner: R34.owner ? { ...R34.owner, can_message: false } : null };
    await renderWithProviders(<VehicleProfile vehicle={closed} onBack={jest.fn()} />);
    expect(text('VEH-01.actions.follow')).toBeTruthy();
    expect(screen.queryByTestId('VEH-01.actions.message')).toBeNull();
  });

  it('leaves the owner out entirely when the owner is hidden (ADR-148)', async () => {
    await renderWithProviders(<VehicleProfile vehicle={{ ...R34, owner: null }} onBack={jest.fn()} />);
    expect(screen.queryByTestId('VEH-01.ownerRow')).toBeNull();
    expect(screen.queryByTestId('VEH-01.closingOwner')).toBeNull();
  });

  it('designs the photo-less hero as the empty stage and names the owner under it (DQ-1211)', async () => {
    const bare = { ...R34, photos: [], cover: null, photo_count: 0, is_owner: false };
    const view = await renderWithProviders(<VehicleProfile vehicle={bare} onBack={jest.fn()} />);
    // WEB-01's stage photo with the identity on its scrim, never a grey glyph box.
    expect(screen.getByTestId('VEH-01.stagePhoto')).toBeTruthy();
    expect(screen.getByTestId('VEH-01.stage')).toBeTruthy();
    expect(text('VEH-01.heroEmpty')).toHaveTextContent('Noch keine Fotos. @lukas.sc hat für dieses Fahrzeug noch keine Bilder hochgeladen.');
    expect(screen.queryByTestId('VEH-01.photoCount')).toBeNull();
    expect(screen.queryByTestId('VEH-01.addPhotos')).toBeNull();
    expect(screen.getByTestId('VEH-01.header')).toBeTruthy();
    await view.unmount();
    const anonymous = await renderWithProviders(<VehicleProfile vehicle={{ ...bare, owner: null }} onBack={jest.fn()} />);
    expect(text('VEH-01.heroEmpty')).toHaveTextContent('Noch keine Fotos. Für dieses Fahrzeug gibt es noch keine Bilder.');
    await anonymous.unmount();
    // The owner gets the one way to add them.
    await renderWithProviders(<VehicleProfile vehicle={{ ...bare, is_owner: true }} onBack={jest.fn()} />);
    expect(text('VEH-01.heroEmpty')).toHaveTextContent('Noch keine Fotos. Zeig deinen Build mit dem ersten Foto.');
    expect(screen.getByTestId('VEH-01.addPhotos')).toBeTruthy();
  });

  it('shows Daten as six key specs and opens every spec table in place (10 §5.7)', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    const keys = screen.getAllByTestId(/^VEH-01\.keySpec\.[a-z_]+$/).map((node) => node.props.testID as string);
    expect(keys).toEqual(['engine_text', 'engine_code', 'displacement_cc', 'aspiration', 'gearbox', 'drivetrain'].map((key) => `VEH-01.keySpec.${key}`));
    expect(text('VEH-01.keySpec.engine_code.value')).toHaveTextContent('RB26DETT');
    expect(screen.queryByTestId('VEH-01.spec.power.value')).toBeNull();
    expect(text('VEH-01.specs.toggle')).toHaveTextContent('Alle Daten anzeigen');
    expect(text('VEH-01.specs.toggle').props.accessibilityState.expanded).toBe(false);
    await fireEvent.press(text('VEH-01.specs.toggle'));
    expect(text('VEH-01.specs.all')).toBeTruthy();
    expect(text('VEH-01.spec.power.value')).toHaveTextContent('500 PS (368 kW)');
    expect(text('VEH-01.spec.power.provenance')).toHaveTextContent('Prüfstand');
    expect(screen.queryByTestId('VEH-01.spec.make.provenance')).toBeNull();
    expect(text('VEH-01.specs.toggle')).toHaveTextContent('Weniger Daten anzeigen');
    expect(text('VEH-01.specs.toggle').props.accessibilityState.expanded).toBe(true);
    await fireEvent.press(text('VEH-01.specs.toggle'));
    expect(screen.queryByTestId('VEH-01.specs.all')).toBeNull();
  });

  it('groups Mods by category with glyph and count, opens VEH-02 and ends with the owner disclaimer', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    // The planned Tomei Expreme Ti is in Pläne now (contract §3): Abgasanlage counts the two that are or were built.
    expect(text('VEH-01.mods.exhaust')).toHaveTextContent(/^Abgasanlage\s2/);
    expect(text('VEH-01.section.mods.title')).toHaveTextContent('Mods\u00A013');
    expect(within(text('VEH-01.buildSheet')).queryByText('Tomei Expreme Ti')).toBeNull();
    expect(within(text('VEH-01.plans')).getByText('Tomei Expreme Ti')).toBeTruthy();
    expect(text('VEH-01.legalDisclaimer')).toHaveTextContent('Angaben des Besitzers, keine rechtliche Prüfung');
    // ADR-153: no legal status in Phase 1, even where an answer still carries a label.
    for (const label of ['Teilegutachten', 'Eintragungsfrei', 'Einzelabnahme', 'Unbekannt']) expect(screen.queryByText(label)).toBeNull();
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
    // The mod with a Teilegutachten carries the pill; the value line no longer carries the label.
    const certified = R34.mods.groups.flatMap((group) => group.items).find((mod) => mod.legal_status === 'parts_certificate');
    if (certified) expect(text(`VEH-01.mod.${certified.id}.legalStatus`)).toHaveTextContent('Teilegutachten');
    expect(screen.queryByText(/· Teilegutachten/)).toBeNull();
    const stated = R34.mods.groups.flatMap((group) => group.items).filter((mod) => mod.legal_status === 'individual_approval');
    // M5.9c (contract §1): a status meaning "in the papers" (registered, individual approval) reads as the quiet "TÜV-eingetragen".
    for (const mod of stated) expect(text(`VEH-01.mod.${mod.id}.legalStatus`)).toHaveTextContent('TÜV-eingetragen');
    expect(screen.queryByText('Unbekannt')).toBeNull();
    expect(text('VEH-01.legalDisclaimer')).toBeTruthy();
  });

  it('leaves the disclaimer out of an empty mod list, as WEB-01 does (ADR-153)', async () => {
    await renderWithProviders(<VehicleProfile vehicle={{ ...R34, mods: { ...R34.mods, count: 0, groups: [] } }} onBack={jest.fn()} />);
    expect(text('VEH-01.modsEmpty')).toHaveTextContent('Noch keine Mods eingetragen.');
    expect(screen.queryByTestId('VEH-01.legalDisclaimer')).toBeNull();
  });

  it('shows the latest three entries of Verlauf, opens VEH-05 and leads to VEH-08 for the rest (10 §5.10)', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    expect(text('VEH-01.month.0')).toHaveTextContent(/^Mai 2026Notiz/);
    expect(screen.queryByTestId('VEH-01.month.3')).toBeNull();
    const shown = R34.updates.slice(0, 3).map((update) => update.id);
    for (const id of shown) expect(text(`VEH-01.update.${id}`)).toBeTruthy();
    expect(screen.queryByTestId(`VEH-01.update.${R34.updates[3]!.id}`)).toBeNull();
    const brakes = R34.updates[1]!;
    expect(text(`VEH-01.update.${brakes.id}`)).toHaveTextContent(/Bremsen/);
    await fireEvent.press(text(`VEH-01.update.${brakes.id}`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${SLUG}/updates/${brakes.id}`);
    expect(text('VEH-01.history.showAll')).toHaveTextContent('Ganzen Verlauf anzeigen (7)');
    await fireEvent.press(text('VEH-01.history.showAll'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/v/[slug]/history', params: { slug: SLUG } });
  });

  it('leaves "Ganzen Verlauf anzeigen" out while the three are all there is', async () => {
    await renderWithProviders(<VehicleProfile vehicle={{ ...R34, updates: R34.updates.slice(0, 2), updates_count: 2 }} onBack={jest.fn()} />);
    expect(screen.queryByTestId('VEH-01.history.showAll')).toBeNull();
  });

  it('opens the viewer on the hero photo and on a preview tile', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.hero.0'));
    expect(await screen.findByTestId('VEH-04.viewer.counter')).toHaveTextContent('1/3');
    await fireEvent.press(text('VEH-04.viewer.close'));
    await waitFor(() => expect(screen.queryByTestId('VEH-04.viewer')).toBeNull());
    // DQ-1078: a build with three photos shows all three in the 3-up row, so tile 1 is the second photo.
    await fireEvent.press(text('VEH-01.photoPreview.tile.1'));
    expect(await screen.findByTestId('VEH-04.viewer.counter')).toHaveTextContent('2/3');
  });

  it('shares the share_url (?via=share) and copies it from the more sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.share'));
    // M5.7 (m5.7-contract §2.4): the share sheet and the copied link use `share_url` (`?via=share`).
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://localhost:8080/v/nissan-skyline-gt-r-r34-5tf974vj?via=share' })));
    await fireEvent.press(text('VEH-01.moreActions'));
    expect(screen.queryByTestId('VEH-01.moreSheet.garage')).toBeNull();
    await fireEvent.press(await screen.findByTestId('VEH-01.moreSheet.copyLink'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('http://localhost:8080/v/nissan-skyline-gt-r-r34-5tf974vj?via=share'));
  });

  it('gives the owner the way to the garage and the QR code instead of follow and message', async () => {
    signIn();
    const own = { ...R34, is_owner: true, qr: { code: '8TR0Q3MC', url: 'https://speedclub.test/C/8TR0Q3MC' }, owner: { ...R34.owner!, is_self: true } };
    await renderWithProviders(<VehicleProfile vehicle={own} onBack={jest.fn()} />);
    expect(screen.queryByTestId('VEH-01.ownerRow.follow')).toBeNull();
    await fireEvent.press(text('VEH-01.moreActions'));
    await fireEvent.press(await screen.findByTestId('VEH-01.moreSheet.qr'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/stickers/${R34.id}`);
  });

  it('renders the slots GAR-02 fills (DQ-1062: its capsule instead of a toolbar)', async () => {
    const { Text } = jest.requireActual<typeof import('@/ui')>('@/ui');
    signIn();
    const edit = jest.fn();
    await renderWithProviders(
      <VehicleProfile
        vehicle={{ ...R34, is_owner: true }}
        routeId="GAR-02"
        onBack={jest.fn()}
        capsule={{ actions: [{ key: 'edit', icon: 'pencil-simple', label: 'Bearbeiten', onPress: edit, testID: 'GAR-02.tool.edit' }], more: [] }}
        ownerContent={<Text testID="hints">Noch 3 Angaben</Text>}
      />,
    );
    await fireEvent.press(text('GAR-02.tool.edit'));
    expect(edit).toHaveBeenCalled();
    expect(text('GAR-02.ownerCapsule.primary')).toHaveTextContent('Update posten');
    expect(text('GAR-02.section.overview')).toHaveTextContent(/^ÜberblickNoch 3 Angaben/);
    expect(text('GAR-02.title')).toHaveTextContent(R34_TITLE);
  });
});

describe('VEH-01 route states', () => {
  it('loads the page for the slug and shows it', async () => {
    const { calls } = stubFetch({ [`/public/vehicles/${SLUG}`]: { body: { data: R34 } } });
    await renderWithProviders(<VehicleScreen />);
    expect(await screen.findByTestId('VEH-01.title')).toHaveTextContent(R34_TITLE);
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

  it('opens a 2.0 link\'s tab as the section it names and never writes the section in view to the URL (ADR-505)', async () => {
    stubFetch({ [`/public/vehicles/${SLUG}`]: { body: { data: R34 } } });
    mockParams.tab = 'history';
    await renderWithProviders(<VehicleScreen />);
    expect(await screen.findByTestId('VEH-01.section.history')).toBeTruthy();
    // Once the list has laid out, it jumps to Verlauf without motion (row 7: stage, summary, index, Überblick, Daten, Mods, Pläne).
    await act(() => {
      mockList.props?.onLayout?.({ nativeEvent: { layout: { height: 800 } } });
      mockList.props?.onContentSizeChange?.(390, 20000);
    });
    await waitFor(() => expect(mockList.scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 7, animated: false })));
    expect(mockRouter.setParams).not.toHaveBeenCalledWith(expect.objectContaining({ tab: expect.anything() }));
  });
});
