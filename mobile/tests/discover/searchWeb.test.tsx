// BH-38 on the member web: react-native-web blurs the focused field on every scroll event with `keyboardDismissMode`, not only on a
// drag, and the list scrolls by itself when an answer arrives.
import { screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { SearchScreen } from '@/features/discover/screens/SearchScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { MAKES, overview, R34 } from '../home/fixtures';
import { renderWithProviders, stubFetch } from '../home/harness';

jest.mock('@/lib/platform', () => ({ isWeb: true, isNative: false, isIOS: false, isAndroid: false }));
jest.mock('@/theme/webDocument', () => ({ applyThemeToDocument: jest.fn(), applyLocaleToDocument: jest.fn(), markDocumentReady: jest.fn(), reportQaSession: jest.fn() }));
jest.mock('@/state/online', () => ({ useOnline: () => true }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ q: 'm4' }),
  usePathname: () => '/discover/search',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  ListEmptyComponent?: ReactNode;
  keyboardDismissMode?: string;
  maintainVisibleContentPosition?: { disabled?: boolean };
};
const mockLastList: { props: MockListProps | null } = { props: null };
const mockNode = { scrollTop: 0, clientHeight: 800, addEventListener: jest.fn(), removeEventListener: jest.fn() };
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), getScrollableNode: () => mockNode }));
    mockLastList.props = props;
    const items = props.data.map((item, index) => createElement(Fragment, { key: index }, props.renderItem({ item, index })));
    return createElement(Fragment, null, props.data.length === 0 ? props.ListEmptyComponent : items);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve({ type: 'dismiss' })) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('DISC-02 on the member web', () => {
  it('never dismisses the keyboard from the list, and keeps no anchor', async () => {
    stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<SearchScreen />);
    await screen.findByTestId(`DISC-02.vehicle.${R34.id}`);
    expect(mockLastList.props?.keyboardDismissMode).toBeUndefined();
    expect(mockLastList.props?.maintainVisibleContentPosition).toEqual({ disabled: true });
  });

  it('keeps its place while a pushed page or another tab hides it (BH-41)', async () => {
    stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<SearchScreen />);
    await screen.findByTestId(`DISC-02.vehicle.${R34.id}`);
    expect(mockNode.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
