/** M5.9c UPD-01 "Vorher/Nachher" (contract §2): two photo slots through the plate blur step, an optional mod, both photos required. */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { PostUpdateScreen } from '@/features/updates/screens/PostUpdateScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { R34 } from '../vehicle/fixtures';
import { renderWithProviders, stubFetch } from '../vehicle/harness';

const mockParams: Record<string, string | undefined> = {};
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/post-update',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  useNavigation: () => ({ getParent: () => undefined, canGoBack: () => true, goBack: jest.fn(), dispatch: jest.fn() }),
  usePreventRemove: jest.fn(() => jest.fn()),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
const mockPickPhotos = jest.fn();
jest.mock('@/features/garage/photos', () => ({
  ...jest.requireActual('@/features/garage/photos'),
  pickPhotos: (...args: unknown[]) => mockPickPhotos(...args),
}));
const mockReview = jest.fn(async (photos: readonly object[]) => photos.map((photo) => ({ ...photo, plateBlur: { on: true, regions: [] } })));
jest.mock('@/features/media/plateBlur/PlateBlurReview', () => ({
  usePlateBlurReview: () => ({ review: mockReview, element: null, open: false }),
}));
const mockEnqueue = jest.fn((_target: unknown, photos: readonly unknown[]) => photos.map((_, index) => `item-${index}`));
jest.mock('@/features/garage/uploads', () => ({
  uploadQueue: () => ({ store: { getState: () => ({ enqueue: mockEnqueue, items: [] }), subscribe: jest.fn(() => jest.fn()) } }),
}));
const mockFinish = jest.fn(() => Promise.resolve());
jest.mock('@/features/updates/pairing', () => ({ finishPostWhenUploaded: (...args: unknown[]) => mockFinish(...(args as [])) }));

const card = { ...R34, status: 'published' as const };
const MODS = {
  data: [{ ...R34.highlights[0]!, id: 'mod-kw', title: 'KW Variant 3' }],
  links: {},
  meta: { next_cursor: null, per_page: 50, path: null, prev_cursor: null },
};
const ready = () =>
  waitFor(() => {
    const cta = screen.getByTestId('UPD-01.cta.primary');
    expect(cta.props['aria-disabled'] ?? false).toBeFalsy();
  });

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  Object.assign(mockParams, { vehicleId: R34.id, kind: 'before_after' });
  useSessionStore.setState({ status: 'member', member: { id: 'viewer', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null } });
});

describe('UPD-01 Vorher/Nachher', () => {
  it('opens on the before/after slots from "Nächstes Upgrade" and needs both photos', async () => {
    const { calls } = stubFetch({ '/me/vehicles': { body: { data: [card] } }, [`/vehicles/${R34.id}/mods`]: { body: MODS } });
    await renderWithProviders(<PostUpdateScreen />);
    expect(await screen.findByTestId('UPD-01.beforeAfter.before')).toBeTruthy();
    expect(screen.queryByTestId('UPD-01.photos')).toBeNull();
    await ready();
    await act(async () => fireEvent.press(screen.getByTestId('UPD-01.cta.primary')));
    expect(await screen.findByTestId('UPD-01.beforeAfter.error.before')).toHaveTextContent('Wähle ein Vorher-Foto.');
    expect(screen.getByTestId('UPD-01.beforeAfter.error.after')).toHaveTextContent('Wähle ein Nachher-Foto.');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('takes each photo through the plate blur step and posts the pair with its mod', async () => {
    const { calls } = stubFetch({
      '/me/vehicles': { body: { data: [card] } },
      [`/vehicles/${R34.id}/mods`]: { body: MODS },
      '/build-updates': { status: 201, body: { data: { ...R34.updates[0]!, id: 'new-pair', type: 'post' } } },
    });
    await renderWithProviders(<PostUpdateScreen />);
    mockPickPhotos.mockResolvedValueOnce([{ uri: 'file:///before.jpg', width: 4000, height: 3000 }]);
    await act(async () => fireEvent.press(await screen.findByTestId('UPD-01.beforeAfter.before')));
    mockPickPhotos.mockResolvedValueOnce([{ uri: 'file:///after.jpg', width: 4000, height: 3000 }]);
    await act(async () => fireEvent.press(screen.getByTestId('UPD-01.beforeAfter.after')));
    expect(mockReview).toHaveBeenCalledTimes(2);
    expect(mockPickPhotos).toHaveBeenCalledWith(1);
    await act(async () => fireEvent.press(await screen.findByTestId('UPD-01.beforeAfter.mod.mod-kw')));
    await ready();
    await act(async () => fireEvent.press(screen.getByTestId('UPD-01.cta.primary')));
    const post = await waitFor(() => {
      const found = calls.find((call) => call.method === 'POST' && new URL(call.url).pathname.endsWith('/build-updates'));
      expect(found).toBeTruthy();
      return found!;
    });
    expect(await post.json()).toMatchObject({ vehicle_id: R34.id, kind: 'before_after', modification_id: 'mod-kw', modification_ids: ['mod-kw'] });
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalled());
    const [target, photos] = mockEnqueue.mock.calls[0]!;
    expect(target).toEqual({ kind: 'update', vehicleId: R34.id, updateId: 'new-pair' });
    expect((photos as { uri: string }[]).map((photo) => photo.uri)).toEqual(['file:///before.jpg', 'file:///after.jpg']);
    expect(mockFinish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ updateId: 'new-pair', pairs: [{ before: 0, after: 1 }] }));
  });

  it('switches back to a plain update with the photo list', async () => {
    stubFetch({ '/me/vehicles': { body: { data: [card] } }, [`/vehicles/${R34.id}/mods`]: { body: MODS } });
    await renderWithProviders(<PostUpdateScreen />);
    await act(async () => fireEvent.press(await screen.findByTestId('UPD-01.kind.post')));
    expect(screen.getByTestId('UPD-01.photos')).toBeTruthy();
    expect(screen.queryByTestId('UPD-01.beforeAfter')).toBeNull();
  });
});
