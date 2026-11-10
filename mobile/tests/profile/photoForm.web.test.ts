/**
 * OBS-R11-1: the avatar (AUTH-09, PROF-03) and the cover (PROF-03) on the member web. The image is read back from the
 * manipulator as base64 and decoded in memory; the export's CSP (connect-src 'self') refuses fetch(blob:), so no request may
 * read it.
 */
import { avatarFormData, dataUriToBlob, jpegForm } from '@/features/auth/avatar';
import { profilePhotoForm } from '@/features/profile/photos';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false, isAndroid: false }));

const JPEG_BASE64 = '/9j/4AAQSkZJRgABAQ=='; // FF D8 FF E0 00 10 4A 46 49 46 00 01 01
const mockSaveAsync = jest.fn((options: { base64?: boolean }) =>
  Promise.resolve({ uri: 'blob:http://localhost:8080/0f3c', width: 800, height: 600, base64: options.base64 ? JPEG_BASE64 : undefined }),
);
const mockResize = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: jest.fn(() => ({ resize: mockResize, renderAsync: () => Promise.resolve({ saveAsync: mockSaveAsync }) })),
  },
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const fetchSpy = jest.fn(() => Promise.reject(new Error('Refused to connect: connect-src')));
beforeAll(() => {
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});
beforeEach(() => jest.clearAllMocks());

const PICKED = { uri: 'blob:http://localhost:8080/picked', width: 4032, height: 3024 };

async function bytesOf(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

/** The file part of a form, whichever FormData the environment has. */
function filePart(form: FormData): { value: Blob; name: string | undefined } {
  const parts = (form as unknown as { getParts?: () => { fieldName: string; file?: Blob; name?: string }[] }).getParts?.();
  if (parts) {
    const part = parts.find((entry) => entry.fieldName === 'file');
    return { value: part?.file as Blob, name: part?.name };
  }
  const value = form.get('file') as File;
  return { value, name: value.name };
}

describe('profile photos on the member web (OBS-R11-1)', () => {
  it.each([
    ['AUTH-09 avatar', () => avatarFormData(PICKED), 'avatar.jpg'],
    ['PROF-03 avatar', () => profilePhotoForm(PICKED, 'avatar'), 'avatar.jpg'],
    ['PROF-03 cover', () => profilePhotoForm(PICKED, 'cover'), 'cover.jpg'],
  ])('%s: the JPEG is decoded in memory, with no request to read it', async (_name, build, fileName) => {
    const form = await build();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockSaveAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg', base64: true }));
    expect(mockResize).toHaveBeenCalledWith({ width: 2560 });
    const { value, name } = filePart(form);
    expect(name).toBe(fileName);
    expect(value.type).toBe('image/jpeg');
    expect((await bytesOf(value)).slice(0, 4)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it('refuses a blob: URL instead of fetching it, which the CSP would block', () => {
    expect(() => jpegForm('blob:http://localhost:8080/0f3c', 'avatar.jpg')).toThrow('not a data URI');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('decodes the bytes and the type of a data URI', async () => {
    const blob = dataUriToBlob('data:image/jpeg;base64,/9j/AA==');
    expect(blob.type).toBe('image/jpeg');
    expect(await bytesOf(blob)).toEqual([0xff, 0xd8, 0xff, 0x00]);
  });
});
