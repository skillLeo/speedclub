/**
 * SYS-01 (DQ-081): where "Update" leads. The store listing of this platform from `app-config.links` (`store_ios`,
 * `store_android`); without one (before launch, or a staging build for testers) the get-the-app page WEB-04 `/app-laden`,
 * which lists the stores or, on staging, the tester APK.
 */
export type StoreLink = { kind: 'ios' | 'android' | 'page'; url: string };

export const GET_APP_PATH = '/app-laden';

function present(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text && /^https?:\/\//i.test(text) ? text : null;
}

export function storeLinkFor(platform: string, links: Readonly<Record<string, string | null>>, origin: string): StoreLink | null {
  const ios = present(links.store_ios);
  const android = present(links.store_android);
  if (platform === 'ios' && ios) return { kind: 'ios', url: ios };
  if (platform === 'android' && android) return { kind: 'android', url: android };
  const page = present(links.get_app);
  if (page) return { kind: 'page', url: page };
  const base = origin.replace(/\/+$/, '');
  return /^https?:\/\//i.test(base) ? { kind: 'page', url: `${base}${GET_APP_PATH}` } : null;
}
