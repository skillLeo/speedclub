/**
 * EVT-01 Karte, the "Spots" layer toggle (M5.9b contract §6/§8): one toggle chip with checkbox semantics and its own name, and while
 * it is on the rule that keeps the layer private, or the note that the spots cannot be loaded.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { SpotLayerToggle } from '@/features/dex/components/SpotLayerToggle';
import i18n from '@/i18n';
import { hydrateThemePreference } from '@/theme';

import { renderScreen } from './helpers';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Rigid: 'rigid', Soft: 'soft' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const ID = 'EVT-01.map.spots';
const COPY = {
  de: {
    name: 'Spots als Städte auf der Karte zeigen',
    caption: 'Städte, in denen mindestens 5 verschiedene Autos gespottet wurden. Spots erscheinen nach 24 Stunden.',
    unavailable: 'Die Spots lassen sich gerade nicht laden.',
  },
  en: {
    name: 'Show spots as cities on the map',
    caption: 'Cities where at least 5 different cars were spotted. Spots appear after 24 hours.',
    unavailable: "The spots can't be loaded right now.",
  },
} as const;

beforeAll(hydrateThemePreference);
afterEach(async () => {
  await i18n.changeLanguage('de');
  jest.clearAllMocks();
});

describe('SpotLayerToggle (EVT-01 Karte › Spots)', () => {
  it('off: an unchecked checkbox named for what it does, labelled "Spots", and no caption', async () => {
    await renderScreen(<SpotLayerToggle on={false} onChange={jest.fn()} failed={false} testID={ID} />);
    const chip = screen.getByRole('checkbox', { name: COPY.de.name });
    expect(chip).toBe(screen.getByRole('checkbox', { name: COPY.de.name, checked: false }));
    expect(screen.getByTestId(`${ID}.chip`)).toBeTruthy();
    expect(screen.getByText('Spots')).toBeTruthy();
    expect(screen.queryByTestId(`${ID}.caption`)).toBeNull();
    expect(screen.queryByText(COPY.de.caption)).toBeNull();
  });

  it('on: checked, with the privacy rule as its caption', async () => {
    await renderScreen(<SpotLayerToggle on onChange={jest.fn()} failed={false} testID={ID} />);
    expect(screen.getByRole('checkbox', { name: COPY.de.name, checked: true })).toBeTruthy();
    expect(screen.getByTestId(`${ID}.caption`)).toHaveTextContent(COPY.de.caption, { exact: true });
  });

  it('failed: still checked, the caption says the spots cannot be loaded instead of the rule', async () => {
    await renderScreen(<SpotLayerToggle on onChange={jest.fn()} failed testID={ID} />);
    expect(screen.getByRole('checkbox', { name: COPY.de.name, checked: true })).toBeTruthy();
    expect(screen.getByTestId(`${ID}.caption`)).toHaveTextContent(COPY.de.unavailable, { exact: true });
    expect(screen.queryByText(COPY.de.caption)).toBeNull();
  });

  it('failed while off shows nothing under the chip', async () => {
    await renderScreen(<SpotLayerToggle on={false} onChange={jest.fn()} failed testID={ID} />);
    expect(screen.queryByTestId(`${ID}.caption`)).toBeNull();
  });

  it.each([
    [false, true],
    [true, false],
  ])('a press while on=%s asks for on=%s once, with a selection haptic', async (on, next) => {
    const onChange = jest.fn();
    await renderScreen(<SpotLayerToggle on={on} onChange={onChange} failed={false} testID={ID} />);
    await fireEvent.press(screen.getByRole('checkbox', { name: COPY.de.name }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(next);
    expect(Haptics.selectionAsync).toHaveBeenCalled();
  });

  it('speaks English in English', async () => {
    await i18n.changeLanguage('en');
    await renderScreen(<SpotLayerToggle on onChange={jest.fn()} failed={false} testID={ID} />);
    expect(screen.getByRole('checkbox', { name: COPY.en.name, checked: true })).toBeTruthy();
    expect(screen.getByTestId(`${ID}.caption`)).toHaveTextContent(COPY.en.caption, { exact: true });
  });

  it('speaks English when it fails in English', async () => {
    await i18n.changeLanguage('en');
    await renderScreen(<SpotLayerToggle on onChange={jest.fn()} failed testID={ID} />);
    expect(screen.getByTestId(`${ID}.caption`)).toHaveTextContent(COPY.en.unavailable, { exact: true });
  });
});
