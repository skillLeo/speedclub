/**
 * CF-6 and R5-2e VEH-07 2.0: the share card customiser — choices, options ⇄ query (template, theme, photo, crop, show, text), the
 * default, the customiser's sections, and the screen: states, the 422 on `text`, "Speichern" into the photo library.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { memberSettingsKey } from '@/api/queries/settings';
import type { PublicVehicle } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';
import { ShareCardCustomiser } from '@/features/vehicle/components/ShareCardCustomiser';
import { ShareCardScreen } from '@/features/vehicle/screens/ShareCardScreen';
import {
  defaultShareCardOptions,
  effectiveCrop,
  isDefaultShareCard,
  shareCardChoices,
  shareCardSearch,
  shareCardTextProblem,
  toggleShareCardElement,
  withPhoto,
  type ShareCardOptions,
  type ShareCardSource,
} from '@/features/vehicle/shareCardOptions';
import { shareCardOnWeb } from '@/features/vehicle/shareCard';
import * as platform from '@/lib/platform';
import { toast } from '@/ui/toast';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, stubFetch } from '../settings/harness';

type Media = components['schemas']['MediaResource'];

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { vehicleId?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), getParent: () => undefined, getState: () => undefined }),
  usePathname: () => '/share-card',
  // StickyCTABar reports its height while focused; a test screen is always focused.
  useFocusEffect: (effect: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
  router: { push: jest.fn() },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('token-1')) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));
const mockDownloadFile = jest.fn((_url: string, target: { uri: string }) => Promise.resolve({ uri: target.uri }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}${name}`;
    }
    static downloadFileAsync(url: string, target: { uri: string }): Promise<{ uri: string }> {
      return mockDownloadFile(url, target);
    }
  },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: () => Promise.resolve(true), shareAsync: jest.fn(() => Promise.resolve()) }));
type Permission = { granted: boolean; canAskAgain: boolean; status: string };
const mockGetPermissions = jest.fn<Promise<Permission>, [boolean?]>(() => Promise.resolve({ granted: false, canAskAgain: true, status: 'undetermined' }));
const mockRequestPermissions = jest.fn<Promise<Permission>, [boolean?]>(() => Promise.resolve({ granted: true, canAskAgain: true, status: 'granted' }));
const mockCreateAsset = jest.fn<Promise<{ id: string }>, [string]>(() => Promise.resolve({ id: 'asset-1' }));
jest.mock('expo-media-library', () => ({
  getPermissionsAsync: (writeOnly?: boolean) => mockGetPermissions(writeOnly),
  requestPermissionsAsync: (writeOnly?: boolean) => mockRequestPermissions(writeOnly),
  Asset: { create: (uri: string) => mockCreateAsset(uri) },
}));
jest.mock('@/ui/toast', () => ({ ...jest.requireActual('@/ui/toast'), toast: jest.fn(() => 1) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const VEHICLE = '01m6f7zv1vs5e2xw9a96cbqzyp';

function media(id: string, extra: Partial<Media> = {}): Media {
  return {
    id,
    status: 'ready',
    category: 'exterior',
    width: 1600,
    height: 2000,
    blurhash: null,
    thumbhash: null,
    focal_x: null,
    focal_y: null,
    alt: null,
    sort: 0,
    variants: [{ width: 400, url: `https://cdn.test/${id}-400.jpg` }],
    created_at: null,
    ...extra,
  } as Media;
}

const MODS = { count: 2, groups: [{ items: [{ status: 'installed' }, { status: 'planned' }] }] };

function source(extra: Partial<ShareCardSource> = {}): ShareCardSource {
  return {
    build_score: { total: 642, stage: 4 },
    dex_number: 87,
    spec_strip: [{ value: '510' }, { value: null }],
    mods: MODS,
    owner: { username: 'lukas.sc' },
    is_owner: false,
    cover: media('01cover', { focal_x: 0.5, focal_y: 0.3 }),
    photos: [media('01cover', { focal_x: 0.5, focal_y: 0.3 }), media('01side'), media('01busy', { status: 'processing' })],
    ...extra,
  };
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  useSessionStore.setState({ status: 'member' });
});

describe('choices', () => {
  it('offers only what the build has, and the ready photos with the cover first', () => {
    const choices = shareCardChoices(source(), null);
    expect(choices.elements).toEqual(['score', 'dex', 'specs', 'mods', 'username', 'qr']);
    expect(choices.photos.map((photo) => photo.id)).toEqual(['01cover', '01side']);
    expect(choices.coverId).toBe('01cover');
    const bare = shareCardChoices(source({ build_score: null, dex_number: null, spec_strip: [{ value: null }], mods: null }), null);
    expect(bare.elements).toEqual(['username', 'qr']);
  });

  it('offers Mods only for a fitted part: planned rows are not part of the build', () => {
    const planned = { count: 1, groups: [{ items: [{ status: 'planned' }] }] };
    expect(shareCardChoices(source({ mods: planned }), null).elements).not.toContain('mods');
    expect(shareCardChoices(source({ mods: { count: 0, groups: [] } }), null).elements).not.toContain('mods');
  });

  it('leaves @username out when the owner does not show themselves', () => {
    // Somebody else's view: the page has no owner then (ADR-148 a).
    expect(shareCardChoices(source({ owner: null }), null).elements).not.toContain('username');
    // The owner's own view always names them: their setting decides.
    expect(shareCardChoices(source({ is_owner: true }), false).elements).not.toContain('username');
    expect(shareCardChoices(source({ is_owner: true }), true).elements).toContain('username');
    // Settings not read yet: the page named them, so the chip shows.
    expect(shareCardChoices(source({ is_owner: true }), null).elements).toContain('username');
  });
});

describe('options → query', () => {
  const choices = shareCardChoices(source(), null);
  const story = defaultShareCardOptions('story');

  it('the default is the stored card: only the format, and Mods stay off', () => {
    expect(story.show).not.toContain('mods');
    expect(isDefaultShareCard(story, choices)).toBe(true);
    expect(shareCardSearch(story, choices)).toBe('format=story');
    // The cover chosen by hand is still the default, and so is its untouched crop.
    expect(isDefaultShareCard({ ...story, photo: '01cover' }, choices)).toBe(true);
    expect(isDefaultShareCard({ ...story, crop: { zoom: 1, x: 0.5, y: 0.3 } }, choices)).toBe(true);
    // The story band has no theme; spaces alone are no own line.
    expect(isDefaultShareCard({ ...story, theme: 'light', text: '   ' }, choices)).toBe(true);
    expect(shareCardSearch({ ...story, theme: 'light' }, choices)).toBe('format=story');
  });

  it('a template: poster is always dark, frame takes the theme on both formats, band on the square only', () => {
    expect(shareCardSearch({ ...story, template: 'poster', theme: 'light' }, choices)).toBe('format=story&template=poster');
    expect(shareCardSearch({ ...story, template: 'frame', theme: 'light' }, choices)).toBe('format=story&template=frame&theme=light');
    expect(shareCardSearch({ ...defaultShareCardOptions('square'), theme: 'light' }, choices)).toBe('format=square&theme=light');
    expect(isDefaultShareCard({ ...story, template: 'poster' }, choices)).toBe(false);
  });

  it('a crop: zoom with two decimals, the centre with three, only once moved', () => {
    const zoomed: ShareCardOptions = { ...story, crop: { zoom: 2, x: 0.5, y: 0.3 } };
    expect(isDefaultShareCard(zoomed, choices)).toBe(false);
    expect(shareCardSearch(zoomed, choices)).toBe('format=story&zoom=2.00&x=0.5&y=0.3');
    // A 4:5 photo in a 9:16 box can move sideways at zoom 1, not up or down: x goes, zoom stays out.
    const moved: ShareCardOptions = { ...story, crop: { zoom: 1, x: 0, y: 0 } };
    expect(effectiveCrop(moved, choices)?.crop).toEqual({ zoom: 1, x: 0.352, y: 0.5 });
    expect(shareCardSearch(moved, choices)).toBe('format=story&x=0.352&y=0.5');
  });

  it('another photo starts from its own default crop', () => {
    const next = withPhoto({ ...story, crop: { zoom: 3, x: 0.1, y: 0.1 } }, '01side');
    expect(next.crop).toBeNull();
    expect(shareCardSearch(next, choices)).toBe('format=story&photo=01side');
  });

  it('elements comma-separated, Mods on is a custom card, nothing on is an empty show=', () => {
    const square = { ...defaultShareCardOptions('square'), photo: '01side', theme: 'light' as const };
    const custom = toggleShareCardElement(toggleShareCardElement(square, 'dex'), 'username');
    expect(new URLSearchParams(shareCardSearch(custom, choices)).toString()).toBe('format=square&theme=light&photo=01side&show=score%2Cspecs%2Cqr');
    const mods = toggleShareCardElement(story, 'mods');
    expect(isDefaultShareCard(mods, choices)).toBe(false);
    expect(shareCardSearch(mods, choices)).toBe('format=story&show=score%2Cdex%2Cspecs%2Cmods%2Cusername%2Cqr');
    let none = story;
    for (const element of ['score', 'dex', 'specs', 'username', 'qr'] as const) none = toggleShareCardElement(none, element);
    expect(shareCardSearch(none, choices)).toBe('format=story&show=');
  });

  it('the own line goes trimmed, and only when the card fonts can draw it', () => {
    expect(shareCardSearch({ ...story, text: '  Saisonstart am Ring – 2027 ' }, choices)).toBe(`format=story&text=${encodeURIComponent('Saisonstart am Ring – 2027').replace(/%20/g, '+')}`);
    expect(shareCardTextProblem('Grüße aus Köln „Treffen“ …')).toBeNull();
    expect(shareCardTextProblem('Bester Tag 🏁')).toBe('shareCard.textChars');
    expect(shareCardTextProblem('Zeile\nzwei')).toBe('shareCard.textChars');
    expect(shareCardTextProblem('x'.repeat(61))).toBe('shareCard.textLong');
    expect(shareCardSearch({ ...story, text: 'Bester Tag 🏁' }, choices)).toBe('format=story');
  });

  it('every parameter at once, in a stable order', () => {
    const all: ShareCardOptions = { format: 'square', template: 'frame', photo: '01side', crop: { zoom: 1.5, x: 0.4, y: 0.6 }, show: ['score', 'mods', 'qr'], theme: 'light', text: 'Nürburgring' };
    expect([...new URLSearchParams(shareCardSearch(all, choices)).keys()]).toEqual(['format', 'template', 'theme', 'photo', 'zoom', 'x', 'y', 'show', 'text']);
  });

  it('a toggle keeps the server order', () => {
    const off = toggleShareCardElement(story, 'score');
    expect(toggleShareCardElement(off, 'score').show).toEqual(['score', 'dex', 'specs', 'username', 'qr']);
    expect(toggleShareCardElement(story, 'mods').show).toEqual(['score', 'dex', 'specs', 'mods', 'username', 'qr']);
  });
});

describe('ShareCardCustomiser', () => {
  const choices = shareCardChoices(source({ dex_number: null }), null);

  /** R7-4b: the customiser hands over updates; `onChange` sees what each makes of the rendered options. */
  function customiser(options: ShareCardOptions, onChange = jest.fn(), extra: { textError?: string | null; isDefault?: boolean } = {}) {
    return renderScreen(
      <ShareCardCustomiser
        options={options}
        choices={choices}
        onChange={(update) => onChange(update(options))}
        isDefault={extra.isDefault ?? true}
        onReset={jest.fn()}
        username="lukas.sc"
        textError={extra.textError ?? null}
        routeId="VEH-07"
      />,
    );
  }

  it('sections in the order the card is made; a chip per element the build has; the theme only where the template takes one', async () => {
    const onChange = jest.fn();
    await customiser(defaultShareCardOptions('story'), onChange);
    const headings = screen.getAllByRole('heading').map((node) => node.props.children);
    expect(headings).toEqual(['Vorlage', 'Foto', 'Ausschnitt', 'Auf der Karte']);
    // R5DQ-14: the own line has one label, the field's.
    expect(screen.getByTestId('VEH-07.text')).toHaveAccessibleName('Eigener Text');
    expect(screen.queryByText('Deine Zeile auf der Karte')).toBeNull();
    expect(screen.queryByTestId('VEH-07.element.dex')).toBeNull();
    expect(screen.getByTestId('VEH-07.element.mods')).toHaveTextContent('Mods');
    expect(screen.getByTestId('VEH-07.element.mods')).not.toBeChecked();
    expect(screen.getByTestId('VEH-07.element.specs')).toHaveTextContent('Daten');
    expect(screen.getByTestId('VEH-07.element.username')).toHaveTextContent('@lukas.sc');
    expect(screen.queryByTestId('VEH-07.theme')).toBeNull();
    expect(screen.queryByTestId('VEH-07.reset')).toBeNull();
    await fireEvent.press(screen.getByTestId('VEH-07.element.mods'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ show: ['score', 'dex', 'specs', 'mods', 'username', 'qr'] }));
    await fireEvent.press(screen.getByTestId('VEH-07.photo.01side'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ photo: '01side', crop: null }));
  });

  it('the templates are a radio group; a press picks one', async () => {
    const onChange = jest.fn();
    await customiser(defaultShareCardOptions('story'), onChange);
    expect(screen.getByTestId('VEH-07.template')).toHaveProp('role', 'radiogroup');
    expect(screen.getByTestId('VEH-07.template.band')).toBeChecked();
    expect(screen.getByTestId('VEH-07.template.poster')).not.toBeChecked();
    expect(screen.getByTestId('VEH-07.template.frame')).toHaveAccessibleName('Rahmen: Foto im Rahmen, Text darunter');
    await fireEvent.press(screen.getByTestId('VEH-07.template.poster'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ template: 'poster' }));
  });

  it('the crop: + and − zoom in steps of 0.25 within 1 to 3, "Zurücksetzen" only for a moved crop', async () => {
    const onChange = jest.fn();
    await customiser(defaultShareCardOptions('story'), onChange);
    expect(screen.getByTestId('VEH-07.crop.zoomOut')).toBeDisabled();
    expect(screen.getByTestId('VEH-07.crop.reset')).toBeDisabled();
    expect(screen.getByTestId('VEH-07.crop.zoom')).toHaveTextContent('1,0×');
    await fireEvent.press(screen.getByTestId('VEH-07.crop.zoomIn'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ crop: { zoom: 1.25, x: 0.5, y: 0.5 } }));
    await screen.unmount();

    const zoomed = jest.fn();
    await customiser({ ...defaultShareCardOptions('story'), crop: { zoom: 3, x: 0.5, y: 0.3 } }, zoomed, { isDefault: false });
    expect(screen.getByTestId('VEH-07.crop.zoomIn')).toBeDisabled();
    expect(screen.getByTestId('VEH-07.crop.reset')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('VEH-07.crop.reset'));
    expect(zoomed).toHaveBeenLastCalledWith(expect.objectContaining({ crop: null }));
    // The screen reader moves the window with actions.
    await fireEvent(screen.getByTestId('VEH-07.crop'), 'accessibilityAction', { nativeEvent: { actionName: 'moveRight' } });
    expect(zoomed).toHaveBeenLastCalledWith(expect.objectContaining({ crop: expect.objectContaining({ zoom: 3 }) }));
    expect(zoomed.mock.lastCall?.[0].crop.x).toBeGreaterThan(0.5);
  });

  it('R5DQ-02: the crop hint follows the pointer: fingers on touch, arrow keys with a mouse or trackpad', async () => {
    await customiser(defaultShareCardOptions('story'));
    expect(screen.getByText('Zum Verschieben ziehen, zum Zoomen mit zwei Fingern aufziehen oder − und + nutzen.')).toBeTruthy();
    expect(screen.getByTestId('VEH-07.crop').props.accessibilityHint).toBe('Wisch nach oben oder unten für Verschieben und Zoomen.');
    await screen.unmount();

    const fine = jest.spyOn(platform, 'useFinePointer').mockReturnValue(true);
    await customiser(defaultShareCardOptions('story'));
    expect(screen.getByText('Zum Verschieben ziehen oder die Pfeiltasten nutzen, zum Zoomen − und +.')).toBeTruthy();
    expect(screen.getByTestId('VEH-07.crop').props.accessibilityHint).toBe('Pfeiltasten verschieben den Ausschnitt, − und + zoomen.');
    fine.mockRestore();
  });

  it('R5DQ-03: beside the card the stage starts at the left edge and is capped below the preview', async () => {
    await renderScreen(
      <ShareCardCustomiser options={defaultShareCardOptions('square')} choices={choices} onChange={jest.fn()} isDefault onReset={jest.fn()} username={null} maxCropHeight={240} routeId="VEH-07" />,
    );
    const style = Object.assign({}, ...[screen.getByTestId('VEH-07.crop').props.style].flat(Infinity).filter(Boolean)) as { alignSelf?: string; maxWidth?: number };
    expect(style.alignSelf).toBe('flex-start');
    // The square band's box is 1080 × 600: 240 high is 432 wide.
    expect(style.maxWidth).toBeCloseTo(432, 6);
    // The zoom row spans the column, so "Zurücksetzen" stays on the line of − and + under a narrow stage (DQ r2).
    const row = Object.assign({}, ...[screen.getByTestId('VEH-07.crop.controls').props.style].flat(Infinity).filter(Boolean)) as { maxWidth?: number };
    expect(row.maxWidth).toBeUndefined();
    const reset = Object.assign({}, ...[screen.getByTestId('VEH-07.crop.reset').props.style].flat(Infinity).filter(Boolean)) as { marginLeft?: unknown };
    expect(reset.marginLeft).not.toBe('auto');
    await screen.unmount();
    // On the phone it sits at the row's end, under the centred stage.
    await renderScreen(<ShareCardCustomiser options={defaultShareCardOptions('square')} choices={choices} onChange={jest.fn()} isDefault onReset={jest.fn()} username={null} routeId="VEH-07" />);
    const phoneReset = Object.assign({}, ...[screen.getByTestId('VEH-07.crop.reset').props.style].flat(Infinity).filter(Boolean)) as { marginLeft?: unknown };
    expect(phoneReset.marginLeft).toBe('auto');
  });

  it('the own line: a counter, the card fonts checked while typing, the server message on the field', async () => {
    const onChange = jest.fn();
    await customiser(defaultShareCardOptions('story'), onChange);
    expect(screen.getByTestId('VEH-07.text.helper')).toHaveTextContent('0 / 60 Zeichen');
    expect(screen.getByTestId('VEH-07.text')).toHaveProp('maxLength', 60);
    await fireEvent.changeText(screen.getByTestId('VEH-07.text'), 'Bester Tag 🏁');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Bester Tag 🏁' }));
    await waitFor(() => expect(screen.getByTestId('VEH-07.text.error')).toHaveTextContent('Nur Buchstaben, Ziffern und Satzzeichen, keine Emojis.'));
    await screen.unmount();

    await customiser({ ...defaultShareCardOptions('story'), text: 'Freitag am Ring' }, jest.fn(), { textError: 'Dieser Text ist nicht erlaubt.', isDefault: false });
    await waitFor(() => expect(screen.getByTestId('VEH-07.text.error')).toHaveTextContent('Dieser Text ist nicht erlaubt.'));
  });

  it('frame takes the theme on the story too, and "Standard" shows once changed', async () => {
    await customiser({ ...defaultShareCardOptions('story'), template: 'frame', theme: 'light' }, jest.fn(), { isDefault: false });
    expect(screen.getByTestId('VEH-07.theme')).toBeTruthy();
    expect(screen.getByTestId('VEH-07.reset')).toHaveTextContent('Standard wiederherstellen');
  });
});

