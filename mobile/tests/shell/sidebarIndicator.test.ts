/**
 * DQ-P5-004: the sidebar's red indicator follows the active item by its key. The Treffen and Forum flags arrive after the first
 * layout and move every row below them; positions stored by index then pointed at the wrong row (Shop's marker beside Profil).
 */
import { sidebarIndicatorOffset } from '@/features/shell/Sidebar';
import { itemKey, SIDEBAR_ITEMS, visibleItems } from '@/features/shell/destinations';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const ROW = 56;
/** The half of the row minus the half of the 16 indicator. */
const MID = (ROW - 16) / 2;

describe('sidebar indicator (DQ-P5-004)', () => {
  const before = visibleItems(SIDEBAR_ITEMS, {}).map(itemKey);
  const after = visibleItems(SIDEBAR_ITEMS, { events: true, forum: true }).map(itemKey);
  const measured = (keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, ROW]));

  it('lists Treffen and Forum only once their flags are on', () => {
    expect(before).toEqual(['home', 'discover', 'garage', 'shop', 'messages', 'profile']);
    expect(after).toEqual(['home', 'discover', 'events', 'forum', 'garage', 'shop', 'messages', 'profile']);
  });

  it('marks Shop, not the row that held its old index, after the flags turn on', () => {
    const heights = measured(before);
    expect(sidebarIndicatorOffset(before, 'shop', heights)).toBe(3 * ROW + MID);
    // The flags arrive: the two new rows are measured, the old ones keep their heights (they moved, they did not resize).
    const next = { ...heights, events: ROW, forum: ROW };
    expect(sidebarIndicatorOffset(after, 'shop', next)).toBe(5 * ROW + MID);
    expect(sidebarIndicatorOffset(after, 'garage', next)).toBe(4 * ROW + MID);
  });

  it('waits until the active row and every row above it are measured', () => {
    const heights = measured(before);
    // Forum is in the list but not laid out yet: no stale y, no slide.
    expect(sidebarIndicatorOffset(after, 'shop', { ...heights, events: ROW })).toBeNull();
    expect(sidebarIndicatorOffset(after, 'discover', heights)).toBe(ROW + MID);
    expect(sidebarIndicatorOffset(after, 'unknown', heights)).toBeNull();
  });

  it('follows rows that grew with a large font', () => {
    expect(sidebarIndicatorOffset(['home', 'discover', 'garage'], 'garage', { home: 80, discover: 104, garage: 80 })).toBe(80 + 104 + (80 - 16) / 2);
  });
});
