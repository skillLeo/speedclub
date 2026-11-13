/** M4.9 + M4.11 (09 §7.6, §8.5–§8.6): VEH-01 action row, build follow, save sheet, Highlights; VEH-05 reactions; UPD-01. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { PostUpdateScreen } from '@/features/updates/screens/PostUpdateScreen';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { UpdateDetailScreen } from '@/features/vehicle/screens/UpdateDetailScreen';
import { useSessionStore } from '@/state/session';
import * as toastModule from '@/ui/toast';
import { hydrateThemePreference } from '@/theme';

import { R34 } from './fixtures';
import { newQueryClient, renderWithProviders, stubFetch } from './harness';

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
  useNavigation: () => ({
    getParent: () => undefined,
    canGoBack: () => true,
    goBack: jest.fn(),
    dispatch: jest.fn(),
  }),
  usePreventRemove: jest.fn(() => jest.fn()),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
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

const text = (testID: string) => screen.getByTestId(testID);
const signIn = (username = 'max.e46') =>
  useSessionStore.setState({
    status: 'member',
    member: { id: 'viewer', username, displayName: 'Max', avatarUrl: null },
  });
const setParams = (next: Record<string, string>) => {
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  Object.assign(mockParams, next);
};
const withFlags = (flags: Record<string, boolean>) => {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, {
    config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, ...flags } },
    confirmed: true,
  });
  return client;
};
const SOCIAL = { my_reaction: null, is_following: false, comments_enabled: true };
const methodOf = (call: Request) => call.method;
const pathOf = (call: Request) => new URL(call.url).pathname;

let toastSpy: jest.SpyInstance;
beforeAll(hydrateThemePreference);
afterEach(() => toastSpy.mockRestore());
beforeEach(() => {
  jest.clearAllMocks();
  toastSpy = jest.spyOn(toastModule, 'toast');
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('VEH-01 action row (09 §7.6 (4), DQ-942, DQ-972)', () => {
  it('keeps at most two controls over the hero and puts Speichern and Teilen in the row', async () => {
    stubFetch({ '/highlights': { body: { data: [] } } });
    await renderWithProviders(
      <VehicleProfile vehicle={R34} onBack={jest.fn()} />,
      withFlags({ 'sig.saved_builds': true }),
    );
    const header = text('VEH-01.header');
    expect(within(header).queryByTestId('VEH-01.save')).toBeNull();
    expect(within(header).queryByTestId('VEH-01.share')).toBeNull();
    expect(within(header).getByTestId('VEH-01.moreActions')).toBeTruthy();
    const row = text('VEH-01.actions');
    expect(within(row).getByTestId('VEH-01.save')).toBeTruthy();
    expect(within(row).getByTestId('VEH-01.share')).toBeTruthy();
  });

  it('follows the build, not the owner, when vehicle_follow is on (optimistic, private count)', async () => {
    signIn();
    const { calls } = stubFetch({
      '/highlights': { body: { data: [] } },
      [`/vehicles/${R34.id}/follow`]: { body: { data: { vehicle_id: R34.id, is_following: true } } },
    });
    await renderWithProviders(
      <VehicleProfile vehicle={{ ...R34, social: SOCIAL }} onBack={jest.fn()} />,
      withFlags({ vehicle_follow: true }),
    );
    const follow = text('VEH-01.actions.follow');
    expect(follow.props.accessibilityLabel).toBe('Folgen');
    expect(follow.props['aria-pressed']).toBe(false);
    await act(async () => fireEvent.press(follow));
    await waitFor(() =>
      expect(
        calls.some((call) => methodOf(call) === 'PUT' && pathOf(call).endsWith(`/vehicles/${R34.id}/follow`)),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith('Du folgst jetzt diesem Build.', expect.anything()),
    );
    expect(calls.some((call) => pathOf(call).includes('/users/'))).toBe(false);
  });

  it('saves with one tap and offers the collections from the toast and a long press', async () => {
    signIn();
    const { calls } = stubFetch({
      '/highlights': { body: { data: [] } },
      [`/vehicles/${R34.id}/save`]: { body: { data: { vehicle_id: R34.id, is_saved: true } } },
      '/me/collections': {
        body: {
          data: [
            {
              id: 'c1',
              name: 'Gespeichert',
              is_default: true,
              position: 0,
              items_count: 3,
              covers: [],
              contains: true,
              created_at: null,
              updated_at: null,
            },
            {
              id: 'c2',
              name: 'JDM',
              is_default: false,
              position: 1,
              items_count: 1,
              covers: [],
              contains: false,
              created_at: null,
              updated_at: null,
            },
          ],
        },
      },
      '/me/collections/c2/items': { body: { data: {} } },
    });
    await renderWithProviders(
      <VehicleProfile vehicle={{ ...R34, is_saved: false, social: SOCIAL }} onBack={jest.fn()} />,
      withFlags({ 'sig.saved_builds': true, collections: true }),
    );
    const save = text('VEH-01.save');
    expect(save.props['aria-pressed']).toBe(false);
    await act(async () => fireEvent.press(save));
    await waitFor(() =>
      expect(
        calls.some((call) => methodOf(call) === 'POST' && pathOf(call).endsWith(`/vehicles/${R34.id}/save`)),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        'Gespeichert',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Sammlung wählen' }) }),
      ),
    );
    await act(async () => fireEvent(text('VEH-01.save'), 'longPress'));
    expect(await screen.findByTestId('VEH-01.saveSheet.private')).toHaveTextContent(
      'Sammlungen sind privat.',
      { exact: false },
    );
    const listCall = calls.find((call) => pathOf(call).endsWith('/me/collections'));
    expect(new URL(listCall!.url).searchParams.get('contains_id')).toBe(R34.id);
    await act(async () => fireEvent.press(await screen.findByTestId('VEH-01.saveSheet.collection.c2')));
    await waitFor(() =>
      expect(
        calls.some((call) => methodOf(call) === 'POST' && pathOf(call).endsWith('/me/collections/c2/items')),
      ).toBe(true),
    );
  });

  it('gives the owner the capsule with Update posten instead of the visitor row', async () => {
    signIn('lukas.sc');
    stubFetch({ '/highlights': { body: { data: [] } } });
    await renderWithProviders(
      <VehicleProfile
        vehicle={{ ...R34, is_owner: true, owner: { ...R34.owner!, is_self: true } }}
        onBack={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('VEH-01.actions')).toBeNull();
    await fireEvent.press(text('VEH-01.ownerCapsule.primary'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/post-update', params: { vehicleId: R34.id } });
  });
});

describe('VEH-01 Highlights (09 §8.5)', () => {
  const photo = R34.photos[1]!;

  it('shows the pinned rail to visitors and nothing when it is empty', async () => {
    stubFetch({
      '/highlights': {
        body: { data: [{ type: 'photo', id: photo.id, position: 0, build_update: null, photo }] },
      },
    });
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    expect(await screen.findByTestId('VEH-01.pins.0')).toBeTruthy();
    expect(screen.queryByTestId('VEH-01.pins.header.action')).toBeNull();
  });

  it('lets the owner pin a photo and saves the whole rail', async () => {
    signIn('lukas.sc');
    const { calls } = stubFetch({ '/highlights': () => ({ body: { data: [] } }) });
    await renderWithProviders(
      <VehicleProfile
        vehicle={{ ...R34, is_owner: true, owner: { ...R34.owner!, is_self: true } }}
        onBack={jest.fn()}
      />,
    );
    await act(async () => fireEvent.press(await screen.findByTestId('VEH-01.pins.pick')));
    await act(async () => fireEvent.press(await screen.findByTestId(`VEH-01.pins.editor.photo.${photo.id}`)));
    await act(async () => fireEvent.press(text('VEH-01.pins.editor.save')));
    const put = await waitFor(() => {
      const found = calls.find(
        (call) => methodOf(call) === 'PUT' && pathOf(call).endsWith(`/vehicles/${R34.id}/highlights`),
      );
      expect(found).toBeTruthy();
      return found!;
    });
    expect(await put.json()).toEqual({ items: [{ type: 'photo', id: photo.id }] });
  });
});

describe('VEH-05 reactions and photos (09 §8.5)', () => {
  const update = {
    ...R34.updates[0]!,
    type: 'post' as const,
    note: 'Neue Abstimmung mit @lukas.sc fertig.',
    mentions: [{ ...R34.owner!, username: 'lukas.sc' }],
  };

  it('lets a visitor react without ever seeing a count', async () => {
    signIn();
    setParams({ slug: R34.slug, updateId: update.id });
    const { calls } = stubFetch({
      [`/updates/${update.id}`]: { body: { data: update } },
      [`/public/vehicles/${R34.slug}`]: { body: { data: R34 } },
      [`/build-updates/${update.id}/reactions`]: {
        body: { data: { target_type: 'build-updates', target_id: update.id, my_reaction: 'strong' } },
      },
    });
    await renderWithProviders(<UpdateDetailScreen />, withFlags({ build_reactions: true }));
    expect(await screen.findByTestId('VEH-05.react')).toBeTruthy();
    expect(screen.queryByTestId('VEH-05.reactions')).toBeNull();
    expect(text('VEH-05.note.mention.lukas.sc')).toHaveTextContent('@lukas.sc');
    await act(async () =>
      fireEvent(text('VEH-05.react.button'), 'accessibilityAction', {
        nativeEvent: { actionName: 'strong' },
      }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            methodOf(call) === 'PUT' && pathOf(call).endsWith(`/build-updates/${update.id}/reactions`),
        ),
      ).toBe(true),
    );
  });

  it('shows the owner the private summary and no react button', async () => {
    signIn('lukas.sc');
    setParams({ slug: R34.slug, updateId: update.id });
    const owned = { ...update, reaction_summary: { strong: 2, clean: 1, low: 0, loud: 0, total: 3 } };
    stubFetch({
      [`/updates/${update.id}`]: { body: { data: owned } },
      [`/public/vehicles/${R34.slug}`]: {
        body: { data: { ...R34, is_owner: true, owner: { ...R34.owner!, is_self: true } } },
      },
    });
    await renderWithProviders(<UpdateDetailScreen />, withFlags({ build_reactions: true }));
    expect(await screen.findByTestId('VEH-05.reactions.hint')).toHaveTextContent(
      'Nur du siehst, wer wie reagiert hat.',
    );
    expect(text('VEH-05.reactions.strong')).toHaveTextContent('2');
    expect(screen.queryByTestId('VEH-05.react')).toBeNull();
  });

  it('renders a before/after pair as the slider and keeps comments hidden while the flag is off', async () => {
    const [before, after] = R34.photos;
    setParams({ slug: R34.slug, updateId: update.id });
    stubFetch({
      [`/updates/${update.id}`]: {
        body: {
          data: {
            ...update,
            photos: [before, after],
            photo_pairs: [{ before: before!.id, after: after!.id }],
          },
        },
      },
      [`/public/vehicles/${R34.slug}`]: { body: { data: R34 } },
    });
    await renderWithProviders(<UpdateDetailScreen />);
    expect(await screen.findByTestId('VEH-05.beforeAfter.0')).toBeTruthy();
    expect(screen.queryByTestId('VEH-05.comments')).toBeNull();
  });
});

describe('UPD-01 Update posten (09 §7.6, §8.5)', () => {
  const card = { ...R34, status: 'published' as const };

  it('suggests members after @, inserts the name and posts the update', async () => {
    signIn('lukas.sc');
    setParams({ vehicleId: R34.id });
    const { calls } = stubFetch({
      '/me/vehicles': { body: { data: [card] } },
      [`/vehicles/${R34.id}/mods`]: {
        body: {
          data: [],
          links: {},
          meta: { next_cursor: null, per_page: 50, path: null, prev_cursor: null },
        },
      },
      '/mentions/suggest': {
        body: {
          data: [
            {
              username: 'max.e46',
              display_name: 'Max',
              city: null,
              avatar: null,
              is_sample: false,
              is_editorial: false,
            },
          ],
        },
      },
      '/build-updates': {
        status: 201,
        body: { data: { ...R34.updates[0]!, id: 'new-update', type: 'post' } },
      },
    });
    await renderWithProviders(<PostUpdateScreen />, withFlags({ mentions: true }));
    const field = await screen.findByTestId('UPD-01.text');
    await act(async () => fireEvent.changeText(field, 'Danke @ma'));
    await act(async () =>
      fireEvent(field, 'selectionChange', { nativeEvent: { selection: { start: 9, end: 9 } } }),
    );
    await act(async () => fireEvent.press(await screen.findByTestId('UPD-01.mention.max.e46')));
    expect(text('UPD-01.text').props.value).toBe('Danke @max.e46 ');
    await act(async () => fireEvent.press(text('UPD-01.audience.followers')));
    await act(async () => fireEvent.press(text('UPD-01.cta.primary')));
    const post = await waitFor(() => {
      const found = calls.find(
        (call) => methodOf(call) === 'POST' && pathOf(call).endsWith('/build-updates'),
      );
      expect(found).toBeTruthy();
      return found!;
    });
    expect(post.headers.get('Idempotency-Key')).toBe('uuid-1');
    expect(await post.json()).toMatchObject({
      vehicle_id: R34.id,
      text: 'Danke @max.e46',
      audience: 'followers',
      modification_ids: [],
    });
  });

  it('asks for text or photos before posting', async () => {
    signIn('lukas.sc');
    setParams({ vehicleId: R34.id });
    const { calls } = stubFetch({
      '/me/vehicles': { body: { data: [card] } },
      [`/vehicles/${R34.id}/mods`]: {
        body: {
          data: [],
          links: {},
          meta: { next_cursor: null, per_page: 50, path: null, prev_cursor: null },
        },
      },
    });
    await renderWithProviders(<PostUpdateScreen />);
    await screen.findByTestId('UPD-01.text');
    await act(async () => fireEvent.press(text('UPD-01.cta.primary')));
    expect(await screen.findByText('Schreib etwas oder füge Fotos hinzu.')).toBeTruthy();
    expect(calls.some((call) => methodOf(call) === 'POST')).toBe(false);
  });
});
