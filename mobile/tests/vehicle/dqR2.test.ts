// Design-QA re-check r2 (docs/reports/phase-4/design-qa-r2-recheck.md): the floating bar's room (DQ-1123) and the bound cost pairs
// of MNT-01 (DQ-1127).
import { costLine } from '@/features/maintenance/components/MaintenanceParts';
import { floatingRoomHeight } from '@/features/vehicle/components/ProfileFrame';
import i18n from '@/i18n';
import { space } from '@/theme';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

describe('DQ-1123: the content keeps room for the whole floating bar', () => {
  it('is the measured bar, the 12 above the tab bar and 16 of air, recomputed for every height', () => {
    expect(floatingRoomHeight(null)).toBeNull();
    expect(floatingRoomHeight(68)).toBe(68 + space[12] + space[16]);
    // EVT-02 going: three rows.
    expect(floatingRoomHeight(176)).toBe(176 + space[12] + space[16]);
    // No bar (past or cancelled): no room.
    expect(floatingRoomHeight(0)).toBe(0);
  });
});

describe('DQ-1127: each amount stays with its word', () => {
  it('binds "0 € Wartung" and "6.500 € Umbauten" and breaks only at the separator', () => {
    const t = i18n.getFixedT('de', 'garage') as unknown as Parameters<typeof costLine>[0];
    const line = costLine(t, '0 €', '6.500 €');
    expect(line).toBe('0 € Wartung · 6.500 € Umbauten');
  });
});
