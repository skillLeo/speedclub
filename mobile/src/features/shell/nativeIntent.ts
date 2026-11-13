import { noteSignupOrigin } from '@/features/auth/signupRef';

import { rewriteLinkedPath } from './linkMap';

const URL_PARTS = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i;

/** ADR-138: the reset mail links to /app/reset-password#code=...&email=... A link keeps the fragment on native too. */
const RESET_PATH = /^\/reset-password\/?$/;
/** M2.5: the account-exists mail links to /app/sign-in#email=... and /app/forgot-password#email=... (fragment, ADR-138). */
const EMAIL_PATH = /^\/(?:sign-in|forgot-password)\/?$/;
/** Six digits, as the server sends them (auth/schemas CODE_LENGTH). */
const RESET_CODE = /^\d{6}$/;
/**
 * M4.6 / M4.7: the one-time links of a mail carry their token in the fragment (`#t=…`, ADR-429 b): the same-device magic link
 * (/auth/magic, MagicLinkScreen's TOKEN_SHAPE) and "Das war ich nicht" of a login alert (/auth/secure, `<event ULID>.<proof>`).
 */
const TOKEN_PATHS: readonly (readonly [RegExp, RegExp])[] = [
  [/^\/auth\/magic\/?$/, /^[A-Za-z0-9_-]{16,64}$/],
  [/^\/auth\/secure\/?$/, /^[0-9A-Za-z]{26}\.[A-Za-z0-9_-]{16,128}$/],
];
/** RFC 5321: no address is longer. */
const MAX_EMAIL_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/u;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

function hostOf(url: string | undefined): string | null {
  const host = url ? URL_PARTS.exec(url.trim())?.[2] : undefined;
  return host ? host.toLowerCase() : null;
}

/** The site's own hosts, from the public URLs of this build. Only their links may carry a reset code. */
export const SITE_HOSTS: readonly string[] = [
  hostOf(process.env.EXPO_PUBLIC_WEB_URL),
  hostOf(process.env.EXPO_PUBLIC_API_URL),
].filter((host): host is string => host !== null);

/** The one value of a key, or null when it is missing or given twice: an ambiguous link carries nothing. */
function single(values: URLSearchParams, key: string): string | null {
  const all = values.getAll(key);
  return all.length === 1 ? (all[0] ?? null) : null;
}

function isEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_SHAPE.test(value) && !CONTROL_CHARACTERS.test(value);
}

/**
 * The reset route takes code and address from the fragment of a trusted link, as query params, because native screens
 * read params (ResetPasswordScreen); sign-in and forgot-password take the address alone (the account-exists mail); the magic
 * and secure links take their token `t`. Nothing else of the fragment, and no code, address or token from the query.
 */
function withResetParams(path: string, fragment: string, trusted: boolean): string {
  const queryAt = path.indexOf('?');
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const reset = RESET_PATH.test(pathname);
  const tokenShape = TOKEN_PATHS.find(([route]) => route.test(pathname))?.[1] ?? null;
  if (!reset && !tokenShape && !EMAIL_PATH.test(pathname)) return path;
  const query = new URLSearchParams(queryAt === -1 ? '' : path.slice(queryAt + 1));
  query.delete('code');
  query.delete('email');
  query.delete('t');
  if (tokenShape) {
    // The token alone, and only from the site's own link: the scheme or a query never hands one in.
    const token = trusted ? single(new URLSearchParams(fragment), 't') : null;
    if (token !== null && tokenShape.test(token)) query.set('t', token);
  } else if (trusted) {
    const values = new URLSearchParams(fragment);
    const code = reset ? single(values, 'code') : null;
    const email = single(values, 'email');
    if (code !== null && RESET_CODE.test(code)) query.set('code', code);
    if (email !== null && isEmail(email)) query.set('email', email);
  }
  const search = query.toString();
  return search ? `${pathname}?${search}` : pathname;
}

/**
 * Maps an incoming link to an app route: `/app/...` is the web base path, and a printed QR code is uppercase
 * (`/C/AB12CD`) because uppercase URLs scan as smaller codes (M1.7). Accepts a full URL or a path, because
 * `redirectSystemPath` guarantees neither. A fragment never reaches a route: only the reset, magic and secure links turn their
 * code, token or address into params, and only from the site's own host or as a bare path, never from the app's scheme.
 */
export function mapIncomingPath(incoming: string, siteHosts: readonly string[] = SITE_HOSTS): string {
  // The dev client's own launch URL carries the bundle address, not a route.
  if (incoming.includes('expo-development-client')) return incoming;

  let path = incoming;
  let trusted = true;
  const parts = URL_PARTS.exec(incoming);
  if (parts) {
    const [, scheme = '', host = '', rest = ''] = parts;
    const web = /^https?$/i.test(scheme);
    // speedclub://garage has "garage" where a web URL has its host.
    path = web || !host ? rest : `/${host}${rest}`;
    // SEC-P1-15 / SEC-P2-03: any Android app can register the custom scheme, so only the site's verified https link carries
    // a code or an address. The scheme still opens the route, empty.
    trusted = web && siteHosts.includes(host.toLowerCase());
  }
  const hashAt = path.indexOf('#');
  const fragment = hashAt === -1 ? '' : path.slice(hashAt + 1);
  if (hashAt !== -1) path = path.slice(0, hashAt);
  // One leading slash: "//host/..." would read as a protocol-relative address.
  path = `/${path.replace(/^\/+/, '')}`;
  path = path.replace(/^\/app(?=[/?]|$)/, '');
  path = path.replace(/^\/C(?=\/)/, '/c');
  if (path === '' || path.startsWith('?')) path = `/${path}`;
  // 09 §6.5 link map: a public path whose screen lives at another app route, and the legacy redirects (linkMap.ts).
  const mapped = rewriteLinkedPath(withResetParams(path, fragment, trusted));
  // ADR-216: a QR sticker or a public page that opened the app is where a sign-up in this run began.
  noteSignupOrigin(mapped);
  return mapped;
}
