// node --test scripts/process-photos.test.mjs — the 09 §4.6 grade on a grey ramp: black point lifted by ≤ 3 %, contrast +6 %.
import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { GRADE, grade } from './process-photos.mjs';

async function ramp() {
  const width = 256;
  const data = Buffer.alloc(width * 3);
  for (let x = 0; x < width; x += 1) data.fill(x, x * 3, x * 3 + 3);
  return sharp(data, { raw: { width, height: 1, channels: 3 } }).png().toBuffer();
}

test('grade lifts black by the configured amount and keeps the slope at 1 + contrast', async () => {
  const { data, raw } = await grade(await ramp());
  const at = (x) => data[x * raw.channels];
  assert.ok(GRADE.blackLift <= 0.03, 'black lift at most 3 %');
  assert.ok(Math.abs(at(0) - Math.round(255 * GRADE.blackLift)) <= 1, `black ${at(0)}`);
  const slope = (at(192) - at(64)) / 128;
  assert.ok(Math.abs(slope - (1 + GRADE.contrast)) < 0.02, `slope ${slope}`);
  assert.ok(Math.abs(at(128) - 128) <= 5, `mid ${at(128)}`);
});
