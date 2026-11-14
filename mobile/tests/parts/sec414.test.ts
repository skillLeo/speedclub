import { ApiError } from '@/api/client';
import { tagErrorText } from '@/features/parts/components/business/tagErrors';
import { emptyValues, isLockedField, lockedFieldsOf, serverFieldMap, updateBody } from '@/features/parts/schemas';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const t = (key: string) => `t:${key}`;
const apiError = (status: number, code: string, message = 'Vom Server') =>
  new ApiError({ kind: status === 409 ? 'conflict' : status === 404 ? 'not_found' : 'validation', status, code, message });

describe('SEC-414-06 locked fields', () => {
  it('takes locked_fields from the API, else every locked key while identity_locked', () => {
    expect([...lockedFieldsOf({ identity_locked: true, locked_fields: ['email', 'kind'] } as never)]).toEqual(['email', 'kind']);
    expect(lockedFieldsOf({ identity_locked: true }).has('website')).toBe(true);
    expect(lockedFieldsOf({ identity_locked: false }).size).toBe(0);
    expect(lockedFieldsOf(null).size).toBe(0);
  });

  it('locks the named form fields only', () => {
    const locked = new Set(['email', 'vat_id']);
    expect(isLockedField('email', locked)).toBe(true);
    expect(isLockedField('vatId', locked)).toBe(true);
    expect(isLockedField('phone', locked)).toBe(false);
    expect(isLockedField('about', true)).toBe(false);
    expect(isLockedField('kind', true)).toBe(true);
  });

  it('never sends a locked key, and puts a 422 on a locked field (the map point on the street)', () => {
    const before = emptyValues();
    const changed = { ...before, email: 'neu@werkstatt.de', about: 'Neu' };
    expect(updateBody(changed, before, new Set(['email']))).toEqual({ about: 'Neu' });
    expect(serverFieldMap({ email: ['gesperrt'], lat: ['gesperrt'], kind: ['gesperrt'] })).toEqual({ email: 'email', lat: 'street', kind: 'kind' });
  });
});

describe('SEC-414 tag conflict', () => {
  it('explains 409 business_tag_taken in our words', () => {
    expect(tagErrorText(apiError(409, 'business_tag_taken'), t)).toBe('t:tags.taken');
    expect(tagErrorText(apiError(409, 'business_not_verified'), t)).toBe('t:tags.notVerified');
    expect(tagErrorText(apiError(422, 'validation_failed', 'Satz vom Server'), t)).toBe('Satz vom Server');
    expect(tagErrorText(new Error('x'), t)).toBe('t:tags.failed');
  });
});
