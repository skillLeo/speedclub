/**
 * M1.9: on web, a blurhash placeholder reaches expo-image as a `data:image/png` URL and never as `{ blurhash }`, which
 * expo-image would turn into a `blob:` URL it revokes on unmount (WebKitBlobResource error 1 on Start).
 */
import { screen } from '@testing-library/react-native';

import { blurhashToDataUrl, clearBlurhashCache } from '@/lib/blurhash';
import { hydrateThemePreference } from '@/theme';
import { Avatar } from '@/ui/Avatar';
import { imagePlaceholder } from '@/ui/imagePlaceholder';
import { Photo } from '@/ui/Photo';

import { installFakeCanvas } from './fakeCanvas';
import { renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

const HASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

beforeAll(hydrateThemePreference);

let canvas: ReturnType<typeof installFakeCanvas>;
beforeEach(() => {
  clearBlurhashCache();
  canvas = installFakeCanvas();
});
afterEach(() => canvas.uninstall());

/** Draws the hash with the fake canvas, then takes the DOM away again: the render must be served from the memo. */
function warm(hash: string): string {
  const url = blurhashToDataUrl(hash);
  canvas.uninstall();
  if (!url) throw new Error('no data URL');
  return url;
}

describe('image placeholder on web', () => {
  it('passes a PNG data URL with the content fit, never a blurhash', () => {
    const props = imagePlaceholder(HASH, 'contain');
    expect(props.placeholder).toEqual({ uri: expect.stringMatching(/^data:image\/png;base64,/) });
    expect(props.placeholder).not.toHaveProperty('blurhash');
    expect(props.placeholderContentFit).toBe('contain');
  });

  it('returns the memoised URL for the same hash', () => {
    const first = imagePlaceholder(HASH, 'cover');
    const second = imagePlaceholder(HASH, 'cover');
    expect(second.placeholder).toEqual(first.placeholder);
    expect(canvas.created).toHaveLength(1);
  });

  it('leaves the placeholder out without a hash or for a malformed one', () => {
    expect(imagePlaceholder(null, 'cover')).toEqual({});
    expect(imagePlaceholder('LKO2?U%2Tw=w', 'cover')).toEqual({});
  });

  it('Photo hands expo-image the data URL, fitted with cover', async () => {
    const url = warm(HASH);
    await renderUi(<Photo aspect="4:3" source="https://x/a.webp" blurhash={HASH} testID="p" />);
    const image = screen.getByTestId('p.image');
    const placeholder = JSON.stringify(image.props.placeholder);
    expect(placeholder).toContain(url);
    expect(placeholder).not.toContain('blurhash:/');
    expect(image.props.placeholderContentFit).toBe('cover');
    expect(image.props.contentFit).toBe('cover');
  });

  it('Avatar hands expo-image the data URL, fitted with cover', async () => {
    const url = warm(HASH);
    await renderUi(<Avatar name="Lukas Schneider" uri="https://x/a.webp" blurhash={HASH} testID="a" />);
    const image = screen.getByTestId('a.image', { includeHiddenElements: true });
    expect(JSON.stringify(image.props.placeholder)).toContain(url);
    expect(JSON.stringify(image.props.placeholder)).not.toContain('blurhash:/');
    expect(image.props.placeholderContentFit).toBe('cover');
  });
});
