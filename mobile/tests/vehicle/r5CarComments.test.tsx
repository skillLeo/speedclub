/**
 * R5-5 on VEH-01: the car's own comments are where the car is. A calm "Kommentare" row in Überblick opens the feed's comments sheet
 * on the car's thread (no count); a visitor sees it only while the owner allows comments, the owner always, with "Kommentare
 * erlauben". A `comment` notification on the car opens the page with the sheet (`?comments=1`, once).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { carCommentsEntryMode } from '@/features/vehicle/components/CarComments';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { R34 } from './fixtures';
import { newQueryClient, renderWithProviders } from './harness';

const mockParams: Record<string, string | undefined> = { slug: R34.slug };
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => `/v/${mockParams.slug ?? ''}`,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown) => string;
  horizontal?: boolean;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
};
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({
      scrollToOffset: jest.fn(),
      scrollToIndex: jest.fn(() => Promise.resolve()),
      getLayout: (index: number) => ({ x: 0, y: index * 1000, width: 390, height: 1000 }),
      getFirstItemOffset: () => 0,
      getScrollableNode: () => null,
    }));
    const items = props.data.map((item, index) => createElement(Fragment, { key: props.keyExtractor ? props.keyExtractor(item) : index }, props.renderItem({ item, index })));
    return createElement(Fragment, null, props.ListHeaderComponent, props.data.length === 0 ? props.ListEmptyComponent : items, props.ListFooterComponent);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
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

const THREAD = `/vehicles/${R34.id}/comments`;
const withFlags = (flags: Record<string, boolean>) => {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, ...flags } }, confirmed: true });
  return client;
};
const visitorCar = (commentsEnabled = true): PublicVehicle => ({
  ...R34,
  social: { ...R34.social, comments_enabled: commentsEnabled },
  comment_thread: { enabled: commentsEnabled, can_write: true },
});
const ownCar = (commentsEnabled: boolean): PublicVehicle =>
  ({ ...visitorCar(commentsEnabled), is_owner: true, owner: R34.owner ? { ...R34.owner, is_self: true } : null }) as PublicVehicle;

/** Answers by path and method; records every request. */
function stub(answers: Record<string, (request: Request) => { status?: number; body: unknown }>) {
  const calls: Request[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    calls.push(request);
    const path = new URL(request.url).pathname;
    const key = Object.keys(answers).find((candidate) => path.endsWith(candidate));
    const answer = key ? answers[key]!(request) : { status: 404, body: { message: 'Nicht gefunden', code: 'not_found' } };
    return new Response(answer.body === null ? null : JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return calls;
}
const emptyThread = () => ({ body: { data: [], meta: { next_cursor: null, per_page: 30 } } });

const renderProfile = (vehicle: PublicVehicle, flags: Record<string, boolean> = { build_comments: true }) =>
  renderWithProviders(<VehicleProfile vehicle={vehicle} onBack={jest.fn()} />, withFlags(flags));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  mockParams.slug = R34.slug;
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('who sees the car’s comments entry', () => {
  it('follows the flag and the owner’s setting, on sample builds too (ADR-538)', () => {
    expect(carCommentsEntryMode(visitorCar(true), false)).toBe('hidden');
    expect(carCommentsEntryMode(visitorCar(true), true)).toBe('visitor');
    expect(carCommentsEntryMode(visitorCar(false), true)).toBe('hidden');
    expect(carCommentsEntryMode(ownCar(false), true)).toBe('owner');
    expect(carCommentsEntryMode({ ...visitorCar(true), is_sample: true }, true)).toBe('visitor');
    // The thread itself decides for a visitor (a draft's is closed although the owner's switch is on).
    expect(carCommentsEntryMode({ ...visitorCar(true), comment_thread: { enabled: false, can_write: false } }, true)).toBe('hidden');
  });
});

describe('VEH-01: Kommentare in Überblick', () => {
  it('shows a visitor the calm row without a count, and opens the car’s thread in the sheet', async () => {
    const calls = stub({ [THREAD]: emptyThread, '/highlights': () => ({ body: { data: [] } }) });
    await renderProfile(visitorCar(true));
    const open = await screen.findByTestId('VEH-01.comments.open');
    expect(open).toHaveTextContent(/Kommentare/);
    expect(open).not.toHaveTextContent(/\d/);
    expect(screen.queryByTestId('VEH-01.comments.allow')).toBeNull();
    await act(async () => fireEvent.press(open));
    expect(await screen.findByTestId(`VEH-01.comments.${R34.id}.empty`)).toHaveTextContent('Noch keine Kommentare. Schreib den ersten.');
    expect(calls.some((request) => new URL(request.url).pathname.endsWith(THREAD))).toBe(true);
  });

  it('has no row while the flag is off or the owner turned comments off', async () => {
    stub({ '/highlights': () => ({ body: { data: [] } }) });
    const off = await renderProfile(visitorCar(true), { build_comments: false });
    expect(screen.queryByTestId('VEH-01.comments.open')).toBeNull();
    await act(async () => off.unmount());
    await renderProfile(visitorCar(false));
    expect(screen.queryByTestId('VEH-01.comments.open')).toBeNull();
  });

  it('shows the owner that comments are off, and turns them on from there', async () => {
    useSessionStore.setState({ status: 'member', member: { id: 'owner', username: 'kenji.r34', displayName: 'Kenji', avatarUrl: null } });
    const calls = stub({
      '/highlights': () => ({ body: { data: [] } }),
      [`/vehicles/${R34.id}/comments`]: (request) =>
        request.method === 'PATCH' ? { body: { data: { ...R34.social, comments_enabled: true } } } : emptyThread(),
    });
    // The page's cached copy (VehicleScreen reads the page from it): the switch changes it at once.
    const client = withFlags({ build_comments: true });
    client.setQueryData(['public-vehicle', 'viewer', R34.slug], { data: ownCar(false) });
    await renderWithProviders(<VehicleProfile vehicle={ownCar(false)} onBack={jest.fn()} />, client);
    expect(await screen.findByTestId('VEH-01.comments.open')).toHaveTextContent(/Ausgeschaltet\. Was schon geschrieben wurde, bleibt lesbar\./);
    const toggle = screen.getByTestId('VEH-01.comments.allow');
    expect(toggle).not.toBeChecked();
    await act(async () => fireEvent.press(toggle));
    const patch = await waitFor(() => {
      const found = calls.find((request) => request.method === 'PATCH');
      expect(found).toBeTruthy();
      return found!;
    });
    expect(await patch.clone().json()).toEqual({ enabled: true });
    const cached = client.getQueryData<{ data: PublicVehicle }>(['public-vehicle', 'viewer', R34.slug]);
    expect(cached?.data.social?.comments_enabled).toBe(true);
  });

  it('opens the sheet once from a notification’s ?comments=1', async () => {
    mockParams.comments = '1';
    stub({ [THREAD]: emptyThread, '/highlights': () => ({ body: { data: [] } }) });
    await renderProfile(visitorCar(true));
    expect(await screen.findByTestId(`VEH-01.comments.${R34.id}.empty`)).toBeTruthy();
    expect(mockRouter.setParams).toHaveBeenCalledWith({ comments: undefined });
  });

  it('ignores ?comments=1 while the car takes no comments', async () => {
    mockParams.comments = '1';
    const calls = stub({ [THREAD]: emptyThread, '/highlights': () => ({ body: { data: [] } }) });
    await renderProfile(visitorCar(false));
    await act(async () => undefined);
    expect(screen.queryByTestId(`VEH-01.comments.${R34.id}`)).toBeNull();
    expect(calls.some((request) => new URL(request.url).pathname.endsWith(THREAD))).toBe(false);
  });
});
