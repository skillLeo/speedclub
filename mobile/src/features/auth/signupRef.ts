/**
 * ADR-216: where a sign-up began, for the admin's "QR-Scans → Registrierungen". `auth/register` carries `ref` only when this app run
 * came in from outside the app on a QR sticker or a public page:
 *
 * - native: the link that opened the app (`/c/CODE`, `/v/slug`, `/u/name`, mapped in features/shell/nativeIntent.ts);
 * - web: the path the page was loaded on (`/app/v/slug` from "In der App öffnen"), or the `next` that a public page's
 *   "Registrieren" and "Anmelden" links hand over (`/app/sign-up?next=/v/slug`);
 * - both: QR-RESOLVE, a scan resolved inside the app.
 *
 * Nothing otherwise: a sign-up from the app's own browsing has no source. Memory only, and the first source of the run counts, so a QR
 * scan that went on to its vehicle page stays a QR scan. Counts only (the server keeps the word, nothing about the page).
 */
import type { components } from '@/api/schema';
import { isWeb } from '@/lib/platform';

export type SignupRef = components['schemas']['SignupRef'];

let origin: SignupRef | null = null;

/** The source a path of this app stands for, or null. `/app` is the web's base path; a printed code is uppercase. */
export function signupRefForPath(path: string | null | undefined): SignupRef | null {
  if (typeof path !== 'string') return null;
  const pathname = path.split(/[?#]/)[0]?.replace(/^\/app(?=\/|$)/, '') ?? '';
  if (/^\/c\/[^/]+\/?$/i.test(pathname)) return 'qr';
  if (/^\/v\/[^/]+/.test(pathname)) return 'public_vehicle';
  if (/^\/u\/[^/]+/.test(pathname)) return 'public_profile';
  return null;
}

/** Notes where this run came in, unless a source is known already. */
export function noteSignupOrigin(path: string | null | undefined): void {
  origin ??= signupRefForPath(path);
}

/** The `ref` for `auth/register`, or null for none. */
export function signupRef(): SignupRef | null {
  return origin;
}

/** After a registration, and in tests. */
export function forgetSignupOrigin(): void {
  origin = null;
}

// Web: the address the page was loaded on, before the router can change it.
if (isWeb && typeof window !== 'undefined') noteSignupOrigin(window.location?.pathname);
