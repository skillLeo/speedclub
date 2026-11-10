import { legalStatusOf, LEGAL_STATUSES, showsLegalPill } from '@/features/garage/legalStatus';
import { modPayload, modValuesFrom } from '@/features/garage/modForm';
import { legalLabel } from '@/features/vehicle/legal';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

describe('mod legal status (sig.mod_legal_status, 08_LEGAL §7)', () => {
  it('knows the six values of the API', () => {
    expect(LEGAL_STATUSES).toEqual(['abe', 'parts_certificate', 'registered', 'individual_approval', 'not_required', 'unknown']);
    expect(legalStatusOf('abe')).toBe('abe');
    expect(legalStatusOf('approved')).toBeNull();
    expect(legalStatusOf(null)).toBeNull();
  });

  it('shows a pill only for a stated status', () => {
    expect(showsLegalPill('parts_certificate')).toBe(true);
    expect(showsLegalPill('unknown')).toBe(false);
    expect(showsLegalPill(null)).toBe(false);
  });

  it('labels from the server first, never while the flag is off', () => {
    const fallback = (status: string) => `#${status}`;
    expect(legalLabel({ legal_status: 'abe', legal_status_label: 'ABE' }, true, fallback)).toBe('ABE');
    expect(legalLabel({ legal_status: 'registered', legal_status_label: null }, true, fallback)).toBe('#registered');
    expect(legalLabel({ legal_status: 'abe', legal_status_label: 'ABE' }, false, fallback)).toBeNull();
    expect(legalLabel({ legal_status: 'unknown', legal_status_label: 'Unbekannt' }, true, fallback)).toBeNull();
  });

  it('sends the field only while the flag is on, none chosen as null', () => {
    const values = { ...modValuesFrom(undefined, [], 'de'), legalStatus: 'abe' as const };
    expect(modPayload(values, [], 'de', { titleTouched: false, staggered: false }).legal_status).toBeUndefined();
    expect(modPayload(values, [], 'de', { titleTouched: false, staggered: false, legalStatus: true }).legal_status).toBe('abe');
    expect(modPayload({ ...values, legalStatus: '' }, [], 'de', { titleTouched: false, staggered: false, legalStatus: true }).legal_status).toBeNull();
  });
});
