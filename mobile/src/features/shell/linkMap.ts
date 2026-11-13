/**
 * The link map of 09 §6.5 / §8.15: every public path a universal link, an App Link, a QR code or an e-mail can carry, and the
 * app route that answers it. One table, so the native intent (nativeIntent.ts), the App Link manifest (app.config.ts
 * APP_LINK_PATH_PREFIXES, the lead's file) and the `.well-known` files (M4.6) can be checked against each other.
 *
 * `ready: false` marks a path whose screen belongs to a later module: the app does not claim it yet (it stays on the web), and
 * the rewrite below leaves it alone. The module flips `ready` when its route exists; tests/shell/linkMap.test.ts then requires
 * the route file and the App Link prefix.
 */

export type LinkEntry = {
  /** The public path, `{param}` for a segment. */
  public: string;
  /** The app route (expo-router path, `[param]` for a segment) it opens. */
  route: string;
  /** Route ID(s) of the target screen. */
  screen: string;
  /** The module that builds it, while `ready` is false. */
  module?: string;
  ready: boolean;
};

export const LINK_MAP: readonly LinkEntry[] = [
  { public: '/v/{slug}', route: '/v/[slug]', screen: 'VEH-01', ready: true },
  { public: '/c/{code}', route: '/c/[code]', screen: 'QR resolver', ready: true },
  { public: '/u/{username}', route: '/u/[username]', screen: 'PROF-02', ready: true },
  { public: '/e/{slug}', route: '/events/[slug]', screen: 'EVT-02', module: 'M4.12', ready: false },
  { public: '/b/{slug}', route: '/b/[slug]', screen: 'BIZ-01', module: 'M4.14', ready: false },
  { public: '/brands/{slug}', route: '/brands/[slug]', screen: 'BRD-01', module: 'M4.14', ready: false },
  // WEB-12 / AUTH-13 magic link: the token rides in the fragment (ADR-429 b), the attempt stays on the device.
  { public: '/auth/magic', route: '/auth/magic', screen: 'WEB-12', ready: true },
  { public: '/settings/security/activity', route: '/settings/security/activity', screen: 'SET-21', module: 'M4.7', ready: false },
];

export type LegacyRedirect = { from: string; to: string; why: string; module: string; ready: boolean };

/**
 * 09 §6.6: "Legacy routes keep working: AUTH-04/05 redirect to AUTH-12/13; AUTH-03 stays as Mit Passwort anmelden." The
 * targets come with the M4.6 UI; until then the old screens answer and nothing is rewritten.
 */
export const LEGACY_REDIRECTS: readonly LegacyRedirect[] = [
  { from: '/sign-up', to: '/auth/email', why: 'AUTH-04 → AUTH-12 (e-mail first)', module: 'M4.6', ready: true },
  /**
   * Stays off (M4.6): the registration mail of a password account still links to /app/verify-email, and AUTH-13 can only check
   * a passwordless attempt made on this device. AUTH-05 keeps answering it while `auth.password_login` exists.
   */
  { from: '/verify-email', to: '/auth/code', why: 'AUTH-05 → AUTH-13 (code entry)', module: 'M4.6', ready: false },
];

const PARAM = /\{([a-z]+)\}/g;

function matcherFor(publicPath: string): RegExp {
  const source = publicPath.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(PARAM, '([^/?#]+)');
  return new RegExp(`^${source}(?=[/?#]|$)`);
}

/**
 * Rewrites a mapped incoming path (already without `/app` and fragment) to its app route: the public path of a ready entry
 * whose route differs (`/e/x` → `/events/x` once events exist), then a ready legacy redirect. Query strings are kept.
 * Anything else comes back unchanged.
 */
export function rewriteLinkedPath(
  path: string,
  links: readonly LinkEntry[] = LINK_MAP,
  redirects: readonly LegacyRedirect[] = LEGACY_REDIRECTS,
): string {
  const queryAt = path.search(/[?#]/);
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const rest = queryAt === -1 ? '' : path.slice(queryAt);

  for (const entry of links) {
    if (!entry.ready || entry.public.replace(PARAM, '[$1]') === entry.route) continue;
    const match = matcherFor(entry.public).exec(pathname);
    if (!match) continue;
    let index = 1;
    const replaced = entry.route.replace(/\[[a-zA-Z]+\]/g, () => match[index++] ?? '');
    return `${replaced}${pathname.slice(match[0].length)}${rest}`;
  }
  const legacy = redirects.find((redirect) => redirect.ready && (pathname === redirect.from || pathname === `${redirect.from}/`));
  return legacy ? `${legacy.to}${rest}` : path;
}
