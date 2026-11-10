import { columnsFor } from '@/features/discover/components/MakeTiles';
import { frameOf } from '@/features/home/screens/HomeScreen';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-router', () => ({ useRouter: () => ({}), useFocusEffect: () => undefined }));

describe('DISC-01 make tiles (DQ-186)', () => {
  it('takes three columns where the widest word fits a tile beside its padding, then two, then one row per make', () => {
    // 360 phone: 328 of content. A third of it is 101, 77 inside the padding.
    expect(columnsFor(328, 77)).toBe(3);
    expect(columnsFor(328, 78)).toBe(2);
    // Half of it is 158, 134 inside the padding: "Mercedes-Benz" at 200 % no longer fits.
    expect(columnsFor(328, 134)).toBe(2);
    expect(columnsFor(328, 135)).toBe(1);
  });

  it('keeps three columns until the grid and the words are measured', () => {
    expect(columnsFor(0, 90)).toBe(3);
    expect(columnsFor(328, 0)).toBe(3);
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
