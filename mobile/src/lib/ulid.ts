/**
 * Client-generated ULIDs (Crockford base32, 26 characters: 10 of time, 16 of randomness) for the offline outbox (09 §8.12,
 * ADR-441): an entity made offline carries its final id from the start, so later edits of it in the same queue already name it,
 * and sending it twice answers the first copy. Lower case, like the server's ULIDs.
 */
import * as Crypto from 'expo-crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const BASE = 32;
/** 16 characters of 5 bits are 80 bits: 10 bytes. */
const RANDOM_BYTES = 10;
const BITS_PER_CHAR = 5;
const BITS_PER_BYTE = 8;
const LOW_FIVE_BITS = 0b11111;

/** The time part: milliseconds since 1970 in 10 base-32 characters. */
export function encodeTime(ms: number): string {
  let value = Math.max(0, Math.floor(ms));
  let out = '';
  for (let index = 0; index < TIME_CHARS; index += 1) {
    out = ALPHABET.charAt(value % BASE) + out;
    value = Math.floor(value / BASE);
  }
  return out;
}

/** The random part: 80 bits in 16 base-32 characters. */
export function encodeRandom(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << BITS_PER_BYTE) | byte;
    bits += BITS_PER_BYTE;
    while (bits >= BITS_PER_CHAR) {
      bits -= BITS_PER_CHAR;
      out += ALPHABET.charAt((buffer >> bits) & LOW_FIVE_BITS);
    }
    buffer &= (1 << bits) - 1;
  }
  return out.slice(0, RANDOM_CHARS).padEnd(RANDOM_CHARS, ALPHABET.charAt(0));
}

export function newUlid(now: number = Date.now(), random: (count: number) => Uint8Array = Crypto.getRandomBytes): string {
  return encodeTime(now) + encodeRandom(random(RANDOM_BYTES));
}

/** What the API's ULID rule accepts. */
export function isUlid(value: string): boolean {
  return /^[0-7][0-9a-hjkmnp-tv-z]{25}$/i.test(value);
}
