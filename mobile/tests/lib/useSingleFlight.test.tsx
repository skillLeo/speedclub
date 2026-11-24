/**
 * QA-H05 (QA H1, 2026-11-23): a double tap on a form's button started its submit twice (two PATCHes on GAR-05, a 409 for the second
 * POST of the same mod on GAR-10, two code mails on AUTH-12): `loading` reaches the button only after a timer tick. useSingleFlight drops a
 * call while one runs. Flow side: web/tests/e2e/hunt/garage.spec.ts and account.spec.ts "double tap".
 */
import { act, renderHook } from '@testing-library/react-native';

import { useSingleFlight } from '@/lib/useSingleFlight';

describe('useSingleFlight', () => {
  it('runs a second call made while the first runs not at all, and the next one after it settles', async () => {
    let finish: () => void = () => undefined;
    const submit = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = await renderHook(() => useSingleFlight(submit));
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current();
      void result.current();
      void result.current();
    });
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await first;
    });
    await act(async () => {
      const again = result.current();
      finish();
      await again;
    });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('releases after a failure and always runs the latest submit', async () => {
    const failing = jest.fn(() => Promise.reject(new Error('boom')));
    const later = jest.fn(() => Promise.resolve());
    const { result, rerender } = await renderHook(({ fn }: { fn: () => Promise<unknown> }) => useSingleFlight(fn), { initialProps: { fn: failing } });
    const stable = result.current;
    await act(async () => {
      await expect(result.current()).rejects.toThrow('boom');
    });
    await rerender({ fn: later });
    expect(result.current).toBe(stable);
    await act(async () => {
      await result.current();
    });
    expect(later).toHaveBeenCalledTimes(1);
  });
});
