/* eslint-disable @typescript-eslint/no-require-imports */
import { act, renderHook } from '@testing-library/react-native';
import { useFonts } from 'expo-font';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpoConfig } from 'expo/config';

import { READY_GATE_TIMEOUT_MS } from '@/lib/ready';
import { cssFamily, fontFaces, fonts, typeScaleFaces, typography } from '@/theme';
import { FONT_WAIT_TIMEOUT_MS, useAppFonts, webFontFamilies } from '@/theme/fonts';
import { LATIN_EXT_STYLE_ID, LATIN_EXT_UNICODE_RANGE, latinExtFontFaceRules, registerLatinExtFaces } from '@/theme/latinExtFaces';

let mockIsWeb = false;

jest.mock('expo-font', () => ({ useFonts: jest.fn(), FontDisplay: { SWAP: 'swap' } }));
// Metro serves a bundled asset under a hashed URL; the module id stands in for the hash here.
jest.mock('expo-asset', () => ({ Asset: { fromModule: (module: number) => ({ uri: `/app/assets/font-${module}.woff2` }) } }));
jest.mock('@/lib/platform', () => ({
  get isWeb() {
    return mockIsWeb;
  },
}));
// The web build maps every face to its woff2 module (webFontFiles.web.ts); a number stands in for the module id.
jest.mock('@/theme/webFontFiles', () => {
  const faces = ['Inter-Regular', 'Inter-Medium', 'Inter-SemiBold', 'Inter-Bold', 'InterDisplay-SemiBold', 'InterDisplay-Bold'];
  const archivo = ['ArchivoCondensed-SemiBold', 'ArchivoCondensed-Bold', 'ArchivoSemiExpanded-SemiBold', 'ArchivoSemiExpanded-Bold'];
  const all = [...faces, ...archivo];
  return {
    webFontFiles: Object.fromEntries(all.map((face, index) => [face, index + 1])),
    webLatinExtFiles: Object.fromEntries(all.map((face, index) => [face, index + 101])),
  };
});

const MOBILE = join(__dirname, '..');

const useFontsMock = jest.mocked(useFonts);
const never = new Promise<never>(() => undefined);

/** A document with what fonts.ts and latinExtFaces.ts touch: document.fonts and the head the latin-ext rules go into. */
function fakeDocument(load: (query: string) => Promise<unknown> = () => Promise.resolve([])) {
  const appended: { id: string; textContent: string }[] = [];
  return {
    appended,
    fonts: { load },
    getElementById: (id: string) => appended.find((node) => node.id === id) ?? null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (node: { id: string; textContent: string }) => appended.push(node) },
  };
}

function stubDocumentFonts(load: (query: string) => Promise<unknown>) {
  const doc = fakeDocument(load);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  return doc;
}

