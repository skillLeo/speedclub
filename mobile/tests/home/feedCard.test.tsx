// The latest change on a feed card at the font scales where it used to go wrong (DQ-200, DQ-230), and the rail of Start (DQ-199, DQ-206).
import { act, screen, waitFor } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { FeedVehicleCard } from '@/features/home/components/FeedVehicleCard';
import { HomeRail } from '@/features/home/components/HomeRail';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import type { ValueText } from '@/ui/ValueText';

import { R34 } from './fixtures';
import { renderWithProviders, stubFetch } from './harness';

const mockWindow = { current: { width: 360, height: 780, scale: 2, fontScale: 1 } };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow.current,
}));

const mockSummary: { props: ComponentProps<typeof ValueText> | null } = { props: null };
jest.mock('@/ui/ValueText', () => ({
  ValueText: (props: ComponentProps<typeof ValueText>) => {
    mockSummary.props = props;
    return null;
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  usePathname: () => '/',
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

beforeAll(hydrateThemePreference);

async function renderCard(fontScale: number) {
  mockWindow.current = { width: 360, height: 780, scale: 2, fontScale };
  await renderWithProviders(<FeedVehicleCard vehicle={R34} width={328} onOpen={jest.fn()} onOpenUpdate={jest.fn()} testID="card" />);
  return mockSummary.props;
}

describe('the latest change on a feed card', () => {
  it('at the default size: two lines, whole words', async () => {
    expect(await renderCard(1)).toMatchObject({ numberOfLines: 2, hyphenate: false });
  });

  it('at 1.3: three lines, so the new value stays, and still no hyphen in a word that fits the next line whole', async () => {
    expect(await renderCard(1.3)).toMatchObject({ numberOfLines: 3, hyphenate: false });
  });

  it('from 1.5: three lines, and long compounds may hyphenate', async () => {
    expect(await renderCard(1.5)).toMatchObject({ numberOfLines: 3, hyphenate: true });
    expect(await renderCard(2)).toMatchObject({ numberOfLines: 3, hyphenate: true });
  });
});

describe('the rail of Start', () => {
  const member = () =>
    useSessionStore.setState({ status: 'member', member: { id: 'm', username: 'lukas.sc', displayName: null, avatarUrl: null } });

  beforeEach(() => {
    mockWindow.current = { width: 1280, height: 800, scale: 1, fontScale: 1 };
    stubFetch({ '/discover': { body: { data: { makes: [] } } }, '/me/vehicles': { body: { data: [] } } });
  });

  // BH-45: the same number as the Profile: drafts and archived vehicles are not vehicles of the garage count.
  it('counts published vehicles only, and shows no number before the garage answers', async () => {
    member();
    let answer: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => (answer = resolve));
    globalThis.fetch = jest.fn((input: Request | string) => {
      const path = new URL(typeof input === 'string' ? input : input.url).pathname;
      if (path.endsWith('/me/vehicles')) return pending;
      return Promise.resolve(new Response(JSON.stringify({ data: { makes: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }) as unknown as typeof fetch;
    await renderWithProviders(<HomeRail />);
    expect(await screen.findByTestId('HOME-01.rail.garage.open')).not.toHaveTextContent(/Fahrzeug(e)?$/);

    const garage = [{ status: 'published' }, { status: 'published' }, { status: 'draft' }, { status: 'archived' }];
    await act(async () => answer(new Response(JSON.stringify({ data: garage }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await waitFor(() => expect(screen.getByTestId('HOME-01.rail.garage.open')).toHaveTextContent(/2 Fahrzeuge/));
  });

  it('shows no "0 Fahrzeuge" for an empty garage (DQ-311)', async () => {
    member();
    await renderWithProviders(<HomeRail />);
    // The stub answers an empty garage: the row leads to it without a zero count.
    await waitFor(() => expect(screen.getByTestId('HOME-01.rail.garage.open')).toHaveTextContent(/^Zur Garage$/));
    expect(screen.queryByText(/0 Fahrzeuge/)).toBeNull();
  });

  it('leaves "Fahrzeug hinzufügen" to the sidebar beside it (DQ-206)', async () => {
    member();
    await renderWithProviders(<HomeRail />);
    expect(await screen.findByTestId('HOME-01.rail.garage.open')).toBeTruthy();
    expect(screen.queryByText('Fahrzeug hinzufügen')).toBeNull();
  });

  it('is its own scroller only beside the page, and part of the page with inPage (DQ-199)', async () => {
    member();
    const beside = await renderWithProviders(<HomeRail />);
    expect(screen.getByTestId('HOME-01.rail').type).toBe('RCTScrollView');
    beside.unmount();
    await renderWithProviders(<HomeRail inPage />);
    expect(screen.getByTestId('HOME-01.rail').type).not.toBe('RCTScrollView');
    expect(await screen.findByTestId('HOME-01.rail.garage.open')).toBeTruthy();
  });
});
