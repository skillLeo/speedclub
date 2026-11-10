/**
 * Which link targets of a legal text may open, and where (SET-18). Anything not on this list stays plain text: script and
 * data URLs, other schemes, protocol-relative and relative paths, fragments, and paths that try to leave the app.
 */
import { isInternalPath } from '@/state/session';

export type LinkTarget =
  /** A screen of this app, for `router.push`. */
  | { kind: 'internal'; path: string }
  /** The browser or the mail app. */
  | { kind: 'external'; url: string };

const MAX_URL_LENGTH = 2048;
/** Where the member web lives under the site (app.config.ts experiments.baseUrl). */
const APP_BASE = '/app';
/** Paths that are screens of the app as well as of the site: they open inside the app. */
const APP_PREFIXES = ['/settings', '/profile', '/garage', '/discover', '/messages', '/v/', '/u/', '/c/'];
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}$/;

function hasUnsafeCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x20 || code === 0x7f || character === '\\';
  });
}

function isAppPath(path: string): boolean {
  return path === '/' || APP_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
}

/** `/app/settings` and `/settings` are the same screen; null when the path is not one of the app's. */
function appPathOf(path: string): string | null {
  const local = path === APP_BASE ? '/' : path.startsWith(`${APP_BASE}/`) ? path.slice(APP_BASE.length) : path;
  if (!isInternalPath(local)) return null;
  if (path.startsWith(`${APP_BASE}/`) || path === APP_BASE) return local;
  return isAppPath(local) ? local : null;
}

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * The target of `href`, or null when it must not open. `siteUrl` is the public site (EXPO_PUBLIC_WEB_URL, or the API's
 * origin, or the browser's): its own pages such as `/konto-loeschen` open there, its `/app/...` paths inside the app.
 */
export function resolveLink(href: string, siteUrl: string | null): LinkTarget | null {
  const value = href.trim();
  if (!value || value.length > MAX_URL_LENGTH || hasUnsafeCharacters(value)) return null;
  const site = originOf(siteUrl);

  if (value.startsWith('/')) {
    if (value.startsWith('//')) return null;
    const cut = value.search(/[?#]/);
    const path = cut === -1 ? value : value.slice(0, cut);
    const query = cut === -1 ? '' : value.slice(cut);
    const internal = appPathOf(path);
    if (internal) return { kind: 'internal', path: `${internal}${query}` };
    if (!isInternalPath(path) || !site) return null;
    return { kind: 'external', url: `${site}${value}` };
  }

  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value)?.[1]?.toLowerCase();
  if (scheme === 'mailto') {
    const address = decodeURIComponentSafe(value.slice('mailto:'.length).split('?')[0] ?? '');
    return address && EMAIL.test(address) ? { kind: 'external', url: `mailto:${address}` } : null;
  }
  if (scheme !== 'https' && scheme !== 'http') return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!parsed.hostname || parsed.username || parsed.password) return null;
  if (site && parsed.origin === site) {
    const internal = parsed.pathname === APP_BASE || parsed.pathname.startsWith(`${APP_BASE}/`) ? appPathOf(parsed.pathname) : null;
    if (internal) return { kind: 'internal', path: `${internal}${parsed.search}${parsed.hash}` };
  }
  return { kind: 'external', url: parsed.href };
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

/** The public site the texts link to: configured, else the API's own origin, else the page's. */
export function siteUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_WEB_URL || process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured;
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : null;
}
