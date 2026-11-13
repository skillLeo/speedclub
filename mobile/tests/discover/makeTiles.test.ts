import { wallCellWidth, wallRows } from '@/features/discover/components/BuildWall';
import { columnsFor, wordmarkScale, widestWordmarkWord } from '@/features/discover/components/MakeTiles';
import { frameOf } from '@/features/home/screens/HomeScreen';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-router', () => ({ useRouter: () => ({}), useFocusEffect: () => undefined }));

describe('DISC-01 BrandTiles (09 §7.5, DQ-186)', () => {
  it('takes three columns where the widest wordmark word fits a tile beside its padding, then two, then one row per make', () => {
    // A 640 column: a third is 208, 192 inside the padding; a half 316, 300 inside.
    expect(columnsFor(640, 192)).toBe(3);
    expect(columnsFor(640, 193)).toBe(2);
    expect(columnsFor(640, 300)).toBe(2);
    expect(columnsFor(640, 301)).toBe(1);
  });

  it('decides from the estimate before the first paint: wordmarks of real makes at phone and desktop widths', () => {
    const makes = ['BMW', 'Volkswagen', 'Porsche', 'Mercedes-Benz', 'Toyota', 'Nissan', 'Lamborghini', 'Alfa Romeo'];
    // ADR-436 display.wordmark (17/22): on 360 and 390 phones every make fits two columns ("Mercedes-" / "Benz" breaks after its
    // hyphen, "Alfa" / "Romeo" at its space), never one column of full-width rows.
    expect(columnsFor(320, widestWordmarkWord(makes, 1))).toBe(2);
    expect(columnsFor(350, widestWordmarkWord(makes, 1))).toBe(2);
    expect(columnsFor(350, widestWordmarkWord(makes, wordmarkScale(2)))).toBe(2);
    // A tablet or desktop column fits three.
    expect(columnsFor(640, widestWordmarkWord(makes, 1))).toBe(3);
    // Short makes take three on a phone too.
    expect(columnsFor(350, widestWordmarkWord(['BMW', 'Audi', 'Mazda'], 1))).toBe(3);
    // The estimate grows with the font scale up to the 1.3 cap, then stays.
    expect(widestWordmarkWord(makes, wordmarkScale(2))).toBe(widestWordmarkWord(makes, 1.3));
    expect(widestWordmarkWord(makes, wordmarkScale(2))).toBeGreaterThan(widestWordmarkWord(makes, 1));
    expect(wordmarkScale(0.85)).toBe(1);
  });

  it('keeps three columns while the width is unknown', () => {
    expect(columnsFor(0, 90)).toBe(3);
    expect(columnsFor(328, 0)).toBe(3);
  });
});

describe('DISC photo wall', () => {
  it('splits the cells by 2 px and the builds into rows of the column count', () => {
    expect(wallCellWidth(390, 2)).toBe(194);
    expect(wallCellWidth(0, 2)).toBe(0);
    expect(wallRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(wallRows([], 2)).toEqual([]);
  });
});

describe('HOME-01 frame (DQ-188, DQ-190)', () => {
  it('centres one 640 column on tablets and phones, with no rail', () => {
    expect(frameOf(696, 24, false)).toEqual({ width: 640, column: 640, rail: null });
    expect(frameOf(390, 20, false)).toEqual({ width: 350, column: 350, rail: null });
  });

  it('puts the column and the rail into one centred frame of at most 1200 on desktop', () => {
    expect(frameOf(1040, 24, true)).toEqual({ width: 992, column: 640, rail: 320 });
    expect(frameOf(1680, 24, true)).toEqual({ width: 1200, column: 640, rail: 528 });
  });
});
