/**
 * DEX-02 (M5.9b, ADR-508): the sticker scanner needs android.permission.CAMERA. expo-image-picker with `cameraPermission: false`
 * removes that permission from the merged manifest (tools:node="remove") and so cancels expo-camera's; the 2.1.0 b20/b21 APKs
 * shipped without it. This pins the config so it cannot come back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const config = readFileSync(join(__dirname, '..', '..', 'app.config.ts'), 'utf8');

/** The options object of one plugin entry: `['name', { … }]`. */
function pluginOptions(name: string): string {
  const start = config.indexOf(`'${name}',`);
  expect(start).toBeGreaterThan(-1);
  const open = config.indexOf('{', start);
  const close = config.indexOf('}', open);
  return config.slice(open, close + 1);
}

describe('camera permission for the DEX-02 scanner', () => {
  it('expo-camera asks for the camera with the scanner purpose text and never for the microphone', () => {
    const options = pluginOptions('expo-camera');
    expect(options).toContain('cameraPermission: CAMERA_PURPOSE_DE');
    expect(options).toContain('microphonePermission: false');
  });

  it('expo-image-picker does not switch the camera permission off (that would strip CAMERA from the manifest)', () => {
    const options = pluginOptions('expo-image-picker');
    expect(options).not.toMatch(/cameraPermission:\s*false/);
    expect(options).toContain('cameraPermission: CAMERA_PURPOSE_DE');
    expect(options).toContain('microphonePermission: false');
  });
});
