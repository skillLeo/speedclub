import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { LegalDocumentScreen } from '@/features/settings/screens/LegalDocumentScreen';
import { LegalListScreen } from '@/features/settings/screens/LegalListScreen';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, stubFetch } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { doc?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
// The client is built at import time with the configured origin; native has none in Jest, and a relative URL is no Request.
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const summary = (key: string, title: string) => ({ key, title, locale: 'de', version: '1', published_at: '2026-11-02T23:02:18+00:00' });

const LIST = {
  body: {
    data: [summary('licenses', 'Lizenzen'), summary('privacy', 'Datenschutz'), summary('imprint', 'Impressum'), summary('terms', 'AGB')],
  },
};

const LICENSES = {
  body: {
    data: {
      ...summary('licenses', 'Lizenzen'),
      body_md: '# Lizenzen\n\nSPEED CLUB baut auf Open-Source-Software auf.\n\n| Software | Lizenz |\n|---|---|\n| Laravel | MIT |\n\nFragen an [[Kontakt-E-Mail]].',
    },
  },
};

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

describe('SET-17 Legal list', () => {
  it('lists the texts in the order of the register, with version and date in Berlin time', async () => {
    stubFetch({ '/api/v1/legal': LIST });
    await renderScreen(<LegalListScreen />);
    await waitFor(() => expect(screen.getByTestId('SET-17.list')).toBeTruthy());
    const titles = ['imprint', 'privacy', 'terms', 'licenses'].map((key) => screen.getByTestId(`SET-17.row.${key}`));
    expect(titles).toHaveLength(4);
    expect(screen.getAllByText('Version 1, gültig seit 3. November 2026')).toHaveLength(4);
    await fireEvent.press(screen.getByTestId('SET-17.row.privacy.body'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/settings/legal/[doc]', params: { doc: 'privacy' } });
  });

  it('offers a retry when the list cannot load', async () => {
    stubFetch({ '/api/v1/legal': { status: 500, body: { message: 'Fehler', code: 'server' } } });
    await renderScreen(<LegalListScreen />);
    // A server error gets the hook's two retries first.
    await waitFor(() => expect(screen.getByTestId('SET-17.error')).toBeTruthy(), { timeout: 10_000 });
    expect(screen.getByText('Erneut versuchen')).toBeTruthy();
  });
});

describe('SET-18 Legal document', () => {
  it('prints the opening heading once as the title, then the body', async () => {
    mockParams = { doc: 'licenses' };
    stubFetch({ '/api/v1/legal/licenses': LICENSES });
    await renderScreen(<LegalDocumentScreen />);
    await waitFor(() => expect(screen.getByTestId('SET-18.title')).toHaveTextContent('Lizenzen'));
    expect(screen.getAllByText('Lizenzen')).toHaveLength(1);
    expect(screen.getByTestId('SET-18.meta')).toHaveTextContent('Version 1, gültig seit 3. November 2026');
    expect(screen.getByText('Laravel')).toBeTruthy();
    expect(screen.getByText('[[Kontakt-E-\u2060Mail]]')).toBeTruthy();
  });

  it('asks nothing for a key the app does not know', async () => {
    mockParams = { doc: '../admin' };
    const { fetchMock } = stubFetch({});
    await renderScreen(<LegalDocumentScreen />);
    expect(screen.getByTestId('SET-18.notFound')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('SET-18.notFound.action'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/settings/legal');
  });

  it('shows a missing text as not found, not as an outage', async () => {
    mockParams = { doc: 'community' };
    stubFetch({});
    await renderScreen(<LegalDocumentScreen />);
    await waitFor(() => expect(screen.getByTestId('SET-18.notFound')).toBeTruthy());
  });
});
