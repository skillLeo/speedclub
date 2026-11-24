/**
 * M5.9d (contract §5): the invite code a sign-up carries. `/join/{code}` (the Blade landing opens the app or the member web there, or
 * hands over `?invite=CODE`) notes it; the account-creating calls (`auth/register`, `auth/email/verify`, `auth/apple`,
 * `auth/google`) send it as `invite_code`, and the server redeems it when the account activates. For an existing account the server
 * ignores it. Memory only, for this app run: nothing about the code is stored on the device.
 */
import { isWeb } from '@/lib/platform';

/** Contract §5: 8 characters, Crockford base 32 (no I, L, O, U). */
export const INVITE_CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** A code as a link or a member typed it: trimmed, uppercase, the Crockford look-alikes read as their digits. */
export function normalizeInviteCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');
  return INVITE_CODE.test(code) ? code : null;
}

let held: string | null = null;

/** Notes a code from a link; an invalid one is dropped, a later valid one replaces an earlier one. */
export function noteInviteCode(raw: string | null | undefined): string | null {
  const code = normalizeInviteCode(raw);
  if (code) held = code;
  return code;
}

export function heldInviteCode(): string | null {
  return held;
}

/** After a sign-up, a refused code, and in tests. */
export function forgetInviteCode(): void {
  held = null;
}

/** Spread into the body of an account-creating call. */
export function inviteFields(): { invite_code?: string } {
  return held ? { invite_code: held } : {};
}

/** The code in a path of this app (`/join/CODE`, `/app/join/CODE`) or its query (`?invite=CODE`), or null. */
export function inviteCodeInUrl(path: string | null | undefined, search: string | null | undefined = ''): string | null {
  const pathname = typeof path === 'string' ? (path.split(/[?#]/)[0]?.replace(/^\/app(?=\/|$)/, '') ?? '') : '';
  const fromPath = /^\/join\/([^/]+)\/?$/i.exec(pathname)?.[1];
  if (fromPath) return normalizeInviteCode(decodeURIComponent(fromPath));
  const params = new URLSearchParams(search ?? '');
  return normalizeInviteCode(params.get('invite'));
}

// Web: the address the page was loaded on, before the router can change it.
if (isWeb && typeof window !== 'undefined') noteInviteCode(inviteCodeInUrl(window.location?.pathname, window.location?.search));
