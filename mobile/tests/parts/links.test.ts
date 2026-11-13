import type { CollectionItem } from '@/api/queries/social2';
import { itemTile } from '@/features/collections/model';
import { notificationCategory, notificationIcon, notificationTarget, notificationText } from '@/features/home/notifications';
import { LINK_MAP, rewriteLinkedPath } from '@/features/shell/linkMap';
import i18n from '@/i18n';

import { notification } from '../home/fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const de = i18n.getFixedT('de', 'home');
const en = i18n.getFixedT('en', 'home');
const plain = (text: string) => text.replace(/ /g, ' ').replace(/⁠/g, '');
const R34 = { id: '01r34', slug: 'nissan-skyline-gt-r-r34-xmeypf41', full_title: 'Nissan Skyline GT-R R34', cover: null, is_sample: false };
const MOD = '01JMOD00000000000000000001';

describe('M4.14 notifications', () => {
  it('business_review opens BIZ-03 and says how staff decided, never the reason', () => {
    const verified = notification({ type: 'business_review', actors: [], details: { outcome: 'verified', business_id: 'b1', reason: null } });
    expect(plain(notificationText(verified, de))).toBe('Dein Betrieb ist verifiziert und jetzt öffentlich sichtbar.');
    const rejected = notification({ type: 'business_review', actors: [], details: { outcome: 'rejected', business_id: 'b1', reason: 'Registernummer fehlt.' } });
    expect(plain(notificationText(rejected, en))).not.toContain('Registernummer');
    expect(notificationTarget(verified, 'jana.nord')).toBe('/business');
    expect(notificationCategory(verified)).toBe('system');
    expect(notificationIcon(verified)).toBe('workshop');
  });

  it('business_tag opens BIZ-04 for the business and VEH-02 of the mod for the build’s owner', () => {
    const forBusiness = notification({ type: 'business_tag', actors: [], vehicle: R34, details: { state: 'requested', side: 'business', tag_id: 't1', business_id: 'b1', mod_id: MOD } });
    expect(plain(notificationText(forBusiness, de))).toBe('Neue Markierung: Bestätige den Einbau an Nissan Skyline GT-R R34.');
    expect(notificationTarget(forBusiness, 'jana.nord')).toBe('/business/requests');
    const forOwner = notification({ type: 'business_tag', actors: [], vehicle: R34, details: { state: 'requested', side: 'member', tag_id: 't1', business_id: 'b1', mod_id: MOD } });
    expect(plain(notificationText(forOwner, de))).toBe('Ein Betrieb möchte deinen Nissan Skyline GT-R R34 ins Portfolio aufnehmen. Bestätige den Einbau.');
    expect(notificationTarget(forOwner, 'max.r34')).toEqual({ pathname: '/v/[slug]/mods/[modId]', params: { slug: R34.slug, modId: MOD } });
    const accepted = notification({ type: 'business_tag', actors: [], vehicle: R34, details: { state: 'accepted', side: 'member', mod_id: 'not-a-ulid' } });
    expect(notificationTarget(accepted, 'max.r34')).toBe(`/v/${R34.slug}`);
    expect(notificationCategory(accepted)).toBe('builds');
  });
});

describe('M4.14 collections and links', () => {
  it('a saved business opens BIZ-01 with its logo', () => {
    const item = {
      type: 'business',
      id: 'b1',
      position: 0,
      added_at: null,
      vehicle: null,
      modification: null,
      build_update: null,
      event: null,
      business: { id: 'b1', slug: 'werkstatt-nord', name: 'Werkstatt Nord', logo: null, is_sample: false },
    } as unknown as CollectionItem;
    expect(itemTile(item)).toMatchObject({ title: 'Werkstatt Nord', href: '/b/werkstatt-nord', isSample: false });
  });

  it('claims /b and /brands, which are their own app routes', () => {
    expect(LINK_MAP.find((entry) => entry.public === '/b/{slug}')?.ready).toBe(true);
    expect(LINK_MAP.find((entry) => entry.public === '/brands/{slug}')?.ready).toBe(true);
    expect(rewriteLinkedPath('/b/werkstatt-nord?ref=qr')).toBe('/b/werkstatt-nord?ref=qr');
  });
});
