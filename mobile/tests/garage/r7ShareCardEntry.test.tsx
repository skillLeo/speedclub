/**
 * Client round 7, item 4a (R7-4a): "on car garage, you can't share your car card because the button is missing". VEH-01's "Mehr" had
 * "Als Karte teilen" (VEH-07), but the garage replaced that sheet with its own (GAR-02's "Mehr" and the capsule's menu), which had no
 * such row, and GAR-01's quick actions had none either. Now all three lead to VEH-07 for a published, not private build while
 * `sig.share_cards` is on; with the flag off (production's default) none of them shows.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { ownerCapsuleOf } from '@/features/garage/components/OwnerToolbar';
import { QuickActions } from '@/features/garage/components/QuickActions';
import { GarageScreen } from '@/features/garage/screens/GarageScreen';
import { garageMoreActions } from '@/features/garage/screens/GarageVehicleScreen';
import { canShareCard } from '@/features/vehicle/shareCard';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { R34 } from '../vehicle/fixtures';
import { card, SLUG, VEHICLE_ID } from './fixtures';
import { list, ME, newQueryClient, renderScreen, signIn, stubFetch } from './harness';

const mockWindow: { current: { width: number; height: number; scale: number; fontScale: number } } = { current: { width: 390, height: 844, scale: 1, fontScale: 1 } };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow.current }));

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
const mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/garage',
  useNavigation: () => ({ getParent: () => undefined, canGoBack: () => true, goBack: jest.fn(), dispatch: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  usePreventRemove: jest.fn(),
  Link: ({ children }: { children: unknown }) => children,
}));
type MockListProps = { data: readonly unknown[]; renderItem: (info: { item: unknown; index: number }) => ReactNode; ListHeaderComponent?: ReactNode; ListEmptyComponent?: ReactNode; ListFooterComponent?: ReactNode };
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), scrollToIndex: jest.fn(() => Promise.resolve()), getScrollableNode: () => null }));
    const items = props.data.map((item, index) => createElement(Fragment, { key: index }, props.renderItem({ item, index })));
    return createElement(Fragment, null, props.ListHeaderComponent, props.data.length === 0 ? props.ListEmptyComponent : items, props.ListFooterComponent);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

jest.setTimeout(60_000);

const SHARE_CARD = { pathname: '/share-card/[vehicleId]', params: { vehicleId: VEHICLE_ID } };
/** The owner's public page of the garage's car (the page GAR-02 draws). */
const PAGE: PublicVehicle = { ...R34, id: VEHICLE_ID, slug: SLUG, is_owner: true, status: 'published', visibility: 'public' };

function clientWith(shareCards: boolean) {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, 'sig.share_cards': shareCards } }, confirmed: true });
  return client;
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
});
afterAll(() => useSessionStore.setState({ status: 'loading', member: null }));

describe('R7-4a canShareCard', () => {
  it('needs the flag, a published build and a visibility other than private', () => {
    expect(canShareCard({ status: 'published', visibility: 'public' }, true)).toBe(true);
    expect(canShareCard({ status: 'published', visibility: 'members' }, true)).toBe(true);
    expect(canShareCard({ status: 'published', visibility: 'public' }, false)).toBe(false);
    expect(canShareCard({ status: 'draft', visibility: 'public' }, true)).toBe(false);
    expect(canShareCard({ status: 'published', visibility: 'private' }, true)).toBe(false);
  });
});

describe('R7-4a GAR-02 (the member’s car in the garage)', () => {
  const deps = (shareCards: boolean, go = jest.fn()) => ({
    t: ((key: string) => key) as never,
    go,
    maintenance: false,
    shareCards,
    makeMain: jest.fn(),
    share: jest.fn(),
    copy: jest.fn(),
  });

  it('"Mehr" (GarageVehicleScreen builds it with garageMoreActions) offers "Als Karte teilen", which opens VEH-07', () => {
    const go = jest.fn();
    const actions = garageMoreActions(PAGE, deps(true, go));
    const card = actions.find((action) => action.key === 'shareCard');
    expect(card?.label).toBe('owner.shareCard');
    // After "Teilen" (the link), before the owner's settings.
    expect(actions.map((action) => action.key).indexOf('shareCard')).toBe(actions.map((action) => action.key).indexOf('share') + 1);
    card?.onPress();
    expect(go).toHaveBeenCalledWith(SHARE_CARD);
  });

  it('shows no card row while sig.share_cards is off (production’s default), for a draft or a private car', () => {
    expect(garageMoreActions(PAGE, deps(false)).some((action) => action.key === 'shareCard')).toBe(false);
    expect(garageMoreActions({ ...PAGE, status: 'draft' }, deps(true)).some((action) => action.key === 'shareCard')).toBe(false);
    expect(garageMoreActions({ ...PAGE, visibility: 'private' }, deps(true)).some((action) => action.key === 'shareCard')).toBe(false);
  });

  it('the capsule’s menu carries it too, only when the screen passes the way to the card', () => {
    const t = ((key: string) => key) as never;
    const go = jest.fn();
    const open = jest.fn();
    const withCard = ownerCapsuleOf(PAGE, 'GAR-02', { t, go, onEdit: jest.fn(), onShare: jest.fn(), onShareCard: open });
    const item = withCard.more.find((entry) => entry.key === 'shareCard');
    expect(item?.label).toBe('owner.shareCard');
    item?.onSelect?.();
    expect(open).toHaveBeenCalled();
    const without = ownerCapsuleOf(PAGE, 'GAR-02', { t, go, onEdit: jest.fn(), onShare: jest.fn() });
    expect(without.more.some((entry) => entry.key === 'shareCard')).toBe(false);
  });
});

describe('R7-4a GAR-01 quick actions', () => {
  it('the published car has a share-card button after the sticker, which opens VEH-07', async () => {
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/vehicles': list([card()]) });
    await renderScreen(<GarageScreen />, clientWith(true));
    const button = await screen.findByTestId(`GAR-01.card.${VEHICLE_ID}.shareCard`, {}, { timeout: 15_000 });
    expect(button).toHaveAccessibleName(`${card().full_title} als Karte teilen`);
    await fireEvent.press(button);
    expect(mockRouter.push).toHaveBeenCalledWith(SHARE_CARD);
  });

  it('has none with the flag off, for a draft or a private car', async () => {
    const onAction = jest.fn();
    await renderScreen(<QuickActions card={card({ status: 'draft' })} onAction={onAction} testID="GAR-01.card.x" />);
    expect(screen.queryByTestId('GAR-01.card.x.shareCard')).toBeNull();
    await screen.unmount();
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/vehicles': list([card()]) });
    await renderScreen(<GarageScreen />, clientWith(false));
    await screen.findByTestId(`GAR-01.card.${VEHICLE_ID}.update`, {}, { timeout: 15_000 });
    expect(screen.queryByTestId(`GAR-01.card.${VEHICLE_ID}.shareCard`)).toBeNull();
  });
});
