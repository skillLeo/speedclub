// VEH-06 on phones: the pinned pair in the gutter (DQ-414), the skeleton in the list's geometry (DQ-422) and the action of the
// same-build state (DQ-430).
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { COMPARE_FLAG, type CompareResource } from '@/features/vehicle/compare';
import { CompareScreen } from '@/features/vehicle/screens/CompareScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, layout, radius, space, themes, typography } from '@/theme';
import { vehicleNameText } from '@/ui/textBreaks';

import { flat } from '../ui/helpers';
import { R34 } from './fixtures';
import { newQueryClient, renderWithProviders, stubFetch } from './harness';

const A = 'nissan-skyline-gt-r-r34-5tf974vj';
const B = 'bmw-m4-g82-ab12cd34';
const mockParams: Record<string, string | undefined> = { a: A, b: B };
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
  usePathname: () => '/compare',
  useNavigation: () => ({ getParent: () => undefined, getState: () => undefined, canGoBack: () => false, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
// Items render in place: virtualisation is FlashList's own business and needs a layout Jest does not have.
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  contentContainerStyle?: unknown;
  testID?: string;
};
jest.mock('@shopify/flash-list', () => {
  const { forwardRef } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList({ data, renderItem, contentContainerStyle, testID }, _ref) {
    return (
      <View testID={testID} style={contentContainerStyle as never}>
        {data.map((item, index) => (
          <View key={index}>{renderItem({ item, index })}</View>
        ))}
      </View>
    );
  });
  return { FlashList };
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: jest.fn() }));
const dimensions = useWindowDimensions as jest.Mock;
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const card = (slug: string, full_title: string): CompareResource['a'] => ({ ...R34, slug, full_title }) as unknown as CompareResource['a'];
const ANSWER: CompareResource = {
  a: card(A, 'Nissan Skyline GT-R R34 V-Spec II Nür'),
  b: card(B, 'BMW M4 G82 Competition xDrive'),
  specs: [
    {
      key: 'engine',
      label: 'Motor',
      rows: [
        { key: 'code', label: 'Motorcode', a: 'RB26DETT', b: 'S58', differs: true },
        { key: 'fuel', label: 'Kraftstoff', a: 'Benzin', b: 'Benzin', differs: false },
      ],
    },
  ],
  mods: [],
};

const compareEnabled = () => {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, {
    config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, [COMPARE_FLAG]: true } },
    confirmed: true,
  });
  return client;
};
const at = (width: number, fontScale = 1) => dimensions.mockReturnValue({ width, height: 844, scale: 2, fontScale });

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockParams, { a: A, b: B });
  at(390);
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('VEH-06 compare header on phones (DQ-414)', () => {
  it.each([
    [360, layout.gutter.compact],
    [390, layout.gutter.regular],
    [430, layout.gutter.regular],
  ])('at %i keeps the pinned pair in the gutter of %i, as the table under it', async (width, gutter) => {
    at(width);
    stubFetch({ '/compare': { body: { data: ANSWER } } });
    await renderWithProviders(<CompareScreen />, compareEnabled());
    await screen.findByTestId('VEH-06.cars');
    // FlashList draws a sticky header outside its content container, so the padding is the rows' own, the pair's included.
    expect(flat(screen.getByTestId('VEH-06.list').props.style)?.paddingHorizontal).toBeUndefined();
    expect(flat(screen.getByTestId('VEH-06.sticky').props.style).paddingHorizontal).toBe(gutter);
    // Two columns 12 apart, each half of what the gutter leaves: the table's value columns use the same pair.
    expect(flat(screen.getByTestId('VEH-06.cars').props.style).gap).toBe(space[12]);
  });

  it('shows each photo at 4:3 with radius 8 and a labelS title in text.primary that wraps, never cut', async () => {
    at(390, 2);
    stubFetch({ '/compare': { body: { data: ANSWER } } });
    await renderWithProviders(<CompareScreen />, compareEnabled());
    for (const side of ['a', 'b'] as const) {
      const photo = flat((await screen.findByTestId(`VEH-06.car.${side}.photo`)).props.style);
      expect(photo.aspectRatio).toBeCloseTo(4 / 3);
      expect(photo.borderRadius).toBe(radius.sm);
      const title = screen.getByTestId(`VEH-06.car.${side}.title`);
      expect(title.props.numberOfLines).toBeUndefined();
      expect(flat(title.props.style).color).toBe(themes.carbon.color.text.primary);
    }
    // DQ-438: the whole title, with "GT-R" and "V-Spec" kept whole (a word joiner after the hyphen), so 200 % never breaks "GT- / R".
    expect(screen.getByTestId('VEH-06.car.a.title')).toHaveTextContent(vehicleNameText('Nissan Skyline GT-R R34 V-Spec II Nür'));
    expect(screen.getByTestId('VEH-06.car.a.title')).toHaveTextContent('GT-\u2060R', { exact: false });
    expect(flat(screen.getByTestId('VEH-06.car.a.title').props.style).fontSize).toBe(typography.labelS.fontSize);
  });
});

describe('VEH-06 skeleton (DQ-422)', () => {
  it('starts where the list starts, with the pair in the gutter, photos 4:3, a title row and fewer rows than the content', async () => {
    at(390);
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    await renderWithProviders(<CompareScreen />, compareEnabled());
    const skeleton = await screen.findByTestId('VEH-06.skeleton');
    // Not in the centred state frame: that one pads 32 above and centres its child.
    expect(flat(skeleton.props.style).justifyContent).toBeUndefined();
    const sticky = flat(screen.getByTestId('VEH-06.skeleton.sticky').props.style);
    expect(sticky.paddingHorizontal).toBe(layout.gutter.regular);
    expect(sticky.paddingTop).toBe(space[8]);
    expect(sticky.paddingBottom).toBe(space[12]);
    for (const side of ['a', 'b'] as const) {
      expect(flat(screen.getByTestId(`VEH-06.skeleton.car.${side}.photo`).props.style).aspectRatio).toBeCloseTo(4 / 3);
      expect(screen.getByTestId(`VEH-06.skeleton.car.${side}.title`)).toBeTruthy();
    }
    expect(screen.getAllByTestId('VEH-06.skeleton.row')).toHaveLength(4);
  });
});

describe('VEH-06 same build (DQ-430)', () => {
  it('offers one secondary M button that opens the picker for the second build', async () => {
    Object.assign(mockParams, { a: A, b: A });
    stubFetch({});
    await renderWithProviders(<CompareScreen />, compareEnabled());
    const action = await screen.findByTestId('VEH-06.same.action');
    expect(action).toHaveTextContent('Anderes Fahrzeug wählen');
    expect(screen.queryByText('Vergleichen mit')).toBeNull();
    await fireEvent.press(action);
    await waitFor(() => expect(screen.getByText('Vergleichen mit')).toBeTruthy());
  });
});
