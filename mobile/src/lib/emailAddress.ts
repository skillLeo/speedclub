/**
 * The form the server stores a member address in (ADR-183, `App\Support\EmailAddress`): trimmed, lowercased, and the domain in
 * ASCII, so `Max@Müller.de` and `max@xn--mller-kva.de` compare equal. For comparing only: the app sends what was typed and lets the
 * server map it, which stays the one mapping that counts.
 *
 * The domain goes through the UTS-46 mapping the app can do without a library (compatibility forms, the ideographic full stops,
 * lower case, composed marks; `ß` stays, as in the server's non-transitional mode) and then Punycode (RFC 3492). Written out here
 * because Hermes has no IDNA: its `URL` does not convert hostnames. Without `String.prototype.normalize`, the forms are left alone.
 */

const NON_ASCII = /[^\x00-\x7F]/;
/** U+3002, U+FF0E, U+FF61: UTS-46 maps them to a full stop. */
const LABEL_DOTS = /[。．｡]/g;

function normalized(text: string, form: 'NFC' | 'NFKC'): string {
  return typeof text.normalize === 'function' ? text.normalize(form) : text;
}

// RFC 3492 parameters.
const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 0x80;

function digit(value: number): string {
  // 0..25 are a..z, 26..35 are 0..9.
  return String.fromCharCode(value < 26 ? value + 97 : value + 22);
}

function adapt(delta: number, points: number, first: boolean): number {
  let scaled = first ? Math.floor(delta / DAMP) : delta >> 1;
  scaled += Math.floor(scaled / points);
  let k = 0;
  while (scaled > ((BASE - T_MIN) * T_MAX) >> 1) {
    scaled = Math.floor(scaled / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * scaled) / (scaled + SKEW));
}

/** One label in Punycode, without the `xn--` prefix. */
export function punycode(label: string): string {
  const points = Array.from(label, (char) => char.codePointAt(0) ?? 0);
  const basic = points.filter((point) => point < INITIAL_N);
  let output = String.fromCharCode(...basic);
  let handled = basic.length;
  if (handled > 0) output += '-';
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < points.length) {
    const next = Math.min(...points.filter((point) => point >= n));
    delta += (next - n) * (handled + 1);
    n = next;
    for (const point of points) {
      if (point < n) delta += 1;
      if (point !== n) continue;
      let q = delta;
      for (let k = BASE; ; k += BASE) {
        const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
        if (q < t) break;
        output += digit(t + ((q - t) % (BASE - t)));
        q = Math.floor((q - t) / (BASE - t));
      }
      output += digit(q);
      bias = adapt(delta, handled + 1, handled === basic.length);
      delta = 0;
      handled += 1;
    }
    delta += 1;
    n += 1;
  }
  return output;
}

/** A domain in ASCII, lowercased. An ASCII domain is only lowercased: it already is what IDNA would answer. */
export function asciiDomain(domain: string): string {
  if (!NON_ASCII.test(domain)) return domain.toLowerCase();
  const mapped = normalized(normalized(domain, 'NFKC').replace(LABEL_DOTS, '.').toLowerCase(), 'NFC');
  return mapped
    .split('.')
    .map((label) => (NON_ASCII.test(label) ? `xn--${punycode(label)}` : label))
    .join('.');
}

/** An address as the server keeps it: see the top of this file. Not an address: only trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at === -1) return trimmed.toLowerCase();
  return `${trimmed.slice(0, at).toLowerCase()}@${asciiDomain(trimmed.slice(at + 1))}`;
}
