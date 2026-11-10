import { act, renderHook } from '@testing-library/react-native';
import { useFonts } from 'expo-font';

import { READY_GATE_TIMEOUT_MS } from '@/lib/ready';
import { FONT_WAIT_TIMEOUT_MS, useAppFonts } from '@/theme/fonts';

let mockIsWeb = false;

jest.mock('expo-font', () => ({ useFonts: jest.fn() }));
jest.mock('@/lib/platform', () => ({
  get isWeb() {
    return mockIsWeb;
  },
}));

const useFontsMock = jest.mocked(useFonts);
const never = new Promise<never>(() => undefined);

function stubDocumentFonts(load: () => Promise<unknown>) {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { fonts: { load } } });
}

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
