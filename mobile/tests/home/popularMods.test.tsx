// BUG-5: the Beliebte Mods row decides its cut before the first paint, from the column width and the label metrics. No layout
// round-trip: a hidden screen (0 × 0 on web) or a recycled list cell can neither change the cut nor render the row again.
import { Profiler } from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { chipsShown, estimatedChipWidth, PopularModsChips } from '@/features/home/components/PopularModsChips';
import type { PopularMod } from '@/api/queries/home';
import { hydrateThemePreference, size } from '@/theme';

import { renderWithProviders } from './harness';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const LABELS = ['KW V3', 'BBS', 'Akrapovič', 'Recaro', 'Brembo', 'Eibach', 'Öhlins', 'H&R', 'Bilstein B16', 'Milltek'];
const MODS: PopularMod[] = LABELS.map((label) => ({ label, category_key: null, query: label }));
const layout = (width: number, height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });

beforeAll(hydrateThemePreference);

const shownChips = () => MODS.filter((_, index) => screen.queryByTestId(`HOME-01.mods.list.chip.${index}`) !== null).length;

describe('Beliebte Mods (BUG-5)', () => {
  it('estimates a chip at least as wide as its frame and the 44 minimum, wider with the font scale', () => {
    expect(estimatedChipWidth('BBS', 1)).toBeGreaterThanOrEqual(size.touchMin);
    expect(estimatedChipWidth('Bilstein B16', 2)).toBeGreaterThan(estimatedChipWidth('Bilstein B16', 1) * 1.6);
    // A font scale below 1 never makes the estimate narrower than at 1 (the estimate must never claim a fit the screen denies).
    expect(estimatedChipWidth('Recaro', 0.85)).toBe(estimatedChipWidth('Recaro', 1));
  });

  it('keeps the chips of the first two lines, fewer at 200 %, at least one on any row', () => {
    const phone = chipsShown(LABELS, 350, 1);
    const large = chipsShown(LABELS, 350, 2);
    expect(phone).toBeGreaterThan(2);
    expect(phone).toBeLessThan(LABELS.length);
    expect(large).toBeLessThan(phone);
    expect(large).toBeGreaterThanOrEqual(2);
    expect(chipsShown(LABELS, 1200, 1)).toBe(LABELS.length);
    expect(chipsShown(['Ein sehr langer Markenname, der nie in eine Zeile passt'], 120, 2)).toBe(1);
    expect(chipsShown(LABELS, 0, 1)).toBe(0);
  });

  it('renders once and draws the cut on the first frame, whatever layouts arrive afterwards', async () => {
    const onRender = jest.fn();
    await renderWithProviders(
      <Profiler id="mods" onRender={onRender}>
        <PopularModsChips mods={MODS} width={350} onOpen={jest.fn()} testID="HOME-01.mods.list" />
      </Profiler>,
    );
    const first = shownChips();
    // The jest window reports font scale 2 (react-native's Dimensions mock).
    expect(first).toBe(chipsShown(LABELS, 350, 2));
    expect(first).toBeGreaterThan(0);
    const commits = onRender.mock.calls.length;

    // A hidden screen, a recycled cell and the real layout again: nothing renders and nothing changes.
    for (const [width, height] of [[0, 0], [350, 80], [12, 4000], [350, 80]] as const) {
      await fireEvent(screen.getByTestId('HOME-01.mods.list'), 'layout', layout(width, height));
      for (let index = 0; index < first; index += 1) await fireEvent(screen.getByTestId(`HOME-01.mods.list.item.${index}`), 'layout', layout(width, height));
    }
    expect(shownChips()).toBe(first);
    expect(onRender.mock.calls.length).toBe(commits);
    expect(commits).toBeLessThanOrEqual(2);
  });

  it('follows a wider column', async () => {
    await renderWithProviders(<PopularModsChips mods={MODS} width={1200} onOpen={jest.fn()} testID="HOME-01.mods.list" />);
    expect(shownChips()).toBe(MODS.length);
  });
});
