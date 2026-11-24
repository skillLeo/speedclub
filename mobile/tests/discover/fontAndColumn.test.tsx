// DISC-01 and DISC-02 on a desktop window (DQ-202, DQ-423), and a member row at a large font (DQ-203, DQ-427).
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { SearchMemberRow } from '@/features/discover/components/SearchMemberRow';
import { DiscoverScreen } from '@/features/discover/screens/DiscoverScreen';
import { SearchScreen } from '@/features/discover/screens/SearchScreen';
import { hydrateThemePreference, layout, space } from '@/theme';

import { KENJI, MAKES, overview } from '../home/fixtures';
import { renderWithProviders, stubFetch } from '../home/harness';
import { flat } from '../ui/helpers';

const mockWindow = { current: { width: 1280, height: 800, scale: 1, fontScale: 1 } };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow.current,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  router: { dismissAll: jest.fn() },
  useLocalSearchParams: () => ({ q: 'r34' }),
  usePathname: () => '/discover',
  // M5.2: the segment swipe asks the stack where the page sits (Entdecken's root here).
  useNavigation: () => ({
    getState: () => ({ routeNames: ['discover/index', 'events/index'], routes: [{ key: 'discover-1', name: 'discover/index' }] }),
    addListener: jest.fn(() => jest.fn()),
  }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const NO_BREAK_SPACE = ' ';
const ZWSP = '\u200B';

beforeAll(hydrateThemePreference);
beforeEach(() => {
  stubFetch({ '/discover': { body: { data: { makes: MAKES } } }, '/search': { body: { data: overview() } } });
});

describe('the column of Entdecken (DQ-202)', () => {
  it('starts on the start edge of the pane from 1280, as Start does', async () => {
    mockWindow.current = { width: 1280, height: 800, scale: 1, fontScale: 1 };
    await renderWithProviders(<DiscoverScreen />);
    expect(flat(screen.getByTestId('DISC-01.title').props.style).alignSelf).toBe('flex-start');
  });

  it('stays centred on a tablet', async () => {
    mockWindow.current = { width: 1000, height: 800, scale: 1, fontScale: 1 };
    await renderWithProviders(<DiscoverScreen />);
    expect(flat(screen.getByTestId('DISC-01.title').props.style).alignSelf).toBe('center');
  });

  it('DISC-02 keeps the place of DISC-01, its header included (DQ-193)', async () => {
    mockWindow.current = { width: 1280, height: 800, scale: 1, fontScale: 1 };
    await renderWithProviders(<SearchScreen />);
    await waitFor(() => expect(screen.getByTestId('DISC-02.header.content')).toBeTruthy());
    expect(flat(screen.getByTestId('DISC-02.header.content').props.style).alignSelf).not.toBe('center');
  });

  it('DISC-02 on a tablet stays centred, its header included', async () => {
    mockWindow.current = { width: 1000, height: 800, scale: 1, fontScale: 1 };
    await renderWithProviders(<SearchScreen />);
    expect(flat(screen.getByTestId('DISC-02.header.content').props.style).alignSelf).toBe('center');
  });
});

describe('DISC-02 filter panel from 1280 (DQ-423)', () => {
  it('stands beside the Fahrzeuge tab only; on Mitglieder the list takes the pane up to the content max', async () => {
    mockWindow.current = { width: 1280, height: 800, scale: 1, fontScale: 1 };
    await renderWithProviders(<SearchScreen />);
    await screen.findByTestId('DISC-02.tab.members');
    expect(screen.getByTestId('DISC-02.panel')).toBeTruthy();
    expect(flat(screen.getByTestId('DISC-02.main').props.style).maxWidth).toBeUndefined();

    await fireEvent.press(screen.getByTestId('DISC-02.tab.members'));
    await screen.findByTestId(`DISC-02.member.${KENJI.username}`);
    expect(screen.queryByTestId('DISC-02.panel')).toBeNull();
    expect(flat(screen.getByTestId('DISC-02.main').props.style).maxWidth).toBe(layout.contentMax - layout.gutter.desktop);

    await fireEvent.press(screen.getByTestId('DISC-02.tab.vehicles'));
    expect(await screen.findByTestId('DISC-02.panel')).toBeTruthy();
  });
});

describe('a member row (DQ-203)', () => {
  const row = (fontScale: number, member = KENJI) => {
    mockWindow.current = { width: 390, height: 844, scale: 2, fontScale };
    return renderWithProviders(<SearchMemberRow member={member} onOpen={jest.fn()} divider={false} testID="row" />);
  };

  it('offers Folgen M from is_following (DQ-326)', async () => {
    await row(1);
    expect(screen.getByTestId('row.follow')).toHaveTextContent('Folgen');
  });

  it('says Folge ich for a member you follow', async () => {
    await row(1, { ...KENJI, is_following: true });
    expect(screen.getByTestId('row.follow')).toHaveTextContent('Folge ich');
  });

  it('has no follow button on your own row', async () => {
    await row(1, { ...KENJI, is_self: true });
    expect(screen.queryByTestId('row.follow')).toBeNull();
  });

  it('never starts a line with the separator: it stays behind the handle', async () => {
    await row(1);
    expect(screen.getByTestId('row.meta').props.children).toBe(`@kenji.${ZWSP}r34${NO_BREAK_SPACE}· ${KENJI.city}`);
  });

  it('sets a name that is only the handle on one unhyphenated line (r5 gate: "@gmws2dbpi5hse1" split "hs / e" at 200 %)', async () => {
    await row(2, { ...KENJI, display_name: null, username: 'gmws2dbpi5hse1' });
    expect(screen.getByTestId('row.name')).toHaveTextContent('@gmws2dbpi5hse1');
    expect(screen.getByTestId('row.name').props.numberOfLines).toBe(1);
  });

  it('lets a display name wrap as it needs', async () => {
    await row(2);
    expect(screen.getByTestId('row.name').props.numberOfLines).toBeUndefined();
  });

  it('breaks the handle only after its "." (DQ-282), as ui/MemberRow does (R4B-010)', async () => {
    await row(2);
    expect(screen.getByTestId('row.handle').props.children).toBe(`@kenji.${ZWSP}r34`);
    expect(screen.getByTestId('row.handle').props.numberOfLines).toBeUndefined();
  });

  it('sets a handle wider than its column on a line of its own with an ellipsis (R4B-010: "editori / al" at 200 %)', async () => {
    const editorial = { ...KENJI, username: 'speedclub.editorial', city: null };
    await row(2, editorial);
    // Before the first layout: one meta line, breakable after the ".".
    expect(screen.getByTestId('row.meta').props.children).toBe(`@speedclub.${ZWSP}editorial`);
    await fireEvent(screen.getByTestId('row.text'), 'layout', { nativeEvent: { layout: { width: 266, height: 40, x: 0, y: 0 } } });
    const handle = screen.getByTestId('row.handle');
    expect(handle.props.numberOfLines).toBe(1);
    expect(handle.props.children).toBe('@speedclub.editorial');
    expect(screen.queryByTestId('row.meta')).toBeNull();
    // At 100 % the handle fits that column and stays in the meta line.
    await row(1, editorial);
    await fireEvent(screen.getAllByTestId('row.text').at(-1)!, 'layout', { nativeEvent: { layout: { width: 266, height: 40, x: 0, y: 0 } } });
    expect(screen.getAllByTestId('row.meta').at(-1)!.props.children).toBe(`@speedclub.${ZWSP}editorial`);
  });

  it('at a large font gives handle and city a line each, with no separator left at a line end', async () => {
    await row(2);
    expect(screen.getByTestId('row.handle')).toHaveTextContent(`@kenji.${ZWSP}r34`);
    expect(screen.getByTestId('row.city')).toHaveTextContent(String(KENJI.city));
    expect(screen.queryByTestId('row.meta')).toBeNull();
    expect(screen.getByTestId('row.handle')).not.toHaveTextContent('·');
  });

  it('says the same to a screen reader at every size', async () => {
    await row(2);
    expect(screen.getByTestId('row.body').props['aria-label'] ?? screen.getByTestId('row.body').props.accessibilityLabel).toContain(`@${KENJI.username} · ${KENJI.city}`);
  });

  it('stacks Folgen at the row edge at a large font, as ui/MemberRow does, not indented by avatar + 12 (DQ-427)', async () => {
    await row(2);
    expect(flat(screen.getByTestId('row.trailing').props.style).paddingLeft).toBe(space[0]);
    await row(1);
    expect(flat(screen.getAllByTestId('row.trailing').at(-1)!.props.style).paddingLeft).toBe(space[8]);
  });

  it('without a city there is one line at any size', async () => {
    await row(2, { ...KENJI, city: null });
    expect(screen.getByTestId('row.meta')).toHaveTextContent(`@kenji.${ZWSP}r34`);
    expect(screen.queryByTestId('row.handle')).toBeNull();
  });
});