describe('VEH-07 with the customiser', () => {
  function vehicle(extra: Partial<PublicVehicle> = {}): PublicVehicle {
    return {
      id: VEHICLE,
      full_title: 'Nissan Skyline GT-R R34',
      build_score: { total: 642, stage: 4 },
      dex_number: 87,
      spec_strip: [{ key: 'power', value: '510', unit: 'PS', label: 'Leistung' }],
      mods: MODS,
      owner: { username: 'lukas.sc' },
      is_owner: true,
      cover: media('01cover'),
      photos: [media('01cover'), media('01side')],
      share_card_url: { story: 'https://cdn.test/share/story.png', square: 'https://cdn.test/share/square.png' },
      ...extra,
    } as unknown as PublicVehicle;
  }

  async function open(page: PublicVehicle, settings: Record<string, unknown> = { show_owner_on_qr: true }, answers: Parameters<typeof stubFetch>[0] = {}) {
    mockParams = { vehicleId: VEHICLE };
    stubFetch(answers);
    const client = newQueryClient();
    client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { 'sig.share_cards': true } }, confirmed: true });
    client.setQueryData(memberSettingsKey, { power_display: 'ps_kw', ...settings });
    client.setQueryData(['public-vehicle', 'skyline', 'member|de', 'page'], page);
    await renderScreen(<ShareCardScreen />, client);
    await act(async () => undefined);
  }

  it('starts with the stored card, draws a custom one with its options, and "Standard" goes back', async () => {
    await open(vehicle());
    await waitFor(() => expect(screen.getByTestId('VEH-07.preview')).toBeTruthy());
    // The PNG at its exact aspect, never cropped.
    expect(screen.getByTestId('VEH-07.preview.image')).toHaveProp('contentFit', 'contain');
    expect(mockDownloadFile).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('VEH-07.template.poster'));
    await fireEvent.press(screen.getByTestId('VEH-07.element.mods'));
    // The last card stays while the next one is drawn; nothing can be shared in between.
    expect(screen.getByTestId('VEH-07.preview')).toHaveProp('aria-busy', true);
    expect(screen.getByTestId('VEH-07.hint')).toHaveTextContent('Die Karte wird neu gezeichnet …');
    expect(screen.getByTestId('VEH-07.cta.primary')).toBeDisabled();
    await waitFor(() => expect(mockDownloadFile).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const [url, target] = mockDownloadFile.mock.calls[0]!;
    expect(url).toBe(`https://speedclub.test/api/v1/vehicles/${VEHICLE}/share-card.png?format=story&template=poster&show=score%2Cdex%2Cspecs%2Cmods%2Cusername%2Cqr`);
    expect(target.uri).toMatch(new RegExp(`speedclub-${VEHICLE}-story-[0-9a-z]+\\.png$`));
    await waitFor(() => expect(screen.getByTestId('VEH-07.cta.primary')).toBeEnabled(), { timeout: 2000 });

    await fireEvent.press(screen.getByTestId('VEH-07.reset'));
    await waitFor(() => expect(screen.queryByTestId('VEH-07.reset')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('VEH-07.cta.primary')).toBeEnabled(), { timeout: 2000 });
    expect(mockDownloadFile).toHaveBeenCalledTimes(1);
  });

  it('a crop with the buttons redraws once, 400 ms after the last press', async () => {
    await open(vehicle());
    await fireEvent.press(screen.getByTestId('VEH-07.crop.zoomIn'));
    await fireEvent.press(screen.getByTestId('VEH-07.crop.zoomIn'));
    await waitFor(() => expect(mockDownloadFile).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(mockDownloadFile.mock.calls[0]![0]).toContain('?format=story&zoom=1.50&x=0.5&y=0.5');
  });

  it('a 422 on text lands on the field and keeps the last card; Teilen waits', async () => {
    mockDownloadFile.mockImplementationOnce(() => Promise.reject(new Error('Unable to download file: HTTP 422')));
    await open(vehicle(), undefined, {
      'share-card.png': { status: 422, body: { message: 'Bitte prüfe deine Eingaben.', code: 'validation_failed', errors: { text: ['Dieser Text ist nicht erlaubt.'] } } },
    });
    await fireEvent.changeText(screen.getByTestId('VEH-07.text'), 'Ein Wort, das nicht geht');
    await waitFor(() => expect(screen.getByTestId('VEH-07.text.error')).toHaveTextContent('Dieser Text ist nicht erlaubt.'), { timeout: 2000 });
    expect(mockDownloadFile.mock.calls[0]![0]).toContain('text=Ein+Wort%2C+das+nicht+geht');
    expect(screen.getByTestId('VEH-07.preview.image')).toBeTruthy();
    expect(screen.queryByTestId('VEH-07.error')).toBeNull();
    expect(screen.getByTestId('VEH-07.cta.primary')).toBeDisabled();
  });

  it('an emoji never reaches the server', async () => {
    await open(vehicle());
    await fireEvent.changeText(screen.getByTestId('VEH-07.text'), 'Bester Tag 🏁');
    await waitFor(() => expect(screen.getByTestId('VEH-07.text.error')).toBeTruthy());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(mockDownloadFile).not.toHaveBeenCalled();
    expect(screen.getByTestId('VEH-07.cta.primary')).toBeDisabled();
  });

  it('a card that cannot be drawn (a photo no longer public: 422 on photo) shows the error with a retry', async () => {
    mockDownloadFile.mockImplementationOnce(() => Promise.reject(new Error('Unable to download file: HTTP 422')));
    await open(vehicle(), undefined, {
      'share-card.png': { status: 422, body: { message: 'Bitte prüfe deine Eingaben.', code: 'validation_failed', errors: { photo: ['Dieses Foto ist nicht mehr öffentlich.'] } } },
    });
    await fireEvent.press(screen.getByTestId('VEH-07.photo.01side'));
    await waitFor(() => expect(screen.getByTestId('VEH-07.error')).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByTestId('VEH-07.cta.primary')).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(screen.getByTestId('VEH-07.preview.image')).toBeTruthy(), { timeout: 2000 });
    expect(mockDownloadFile).toHaveBeenCalledTimes(2);
  });

  it('R5DQ-19: loading draws the customiser geometry under the card skeleton', async () => {
    const qa = jest.spyOn(jest.requireActual<typeof import('@/lib/qa')>('@/lib/qa'), 'useQaState').mockReturnValue('loading');
    await open(vehicle());
    expect(screen.getByTestId('VEH-07.skeleton')).toBeTruthy();
    expect(screen.getByTestId('VEH-07.customiseSkeleton')).toBeTruthy();
    expect(screen.queryByTestId('VEH-07.customise')).toBeNull();
    qa.mockRestore();
  });

  /**
   * Client round 7, item 4b (R7-4b): "when you disable text on the card, it's still there". Every change used to be a copy of the
   * options its render had seen: a second change from an older render (two switches in one frame, the cropper's gesture end, the own
   * line's field) put a switched-off element or a cleared line back, on the chip and on the card. Changes are updates now.
   */
  it('R7-4b: two switches in one frame both go off, on the chips and on the drawn card', async () => {
    await open(vehicle());
    await waitFor(() => expect(screen.getByTestId('VEH-07.preview')).toBeTruthy());
    const specs = screen.getByTestId('VEH-07.element.specs');
    const username = screen.getByTestId('VEH-07.element.username');
    expect(specs).toBeChecked();
    expect(username).toBeChecked();
    // Both presses before React renders again, as a fast thumb or a gesture end does it.
    await act(async () => {
      void fireEvent.press(specs);
      void fireEvent.press(username);
    });
    expect(screen.getByTestId('VEH-07.element.specs')).not.toBeChecked();
    expect(screen.getByTestId('VEH-07.element.username')).not.toBeChecked();
    await waitFor(() => expect(mockDownloadFile).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const [url, target] = mockDownloadFile.mock.calls[0]!;
    expect(url).toBe(`https://speedclub.test/api/v1/vehicles/${VEHICLE}/share-card.png?format=story&show=score%2Cdex%2Cqr`);
    // The preview and what Teilen exports are that drawing, not the stored card with the data line and @username.
    await waitFor(() => expect(screen.getByTestId('VEH-07.cta.primary')).toBeEnabled(), { timeout: 2000 });
    expect(screen.getByTestId('VEH-07.preview.image').props.source).toEqual([{ uri: target.uri }]);
    // A new card replaces the picture instead of crossfading over the last one (WebKit kept the old one on top).
    expect(screen.getByTestId('VEH-07.preview.image').props.recyclingKey).toBe(target.uri);
  });

  it('R7-4b: a cleared own line leaves the card, also after a later change from the same render', async () => {
    await open(vehicle());
    await fireEvent.changeText(screen.getByTestId('VEH-07.text'), 'Freitag am Ring');
    await waitFor(() => expect(mockDownloadFile).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(mockDownloadFile.mock.calls[0]![0]).toContain('text=Freitag+am+Ring');
    // The line is cleared and, in the same frame, the theme of another template is picked: the line must stay cleared.
    await act(async () => {
      void fireEvent.changeText(screen.getByTestId('VEH-07.text'), '');
      void fireEvent.press(screen.getByTestId('VEH-07.template.poster'));
    });
    await waitFor(() => expect(mockDownloadFile).toHaveBeenCalledTimes(2), { timeout: 2000 });
    const last = mockDownloadFile.mock.calls[1]![0];
    expect(last).toContain('template=poster');
    expect(last).not.toContain('text=');
    await waitFor(() => expect(screen.getByTestId('VEH-07.preview.image').props.source).toEqual([{ uri: mockDownloadFile.mock.calls[1]![1].uri }]), { timeout: 2000 });
  });

  it('is unavailable without the flag', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubFetch({});
    const client = newQueryClient();
    client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { 'sig.share_cards': false } }, confirmed: true });
    await renderScreen(<ShareCardScreen />, client);
    expect(screen.getByTestId('VEH-07.unavailable.title')).toHaveTextContent('Karte nicht verfügbar');
    expect(screen.queryByTestId('VEH-07.cta.primary')).toBeNull();
  });

  it('offers no @Name when the owner hides themselves', async () => {
    await open(vehicle(), { show_owner_on_qr: false });
    expect(screen.getByTestId('VEH-07.element.score')).toBeTruthy();
    expect(screen.queryByTestId('VEH-07.element.username')).toBeNull();
  });

  it('the theme shows for the square band, not for the story band', async () => {
    await open(vehicle());
    expect(screen.queryByTestId('VEH-07.theme')).toBeNull();
    await fireEvent.press(screen.getByText('Quadrat 1:1'));
    expect(screen.getByTestId('VEH-07.theme')).toBeTruthy();
  });

  describe('Speichern into the photo library', () => {
    const toastMock = toast as jest.MockedFunction<typeof toast>;

    async function save() {
      await open(vehicle());
      await waitFor(() => expect(screen.getByTestId('VEH-07.save')).toBeEnabled());
      await fireEvent.press(screen.getByTestId('VEH-07.save'));
      await act(async () => undefined);
    }

    it('asks for the add-only permission on first use and saves the same PNG', async () => {
      await save();
      await waitFor(() => expect(mockCreateAsset).toHaveBeenCalledTimes(1));
      expect(mockGetPermissions).toHaveBeenCalledWith(true);
      expect(mockRequestPermissions).toHaveBeenCalledWith(true);
      // The stored card is downloaded into the cache first, then handed over as a file.
      expect(mockDownloadFile.mock.calls[0]![0]).toBe('https://cdn.test/share/story.png');
      expect(mockCreateAsset).toHaveBeenCalledWith(`file:///cache/speedclub-${VEHICLE}-story.png`);
      expect(toastMock).toHaveBeenLastCalledWith('In deinen Fotos gespeichert.', expect.objectContaining({ haptic: 'success' }));
    });

    it('a refused permission: a toast that opens the settings', async () => {
      mockGetPermissions.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied' });
      await save();
      await waitFor(() => expect(toastMock).toHaveBeenCalled());
      expect(mockRequestPermissions).not.toHaveBeenCalled();
      expect(mockCreateAsset).not.toHaveBeenCalled();
      const [message, options] = toastMock.mock.lastCall!;
      expect(message).toBe('Ohne Zugriff auf deine Fotos kann die Karte nicht gespeichert werden.');
      expect(options?.action?.label).toBe('Einstellungen');
      const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
      options?.action?.onPress();
      expect(openSettings).toHaveBeenCalled();
    });

    it('any other failure points to Teilen → Bild speichern', async () => {
      mockGetPermissions.mockResolvedValueOnce({ granted: true, canAskAgain: true, status: 'granted' });
      mockCreateAsset.mockRejectedValueOnce(new Error('disk full'));
      await save();
      await waitFor(() => expect(toastMock).toHaveBeenCalled());
      expect(toastMock).toHaveBeenLastCalledWith('Speichern hat nicht geklappt. Tipp auf „Teilen“ und dann auf „Bild speichern“.', expect.anything());
    });
  });
});

describe('web share of a card drawn just now', () => {
  it('hands on the bytes it holds: the CSP refuses a fetch of its own blob: URL', async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const blob = new Blob(['png'], { type: 'image/png' });
    const share = jest.fn(() => Promise.resolve());
    const outcome = await shareCardOnWeb({ url: 'blob:http://localhost/1', remote: false, fileName: 'speedclub-1-story-x.png', blob }, 'R34', { share, canShare: () => true });
    expect(outcome).toBe('shared');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'R34' }));
  });
});
