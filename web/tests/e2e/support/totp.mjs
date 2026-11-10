// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) and RFC 4648 base32, for the staff fixtures of the admin tests. Plain ESM, so the visual
// runner (Node) and the specs use the same code. No dependency: node:crypto only.
import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

/** @param {Buffer} bytes */
export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** @param {string} text */
export function base32Decode(text) {
  const clean = text.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  /** @type {number[]} */
  const out = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Not a base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A 160-bit secret (SEC-P1-38), 32 base32 characters. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/**
 * The code of `secret` at `at` (ms), shifted by `offset` steps.
 * @param {string} secret base32
 * @param {number} [offset]
 * @param {number} [at]
 */
export function totpCode(secret, offset = 0, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / STEP_SECONDS) + offset));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const start = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = hmac.readUInt32BE(start) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

/** Milliseconds until the next TOTP step begins. */
export const msToNextStep = (at = Date.now()) => STEP_SECONDS * 1000 - (at % (STEP_SECONDS * 1000));
