import { sanitizeCode } from './code';

export type ResetLink = { code?: string; email?: string };

/** ADR-138: the mail's link carries code and address in the fragment, so that neither reaches an access log. */
export function readResetFragment(hash: string): ResetLink {
  const values = new URLSearchParams(hash.replace(/^#/, ''));
  const code = values.get('code');
  const email = values.get('email');
  return { ...(code ? { code: sanitizeCode(code) } : {}), ...(email ? { email } : {}) };
}

/**
 * Web, AUTH-07: read once per page load. The address bar loses the fragment right after (ADR-138), and a screen mounted
 * again, as after the session restore of a member, must still find it.
 */
let resetLink: ResetLink | null = null;

/** The code is spent, or a newer start replaced it: a later visit in the same page load starts empty. */
export function forgetResetLink(): void {
  resetLink = {};
}

/**
 * The mail link's code and address, unless the route names an address of its own. Such a route is a newer start than the
 * link (AUTH-06 sent a new code, or a forced change sent one), so the link's code is stale by then, whatever the address.
 */
export function resetLinkFor(routeEmail: string | undefined, hash: string): ResetLink {
  resetLink ??= readResetFragment(hash);
  if (routeEmail === undefined) return resetLink;
  forgetResetLink();
  return {};
}

/** The address a profile will have. Without a configured site the path alone stays true on any host. */
export function profileUrlPreview(username: string, configuredUrl: string | undefined, browserHost: string | undefined): string {
  const host = (configuredUrl ?? '').replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '') || browserHost || '';
  return `${host}/u/${username}`;
}