describe('the 2.0 faces (09 §4.2, ADR-402)', () => {
  it('names each face once, by its PostScript name, with its weight', () => {
    expect(fontFaces.map((entry) => `${entry.face}@${entry.weight}`)).toEqual([
      'Inter-Regular@400',
      'Inter-Medium@500',
      'Inter-SemiBold@600',
      'Inter-Bold@700',
      'InterDisplay-SemiBold@600',
      'InterDisplay-Bold@700',
      'ArchivoCondensed-SemiBold@600',
      'ArchivoCondensed-Bold@700',
      'ArchivoSemiExpanded-SemiBold@600',
      'ArchivoSemiExpanded-Bold@700',
    ]);
    expect(fontFaces.some((entry) => /barlow/i.test(entry.face))).toBe(false);
  });

  it('has a TTF for every face in assets/fonts and a woff2 in assets/fonts/web, with the OFL next to them', () => {
    const native = readdirSync(join(MOBILE, 'assets/fonts'));
    const web = readdirSync(join(MOBILE, 'assets/fonts/web'));
    for (const { face } of fontFaces) {
      expect(native).toContain(`${face}.ttf`);
      expect(web).toContain(`${face}.woff2`);
    }
    // Only TTFs in the embedded folder: iOS would also embed a woff2 found there.
    expect(native.filter((file) => /\.(woff2?|otf)$/.test(file))).toEqual([]);
    for (const folder of [native, web]) expect(folder).toEqual(expect.arrayContaining(['OFL-Inter.txt', 'OFL-Archivo.txt']));
  });

  it('embeds exactly these faces on native through the expo-font config plugin', () => {
    let config: ExpoConfig | undefined;
    jest.isolateModules(() => {
      config = (require('../app.config') as { default: ExpoConfig }).default;
    });
    const entry = config!.plugins!.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-font') as [string, { fonts: string[] }];
    expect(entry[1].fonts).toEqual(fontFaces.map(({ face }) => `./assets/fonts/${face}.ttf`));
    expect(config!.plugins).not.toContain('expo-font');
  });

  it('every role of the type scale uses an embedded face', () => {
    for (const style of Object.values(typography)) {
      expect(fontFaces.map((entry) => entry.face)).toContain(style.fontFamily);
    }
    expect(new Set(typeScaleFaces)).toEqual(new Set(Object.values(typography).map((style) => style.fontFamily)));
  });

  it('loads on web one CSS family per group, one face per weight the type scale uses, every face swapping in (CSS font display: swap)', () => {
    const families = webFontFamilies({ 'Inter-Regular': 1, 'Inter-SemiBold': 3, 'Inter-Bold': 4, 'ArchivoCondensed-SemiBold': 7 });
    expect(families).toEqual([
      {
        fontFamily: 'Inter',
        fontDefinitions: [
          { path: 1, weight: 400, display: 'swap' },
          { path: 3, weight: 600, display: 'swap' },
        ],
      },
      { fontFamily: 'Archivo Condensed', fontDefinitions: [{ path: 7, weight: 600, display: 'swap' }] },
    ]);
    // The CSS family is the one each token stack starts with.
    expect(cssFamily('ui')).toBe('Inter');
    expect(cssFamily('uiDisplay')).toBe('Inter Display');
    expect(cssFamily('marque')).toBe('Archivo SemiExpanded');
    expect(fonts.marque.css.startsWith("'Archivo SemiExpanded'")).toBe(true);
  });
});

describe('Latin Extended on the member web (MF-1)', () => {
  const manifest = JSON.parse(readFileSync(join(MOBILE, '../design/fonts/manifest.json'), 'utf8')) as {
    unicodeRanges: { latinExt: string };
  };

  it('uses exactly the range the font build cut the latin-ext files to', () => {
    expect(LATIN_EXT_UNICODE_RANGE).toBe(manifest.unicodeRanges.latinExt);
    const css = readFileSync(join(MOBILE, '../design/fonts/fonts.css'), 'utf8');
    expect(css).toContain(`-latin-ext.woff2") format("woff2"); unicode-range: ${LATIN_EXT_UNICODE_RANGE}; }`);
  });

  it('has a latin-ext woff2 for every type-scale face, and the web bundle maps each one', () => {
    const web = readdirSync(join(MOBILE, 'assets/fonts/web'));
    const map = readFileSync(join(MOBILE, 'src/theme/webFontFiles.web.ts'), 'utf8');
    for (const face of typeScaleFaces) {
      expect(web).toContain(`${face}-latin-ext.woff2`);
      expect(map).toContain(`'${face}': require('../../assets/fonts/web/${face}-latin-ext.woff2')`);
    }
  });

  it('writes one @font-face per type-scale face: same family and weight as the base face, swap, the latin-ext range', () => {
    const files = Object.fromEntries(fontFaces.map((entry, index) => [entry.face, index + 1]));
    const rules = latinExtFontFaceRules(files, (module) => `/app/assets/f${module}.woff2`);
    const expected = fontFaces.filter((entry) => typeScaleFaces.includes(entry.face));
    expect(rules).toHaveLength(expected.length);
    expected.forEach((entry, index) => {
      const rule = rules[index]!;
      expect(rule).toContain(`font-family: "${cssFamily(entry.group)}";`);
      expect(rule).toContain(`font-weight: ${entry.weight};`);
      expect(rule).toContain('font-display: swap;');
      expect(rule).toContain(`src: url("/app/assets/f${files[entry.face]}.woff2") format("woff2");`);
      expect(rule).toContain(`unicode-range: ${LATIN_EXT_UNICODE_RANGE};`);
    });
    // A face without a file, or without a URL, gets no rule.
    expect(latinExtFontFaceRules({ 'Inter-Regular': 1 }, () => null)).toEqual([]);
  });

  it('writes the rules into the document once', () => {
    const doc = fakeDocument();
    const files = { 'Inter-Regular': 1, 'ArchivoSemiExpanded-SemiBold': 9 };
    expect(registerLatinExtFaces(doc as never, files, (module) => `/f${module}.woff2`)).toBe(2);
    expect(registerLatinExtFaces(doc as never, files, (module) => `/f${module}.woff2`)).toBe(0);
    expect(doc.appended).toHaveLength(1);
    expect(doc.appended[0]!.id).toBe(LATIN_EXT_STYLE_ID);
    expect(doc.appended[0]!.textContent).toContain('font-family: "Archivo SemiExpanded"; font-style: normal; font-weight: 600;');
  });
});

