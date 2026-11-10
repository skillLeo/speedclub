/**
 * QR short codes (02_PRODUCT_SPEC §3.4): 8 characters of Crockford base32, without I, L, O and U. The printed URL is
 * uppercase (`/C/7H2KQXMB`), FS-9 and the sticker show "7H2K QXMB".
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const QR_CODE_LENGTH = 8;

const VALID = /^[0-9A-HJKMNP-TV-Z]{8}$/;
/** What a person types or reads instead: the server maps the same (App\Support\Codes::normalize). */
const READ_ALIKES: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1' };
/** Crockford ignores hyphens; spaces come from the printed "7H2K QXMB". */
const SEPARATORS = /[\s\-‐-―−]+/gu;

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The canonical code of an input, or null when no code can look like it: uppercase, separators dropped, O read as 0 and
 * I and L as 1. A route param can arrive as an array or still percent-encoded.
 */
export function normalizeQrCode(input: string | readonly string[] | null | undefined): string | null {
  const raw = Array.isArray(input) ? input[0] : input;
  if (typeof raw !== 'string') return null;
  // ASCII only, as PHP's strtoupper: "ß" must not turn into "SS" and make a code out of seven characters.
  const code = decoded(raw)
    .replace(/[a-z]/g, (letter) => letter.toUpperCase())
    .replace(SEPARATORS, '')
    .replace(/[OIL]/g, (letter) => READ_ALIKES[letter] ?? letter);
  return VALID.test(code) ? code : null;
}

/**
 * BH-22: the public page as a stranger gets it, for the one who owns the car too. The plain /v/{slug} sends a signed-in browser to
 * the app's own view, and a Chrome Custom Tab shares Chrome's cookies, so QR-04 asks for this on web and on native. The server
 * treats such a request as a guest whatever it carries, so a private vehicle answers its 404 page here.
 */
export function guestViewUrl(publicUrl: string): string {
  return `${publicUrl}${publicUrl.includes('?') ? '&' : '?'}view=public`;
}

/** "7H2KQXMB" → "7H2K QXMB", as FS-9 and the sticker print it. */
export function displayQrCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1 ');
}

/** "https://speedclub.de/C/7H2KQXMB" → "speedclub.de/C/7H2KQXMB": the card prints the address without its scheme. */
export function displayQrUrl(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
}
