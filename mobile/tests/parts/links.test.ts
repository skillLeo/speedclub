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

  it('business_review "reopened" says the business is in review again (SEC-414-03)', () => {
    const reopened = notification({ type: 'business_review', actors: [], details: { outcome: 'reopened', business_id: 'b1', reason: null } });
    expect(plain(notificationText(reopened, de))).toBe('Dein Betrieb wird noch einmal geprüft und ist bis dahin nicht öffentlich.');
    expect(plain(notificationText(reopened, en))).toBe('Your business is being reviewed again and is not public until then.');
    expect(notificationTarget(reopened, 'jana.nord')).toBe('/business');
  });

  it('business_invite opens the invitations for the member and BIZ-03 for the business (SEC-414-01)', () => {
    const invited = notification({ type: 'business_invite', actors: [], details: { state: 'invited', side: 'member', business_id: 'b1', invite_id: 'i1', username: 'lukas.sc' } });
    expect(plain(notificationText(invited, de))).toBe('@lukas.sc lädt dich ins Team eines Betriebs ein.');
    expect(notificationTarget(invited, 'kenji.r34')).toBe('/business/invites');
    expect(notificationIcon(invited)).toBe('workshop');
    expect(notificationCategory(invited)).toBe('system');
    const removed = notification({ type: 'business_invite', actors: [], details: { state: 'removed', side: 'member', business_id: 'b1', username: null } });
    expect(plain(notificationText(removed, en))).toBe('You are no longer on a business team.');
    expect(notificationTarget(removed, 'kenji.r34')).toBe('/business/invites');
    const accepted = notification({ type: 'business_invite', actors: [], details: { state: 'accepted', side: 'business', business_id: 'b1', username: 'kenji.r34' } });
    expect(plain(notificationText(accepted, de))).toBe('@kenji.r34 ist jetzt in eurem Team.');
    expect(notificationTarget(accepted, 'lukas.sc')).toBe('/business');
    const left = notification({ type: 'business_invite', actors: [], details: { state: 'left', side: 'business', business_id: 'b1', username: '<b>x</b>' } });
    expect(plain(notificationText(left, en))).toBe('A member left your team.');
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
