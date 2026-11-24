/** R5DQ-02: copy about arrow keys only for a mouse or trackpad; touch (the member web on an iPhone) and the apps get drag and pinch. */
import { renderHook } from '@testing-library/react-native';

import { FINE_POINTER_QUERY, finePointerQuery, hasFinePointer, useFinePointer } from '@/lib/platform';

function host(matches: boolean) {
  const matchMedia = jest.fn((query: string) => ({ matches, media: query, addEventListener: jest.fn(), removeEventListener: jest.fn() }) as unknown as MediaQueryList);
  return { matchMedia };
}

describe('fine pointer', () => {
  it('asks the browser for hover and a fine pointer', () => {
    const desktop = host(true);
    expect(hasFinePointer(true, desktop)).toBe(true);
    expect(desktop.matchMedia).toHaveBeenCalledWith(FINE_POINTER_QUERY);
    expect(FINE_POINTER_QUERY).toBe('(hover: hover) and (pointer: fine)');
  });

  it('a touch browser has none', () => {
    expect(hasFinePointer(true, host(false))).toBe(false);
  });

  it('natively and without matchMedia there is none', () => {
    expect(finePointerQuery(false, host(true))).toBeNull();
    expect(hasFinePointer(false, host(true))).toBe(false);
    expect(hasFinePointer(true, {})).toBe(false);
  });

  it('the hook is false in the apps', async () => {
    const { result } = await renderHook(() => useFinePointer());
    expect(result.current).toBe(false);
  });
});
