/** M1.9: the blurhash decoder and the memoised `data:` URL that replaces expo-image's revoked `blob:` placeholder on web. */
import { BLURHASH_SIZE, blurhashToDataUrl, clearBlurhashCache, decodeBlurhash, isBlurhashValid } from '@/lib/blurhash';

import { installFakeCanvas } from './fakeCanvas';

// The README example of the reference implementation (4 × 3 components).
const HASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';
const OTHER = 'LGF5]+Yk^6#M@-5c,1J5@[or[Q6.';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width = BLURHASH_SIZE) {
  const offset = (y * width + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}

describe('decodeBlurhash', () => {
  it('decodes a known hash to the reference pixels', () => {
    const pixels = decodeBlurhash(HASH, BLURHASH_SIZE, BLURHASH_SIZE);
    expect(pixels).toHaveLength(BLURHASH_SIZE * BLURHASH_SIZE * 4);
    expect(pixelAt(pixels, 0, 0)).toEqual([135, 164, 177, 255]);
    expect(pixelAt(pixels, 16, 16)).toEqual([158, 125, 108, 255]);
  });

  it('matches the decoder expo-image uses for its own blurhash placeholder, byte for byte', () => {
    // Not exported by expo-image, so it is reached by path. If an expo-image update moves it, update this path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reference = require('../../node_modules/expo-image/build/utils/blurhash/decode').default as (
      hash: string,
      width: number,
      height: number,
      punch: number,
    ) => Uint8ClampedArray;
    for (const hash of [HASH, OTHER, 'L6PZfSi_.AyE_3t7t7R**0o#DgR4']) {
      expect(Array.from(decodeBlurhash(hash, 32, 24))).toEqual(Array.from(reference(hash, 32, 24, 1)));
    }
  });

  it('rejects malformed hashes', () => {
    expect(isBlurhashValid(HASH)).toBe(true);
    // 'L' announces 4 × 3 components, which needs 28 characters.
    expect(isBlurhashValid('LKO2?U%2Tw=w')).toBe(false);
    expect(isBlurhashValid('abc')).toBe(false);
    expect(isBlurhashValid('LEHV6nWB2yk8pyo0adR*.7kCMdn"')).toBe(false);
    expect(() => decodeBlurhash('LKO2?U%2Tw=w', 4, 4)).toThrow();
  });
});

describe('blurhashToDataUrl', () => {
  let canvas: ReturnType<typeof installFakeCanvas>;

  beforeEach(() => {
    clearBlurhashCache();
    canvas = installFakeCanvas();
  });
  afterEach(() => canvas.uninstall());

  it('draws the decoded pixels into a 32 × 32 canvas and returns a PNG data URL', () => {
    const url = blurhashToDataUrl(HASH);
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(canvas.created.map(({ width, height }) => ({ width, height }))).toEqual([{ width: BLURHASH_SIZE, height: BLURHASH_SIZE }]);
    expect(Array.from(canvas.drawn[0] ?? [])).toEqual(Array.from(decodeBlurhash(HASH, BLURHASH_SIZE, BLURHASH_SIZE)));
  });

  it('returns the same string for the same hash and draws it once', () => {
    const first = blurhashToDataUrl(HASH);
    const second = blurhashToDataUrl(HASH);
    expect(second).toBe(first);
    expect(canvas.created).toHaveLength(1);
    expect(blurhashToDataUrl(OTHER)).not.toBe(first);
    expect(canvas.created).toHaveLength(2);
  });

  it('keeps at most 128 hashes and forgets the least recently used first', () => {
    const hashes = Array.from({ length: 129 }, (_, i) => `${HASH.slice(0, 24)}${i.toString().padStart(4, '0')}`);
    hashes.forEach((hash) => blurhashToDataUrl(hash));
    expect(canvas.created).toHaveLength(129);
    blurhashToDataUrl(hashes[128] as string);
    expect(canvas.created).toHaveLength(129);
    blurhashToDataUrl(hashes[0] as string);
    expect(canvas.created).toHaveLength(130);
  });

  it('gives no URL for a malformed hash, and none without a DOM', () => {
    expect(blurhashToDataUrl('LKO2?U%2Tw=w')).toBeNull();
    canvas.uninstall();
    clearBlurhashCache();
    expect(blurhashToDataUrl(HASH)).toBeNull();
  });
});
