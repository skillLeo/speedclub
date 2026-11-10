// M2.2 test F1: while a pushed page covers Start (display:none on web) every chip reports 0 × 0. Those layouts must not change the cut.
import { fireEvent, screen } from '@testing-library/react-native';

import { PopularModsChips } from '@/features/home/components/PopularModsChips';
import type { PopularMod } from '@/api/queries/home';
import { hydrateThemePreference } from '@/theme';

import { renderWithProviders } from './harness';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const MODS: PopularMod[] = ['KW V3', 'BBS', 'Akrapovič', 'Recaro', 'Brembo', 'Eibach', 'Öhlins'].map((label) => ({ label, category_key: null, query: label }));
const layout = (width: number, height: number, x = 0, y = 0) => ({ nativeEvent: { layout: { x, y, width, height } } });
const ROW = 300;
/** Widths that fill two lines of 300 with five chips: 100 + 100 + 84, then 150 + 142. */
const WIDTHS = [100, 100, 84, 150, 142, 90, 90];

beforeAll(hydrateThemePreference);

async function measured() {
  await renderWithProviders(<PopularModsChips mods={MODS} width={ROW} onOpen={jest.fn()} testID="HOME-01.mods.list" />);
  await fireEvent(screen.getByTestId('HOME-01.mods.list'), 'layout', layout(ROW, 80));
  for (const [index, width] of WIDTHS.entries()) {
    await fireEvent(screen.getByTestId(`HOME-01.mods.list.item.${index}`), 'layout', layout(width, 36));
  }
}

const shownChips = () => MODS.filter((_, index) => screen.queryByTestId(`HOME-01.mods.list.chip.${index}`) !== null).length;

describe('Beliebte Mods: two lines through a hidden screen', () => {
  it('draws every chip once to measure, then only those of the first two lines', async () => {
    await renderWithProviders(<PopularModsChips mods={MODS} width={ROW} onOpen={jest.fn()} testID="HOME-01.mods.list" />);
    expect(shownChips()).toBe(MODS.length);
    await fireEvent(screen.getByTestId('HOME-01.mods.list'), 'layout', layout(ROW, 120));
    for (const [index, width] of WIDTHS.entries()) {
      await fireEvent(screen.getByTestId(`HOME-01.mods.list.item.${index}`), 'layout', layout(width, 36));
    }
    expect(shownChips()).toBe(5);
  });

  it('keeps the cut while the screen is hidden and after it comes back', async () => {
    await measured();
    expect(shownChips()).toBe(5);

    // VEH-01 covers Start: the row and the chips it draws report 0 × 0 at y 0.
    await fireEvent(screen.getByTestId('HOME-01.mods.list'), 'layout', layout(0, 0));
    for (let index = 0; index < 5; index += 1) await fireEvent(screen.getByTestId(`HOME-01.mods.list.item.${index}`), 'layout', layout(0, 0));
    expect(shownChips()).toBe(5);

    // Back: the real layouts again, nothing added.
    await fireEvent(screen.getByTestId('HOME-01.mods.list'), 'layout', layout(ROW, 80));
    for (let index = 0; index < 5; index += 1) await fireEvent(screen.getByTestId(`HOME-01.mods.list.item.${index}`), 'layout', layout(WIDTHS[index] ?? 0, 36));
    expect(shownChips()).toBe(5);
  });

  it('measures again for a wider row, from the widths it knows', async () => {
    await measured();
    await fireEvent(screen.getByTestId('HOME-01.mods.list'), 'layout', layout(600, 80));
    expect(shownChips()).toBe(MODS.length);
  });
});
