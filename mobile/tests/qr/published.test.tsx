import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { PublishedScreen } from '@/features/garage/screens/PublishedScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { vehicle } from '../garage/fixtures';
import { QR_SVG, qrRow, renderScreen, signIn, stubFetch } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { vehicleId?: string } = {};
const mockOpenBrowser = jest.fn((_url: string, _options?: unknown) => Promise.resolve({ type: 'opened' }));
const mockShare = jest.fn((_content: unknown) => Promise.resolve({ action: 'sharedAction' }));

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/profile/qr',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  useNavigation: () => ({ getParent: () => undefined, getState: () => undefined, canGoBack: () => false, goBack: jest.fn() }),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('token-1')) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (url: string, options: unknown) => mockOpenBrowser(url, options) }));
const mockDownloadFile = jest.fn((_url: string, target: { uri: string }) => Promise.resolve({ uri: target.uri }));
const mockShareFile = jest.fn((_uri: string, _options: unknown) => Promise.resolve());
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
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(true),
  shareAsync: (uri: string, options: unknown) => mockShareFile(uri, options),
}));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const VEHICLE = '01m6f7zv1vs5e2xw9a96cbqzyp';
const ME = {
  body: {
    data: {
      id: '01lukas',
      username: 'lukas.sc',
      restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: false, until: null } },
    },
  },
};

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { vehicleId: VEHICLE };
  signIn();
  const { Share } = jest.requireActual<typeof import('react-native')>('react-native');
  jest.spyOn(Share, 'share').mockImplementation((content) => mockShare(content) as never);
});
afterAll(() => useSessionStore.setState({ status: 'loading', member: null }));

function stubPublished() {
  return stubFetch({
    '/api/v1/auth/me': ME,
    [`/api/v1/vehicles/${VEHICLE}`]: { body: { data: vehicle() } },
    [`/api/v1/vehicles/${VEHICLE}/qr`]: { body: { data: qrRow() } },
    [`/api/v1/vehicles/${VEHICLE}/qr.svg`]: { body: QR_SVG, contentType: 'image/svg+xml' },
  });
}

describe('GAR-04 Veröffentlicht + QR (09 §7.6, SM13)', () => {
  it('prints the code on the blurred stage under the brush logo and says the build is live', async () => {
    stubPublished();
    await renderScreen(<PublishedScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-04.qr')).toBeTruthy());
    expect(screen.getByTestId('GAR-04.stage')).toBeTruthy();
    expect(screen.getByTestId('GAR-04.wordmark', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('GAR-04.qr.shortCode')).toHaveTextContent('8TR0 Q3MC');
    expect(screen.getByTestId('GAR-04.title')).toHaveTextContent('Dein Build ist live.');
  });

  it('leads on to the QR page, the share sheet with the public page, and the garage', async () => {
    stubPublished();
    await renderScreen(<PublishedScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-04.share')).not.toBeDisabled());
    await fireEvent.press(screen.getByTestId('GAR-04.share'));
    await waitFor(() => expect(mockShare).toHaveBeenCalled());
    expect(mockShare.mock.calls[0]![0]).toMatchObject({ url: 'https://speedclub.de/v/nissan-skyline-gt-r-r34-5tf974vj' });
    await fireEvent.press(screen.getByTestId('GAR-04.viewQr'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/qr/${VEHICLE}`);
    await fireEvent.press(screen.getByTestId('GAR-04.toGarage'));
    expect(mockRouter.push).toHaveBeenCalledWith('/garage');
  });
});
