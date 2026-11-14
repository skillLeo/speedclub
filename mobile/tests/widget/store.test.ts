import { ensureWidgetPhoto, pickWidgetVariant } from '@/features/widget/photo';
import { prunePhotos, readSnapshot, removeWidgetFiles, writeSnapshot } from '@/features/widget/store';

import { media, snapshot } from './fixtures';

// An in-memory expo-file-system: files by URI, directories as prefixes.
const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();

jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) =>
    parts
      .map((part) => (typeof part === 'string' ? part : (part as { uri: string }).uri))
      .reduce((path, part, index) => (index === 0 ? part : `${path.replace(/\/$/, '')}/${part}`), '');
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = `${join(parts).replace(/\/$/, '')}/`;
    }
    get exists() {
      return mockDirs.has(this.uri);
    }
    create() {
      mockDirs.add(this.uri);
    }
    list() {
      return [...mockFiles.keys()].filter((uri) => uri.startsWith(this.uri)).map((uri) => new File(uri));
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    create() {
      mockFiles.set(this.uri, '');
    }
    async write(content: string) {
      mockFiles.set(this.uri, content);
    }
    async text() {
      return mockFiles.get(this.uri) ?? '';
    }
    async move(target: File) {
      mockFiles.set(target.uri, mockFiles.get(this.uri) ?? '');
      mockFiles.delete(this.uri);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { document: new Directory('file:///docs'), cache: new Directory('file:///cache') } };
});
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));

beforeEach(() => {
  mockFiles.clear();
  mockDirs.clear();
});

describe('widget snapshot store', () => {
  it('writes the snapshot into the documents folder and reads it back', async () => {
    expect(await readSnapshot()).toBeNull();
    await writeSnapshot(snapshot());
    expect([...mockFiles.keys()]).toEqual(['file:///docs/widget/mein-auto.json']);
    expect(await readSnapshot()).toEqual(snapshot());
  });

  it('reads a broken file as no snapshot', async () => {
    mockDirs.add('file:///docs/widget/');
    mockFiles.set('file:///docs/widget/mein-auto.json', '{"v":1,"member"');
    expect(await readSnapshot()).toBeNull();
  });

  it('clears everything on sign-out, and prunes old photos but keeps the snapshot', async () => {
    await writeSnapshot(snapshot());
    mockFiles.set('file:///docs/widget/car-m0-1080.jpg', 'old');
    mockFiles.set('file:///docs/widget/car-m1-1080.jpg', 'current');
    prunePhotos('file:///docs/widget/car-m1-1080.jpg');
    expect([...mockFiles.keys()].sort()).toEqual(['file:///docs/widget/car-m1-1080.jpg', 'file:///docs/widget/mein-auto.json']);
    removeWidgetFiles();
    expect(mockFiles.size).toBe(0);
    expect(await readSnapshot()).toBeNull();
  });
});

describe('widget photo', () => {
  it('downloads the smallest variant whose 4:5 crop is at least 720 wide', () => {
    expect(pickWidgetVariant(media())?.url).toBe('https://cdn/1080.webp');
    const landscape = media({ variants: [{ width: 1280, height: 720, url: 'https://cdn/1280.webp' }, { width: 2560, height: 1440, url: 'https://cdn/2560.webp' }] });
    // 1280 × 720 crops to 576 wide, so the larger one.
    expect(pickWidgetVariant(landscape)?.url).toBe('https://cdn/2560.webp');
    expect(pickWidgetVariant(media({ variants: [{ width: 320, height: 427, url: 'https://cdn/320.webp' }] }))?.url).toBe('https://cdn/320.webp');
    expect(pickWidgetVariant(media({ variants: [] }))).toBeNull();
  });

  const deps = () => ({
    download: jest.fn(async (_url: string, target: { uri: string }) => {
      mockFiles.set(target.uri, 'source');
      return target as never;
    }),
    cut: jest.fn(async () => {
      mockFiles.set('file:///cache/manipulated.jpg', 'cut');
      return 'file:///cache/manipulated.jpg';
    }),
  });

  it('cuts the focal crop once and keeps it in the widget folder', async () => {
    const d = deps();
    const photo = await ensureWidgetPhoto(media(), null, d);
    expect(d.download).toHaveBeenCalledWith('https://cdn/1080.webp', expect.objectContaining({ uri: 'file:///cache/widget-source-m1' }));
    expect(d.cut).toHaveBeenCalledWith('file:///cache/widget-source-m1', { originX: 0, originY: 90, width: 1080, height: 1350 });
    expect(photo).toEqual({ uri: 'file:///docs/widget/car-m1-1080.jpg', mediaId: 'm1', source: 'https://cdn/1080.webp', width: 480, height: 600 });
    // The source download and the manipulator's file are gone; only the cut stays.
    expect([...mockFiles.keys()]).toEqual(['file:///docs/widget/car-m1-1080.jpg']);

    // The same variant again: no download.
    const again = await ensureWidgetPhoto(media(), photo, d);
    expect(again).toBe(photo);
    expect(d.download).toHaveBeenCalledTimes(1);
  });

  it('cuts again for a new cover, and gives none for a photo still processing or a failed download', async () => {
    const d = deps();
    const first = await ensureWidgetPhoto(media(), null, d);
    const next = await ensureWidgetPhoto(media({ id: 'm2' }), first, d);
    expect(next?.uri).toBe('file:///docs/widget/car-m2-1080.jpg');
    expect(await ensureWidgetPhoto(media({ status: 'processing' }), null, d)).toBeNull();
    expect(await ensureWidgetPhoto(null, null, d)).toBeNull();
    const failing = { ...deps(), download: jest.fn(() => Promise.reject(new Error('offline'))) };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await ensureWidgetPhoto(media({ id: 'm3' }), null, failing)).toBeNull();
    warn.mockRestore();
  });
});
