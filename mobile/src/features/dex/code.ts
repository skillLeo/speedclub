/**
 * DEX-02 (contract §8): what the scanner accepts. Only a sticker of our own site, `https://<our host>/c/{code}` (the printed
 * `/C/{code}` included), and the app's own `speedclub://c/{code}`. Anything else — another site, a plain `http://` link to
 * our host, a query string or fragment, a code that cannot exist — is "kein Speedclub Sticker", without a request.
 *
 * "Our host" is what this build talks to (EXPO_PUBLIC_WEB_URL, EXPO_PUBLIC_API_URL): production builds know the production
 * site, staging builds staging, local and lan builds the PC they were built for (whose site is plain http, so only there an
 * `http://` sticker counts — that is the origin the local server prints).
 */
import { QR_CODE_LENGTH, normalizeQrCode } from '@/features/qr/code';

/** The app's own scheme (app.config.ts `scheme`). */
export const APP_SCHEME = 'speedclub';

/** `scheme://host[:port]` of a configured URL, lowercase; null when it is missing or not http(s). */
export function originOf(url: string | undefined): string | null {
  const match = url ? /^(https?):\/\/([^/?#@\s]+)/i.exec(url.trim()) : null;
  if (!match) return null;
  const [, scheme = '', host = ''] = match;
  return `${scheme.toLowerCase()}://${host.toLowerCase()}`;
}

/** The sites of this build. Their own scheme counts: an https site never accepts an http link. */
export const STICKER_ORIGINS: readonly string[] = [
  originOf(process.env.EXPO_PUBLIC_WEB_URL),
  originOf(process.env.EXPO_PUBLIC_API_URL),
].filter((origin, index, all): origin is string => origin !== null && all.indexOf(origin) === index);

/** Exactly eight letters or digits: a printed code never has separators in its URL. */
const CODE_SEGMENT = new RegExp(`^[0-9A-Za-z]{${QR_CODE_LENGTH}}$`);
/** `scheme://host/path` with no user info, no query and no fragment. */
const WEB_URL = /^(https?):\/\/([^/?#@\s]+)(\/[^?#\s]*)$/i;
const APP_URL = new RegExp(`^${APP_SCHEME}://c/([^/?#\\s]+)/?$`, 'i');
/** `/c/CODE` or `/C/CODE`, one optional trailing slash. */
const STICKER_PATH = /^\/[cC]\/([^/]+)\/?$/;

function codeOf(segment: string | undefined): string | null {
  if (!segment || !CODE_SEGMENT.test(segment)) return null;
  // Case-insensitive Crockford, as the server resolves it (contract §2): lowercase is the same code.
  return normalizeQrCode(segment);
}

/**
 * The canonical code of a scanned text, or null when it is no Speedclub sticker. `origins` defaults to this build's sites.
 */
export function parseStickerCode(data: string, origins: readonly string[] = STICKER_ORIGINS): string | null {
  const text = data.trim();
  const app = APP_URL.exec(text);
  if (app) return codeOf(app[1]);
  const web = WEB_URL.exec(text);
  if (!web) return null;
  const [, scheme = '', host = '', path = ''] = web;
  if (!origins.includes(`${scheme.toLowerCase()}://${host.toLowerCase()}`)) return null;
  return codeOf(STICKER_PATH.exec(path)?.[1]);
}
