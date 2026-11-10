// M2.8 axe and DOM audit on the settings pages, on web: a disabled switch row keeps text that passes AA, the radio helper's
// indent stays on the spacing scale, and a scroller that overflows can be reached by keyboard whatever it holds.
import { fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { RadioRows, SwitchRow } from '@/features/settings/components/SettingRows';
import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { hydrateThemePreference, space, themes } from '@/theme';
import { Text } from '@/ui';

import { renderUi } from '../ui/helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  usePathname: () => '/settings/notifications',
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true }),
  useFocusEffect: jest.fn(),
  usePreventRemove: () => jest.fn(),
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/state/online', () => ({ ...jest.requireActual('@/state/online'), useOnline: () => true }));

beforeAll(hydrateThemePreference);

const SPACING = new Set<number>(Object.values(space));

function styleOf(node: TestInstance): ViewStyle {
  return StyleSheet.flatten(node.props.style as ViewStyle) ?? {};
}

describe('settings a11y on web (M2.8)', () => {
  it('SET-07 offline: a disabled switch row dims the switch, its title keeps text.primary (text.disabled fails AA)', async () => {
    await renderUi(<SwitchRow title="In der Suche auffindbar" helper="Andere finden dich." value disabled onValueChange={jest.fn()} testID="row" />);
    const title = screen.getByText('In der Suche auffindbar');
    expect((styleOf(title) as { color?: string }).color).toBe(themes.carbon.color.text.primary);
    const toggle = screen.getByTestId('row.switch');
    expect(toggle.props['aria-disabled'] ?? toggle.props.accessibilityState?.disabled ?? toggle.props.disabled).toBeTruthy();
  });

  it('SET-07 offline: a disabled radio option keeps its title over its helper; only the radio dims (DQ-444)', async () => {
    await renderUi(
      <RadioRows label="Wer darf dir schreiben?" value="everyone" disabled onChange={jest.fn()} options={[{ value: 'everyone', label: 'Alle', helper: 'Jedes Mitglied.' }]} testID="radio" />,
    );
    expect((styleOf(screen.getByText('Alle')) as { color?: string }).color).toBe(themes.carbon.color.text.primary);
    expect((styleOf(screen.getByText('Jedes Mitglied.')) as { color?: string }).color).toBe(themes.carbon.color.text.secondary);
  });

  it('SET-07/SET-11: the radio helper indents with a slot and a scale gap, no padding off the scale', async () => {
    await renderUi(
      <RadioRows label="Wer darf dir schreiben?" value="everyone" onChange={jest.fn()} options={[{ value: 'everyone', label: 'Alle', helper: 'Jedes Mitglied.' }]} testID="radio" />,
    );
    let node: TestInstance | null = screen.getByTestId('radio.everyone.helper');
    for (let depth = 0; node && depth < 3; depth += 1, node = node.parent) {
      const style = styleOf(node);
      for (const key of ['padding', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'gap'] as const) {
        const value = style[key];
        if (typeof value === 'number') expect(SPACING.has(value)).toBe(true);
      }
    }
  });

  it('SET-09/SET-12: a scroller that overflows takes focus and is named by the page title', async () => {
    await renderUi(
      <SettingsPage routeId="SET-09" title="Benachrichtigungen" fallback="/settings" offlineLabel="Offline">
        <Text variant="body">Lädt</Text>
      </SettingsPage>,
    );
    const scroll = screen.getByTestId('SET-09.scroll');
    expect(scroll.props.tabIndex).toBeUndefined();
    // The role is there from the start: react-native-web renders a region as <section>, and a role that came with the overflow
    // swapped the element and remounted the page under it (an open sign-out dialog vanished, WebKit F1, round 2).
    expect(scroll.props.role).toBe('region');
    await fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 600 } } });
    await fireEvent(scroll, 'contentSizeChange', 390, 1400);
    const after = screen.getByTestId('SET-09.scroll');
    expect(after.props.tabIndex).toBe(0);
    expect(after.props.role).toBe('region');
    expect(after.props['aria-label'] ?? after.props.accessibilityLabel).toBe('Benachrichtigungen');
  });

  it('SET-12 restricted: a form scroller that overflows takes focus too, its CTA stands outside it (round 2)', async () => {
    await renderUi(
      <SettingsPage
        routeId="SET-12"
        title="Daten exportieren"
        fallback="/settings"
        offlineLabel="Offline"
        form={{ dirty: false, cta: { label: 'Export anfordern', onPress: jest.fn(), disabled: true } }}
      >
        <Text variant="body">Dein Konto ist eingeschränkt.</Text>
      </SettingsPage>,
    );
    const scroll = screen.getByTestId('SET-12.scroll');
    expect(scroll.props.tabIndex).toBeUndefined();
    expect(scroll.props.role).toBe('region');
    await fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 500 } } });
    await fireEvent(scroll, 'contentSizeChange', 390, 900);
    const after = screen.getByTestId('SET-12.scroll');
    expect(after.props.tabIndex).toBe(0);
    expect(after.props.role).toBe('region');
    expect(after.props['aria-label'] ?? after.props.accessibilityLabel).toBe('Daten exportieren');
  });
});
