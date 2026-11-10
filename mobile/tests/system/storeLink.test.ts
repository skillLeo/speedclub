import { storeLinkFor } from '@/features/system/storeLink';

const ORIGIN = 'https://staging.speedclub.de';

describe('SYS-01 store link (DQ-081)', () => {
  const links = { store_ios: 'https://apps.apple.com/app/id1', store_android: 'https://play.google.com/store/apps/details?id=de.speedclub' };

  it('leads to the store of this platform', () => {
    expect(storeLinkFor('ios', links, ORIGIN)).toEqual({ kind: 'ios', url: links.store_ios });
    expect(storeLinkFor('android', links, ORIGIN)).toEqual({ kind: 'android', url: links.store_android });
  });

  it('falls back to the get-the-app page without a listing (pre-launch, staging testers)', () => {
    expect(storeLinkFor('android', { store_ios: links.store_ios, store_android: null }, ORIGIN)).toEqual({ kind: 'page', url: `${ORIGIN}/app-laden` });
    expect(storeLinkFor('ios', { store_ios: '  ' }, `${ORIGIN}/`)).toEqual({ kind: 'page', url: `${ORIGIN}/app-laden` });
    expect(storeLinkFor('android', { get_app: 'https://speedclub.de/app-laden' }, ORIGIN)).toEqual({ kind: 'page', url: 'https://speedclub.de/app-laden' });
  });

  it('never offers a link it cannot open', () => {
    expect(storeLinkFor('android', { store_android: 'javascript:alert(1)' }, '')).toBeNull();
  });
});