describe('useAppFonts', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockIsWeb = false;
  });

  afterEach(() => {
    warn.mockRestore();
    jest.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
  });

  async function advance(ms: number) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  it('loads nothing at runtime on native, where the faces are embedded', async () => {
    useFontsMock.mockImplementation((map) => [Array.isArray(map) && map.length === 0, null]);
    const { result } = await renderHook(() => useAppFonts());
    expect(useFontsMock).toHaveBeenLastCalledWith([]);
    expect(result.current).toBe(true);
  });

  it('loads the subset woff2 families on web and waits for each face by weight', async () => {
    mockIsWeb = true;
    const load = jest.fn((query: string) => Promise.resolve([query]));
    const doc = stubDocumentFonts(load);
    useFontsMock.mockReturnValue([true, null]);
    const { result } = await renderHook(() => useAppFonts());
    await advance(0);
    // MF-1: the latin-ext rules are in the document by then, one per type-scale face, from the Metro asset URLs.
    const latinExt = doc.appended.find((node) => node.id === LATIN_EXT_STYLE_ID);
    expect(latinExt?.textContent.split('\n')).toHaveLength(typeScaleFaces.length);
    expect(latinExt?.textContent).toContain('url("/app/assets/font-101.woff2")');
    const families = (useFontsMock.mock.lastCall as unknown[])[0] as { fontFamily: string }[];
    expect(families.map((family) => family.fontFamily)).toEqual(['Inter', 'Inter Display', 'Archivo Condensed', 'Archivo SemiExpanded']);
    expect(load.mock.calls.map(([query]) => query)).toEqual(
      expect.arrayContaining(['400 1em "Inter"', '600 1em "Inter Display"', '600 1em "Archivo Condensed"', '600 1em "Archivo SemiExpanded"']),
    );
    expect(result.current).toBe(true);
  });

  it('mounts the stack before the ready gates give up', () => {
    expect(FONT_WAIT_TIMEOUT_MS).toBeLessThan(READY_GATE_TIMEOUT_MS);
  });

  it('stops waiting when useFonts never settles', async () => {
    useFontsMock.mockReturnValue([false, null]);
    const { result } = await renderHook(() => useAppFonts());
    await advance(FONT_WAIT_TIMEOUT_MS - 1);
    expect(result.current).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    await advance(1);
    expect(result.current).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stops waiting when document.fonts.load never settles on web', async () => {
    mockIsWeb = true;
    stubDocumentFonts(() => never);
    useFontsMock.mockReturnValue([true, null]);
    const { result } = await renderHook(() => useAppFonts());
    await advance(FONT_WAIT_TIMEOUT_MS - 1);
    expect(result.current).toBe(false);
    await advance(1);
    expect(result.current).toBe(true);
  });

  it('does not restart the wait when useFonts settles late', async () => {
    mockIsWeb = true;
    stubDocumentFonts(() => never);
    useFontsMock.mockReturnValue([false, null]);
    const { result, rerender } = await renderHook(() => useAppFonts());
    await advance(FONT_WAIT_TIMEOUT_MS - 1);
    useFontsMock.mockReturnValue([true, null]);
    await rerender(undefined);
    expect(result.current).toBe(false);
    await advance(1);
    expect(result.current).toBe(true);
  });

  it('is ready without a warning once the fonts have loaded', async () => {
    useFontsMock.mockReturnValue([true, null]);
    const { result } = await renderHook(() => useAppFonts());
    expect(result.current).toBe(true);
    await advance(FONT_WAIT_TIMEOUT_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it('renders with the fallback stack when a font fails', async () => {
    useFontsMock.mockReturnValue([false, new Error('font failed')]);
    const { result } = await renderHook(() => useAppFonts());
    expect(result.current).toBe(true);
  });
});
