import { useCallback, useEffect, useRef } from 'react';

/**
 * QA-H05: a form's submit that runs once at a time. A double tap reached the submit twice: the button's `loading` comes from the
 * mutation's `isPending`, which TanStack Query hands to React only after a timer tick (notifyManager batches into a timeout), and the
 * schema check before it is asynchronous too, so a second tap in between started a second request (two PATCHes on GAR-05, a second
 * POST of the same mod answered 409 on GAR-10, two code mails on AUTH-12). The guard is a ref, set in the same event as the tap, and
 * released when the submit settles; a call while it runs is dropped. The returned function keeps its identity; it always runs the
 * latest `submit` (React Hook Form's `handleSubmit(...)` is a new function every render).
 */
export function useSingleFlight<Args extends unknown[]>(submit: (...args: Args) => Promise<unknown>): (...args: Args) => Promise<void> {
  const latest = useRef(submit);
  const running = useRef(false);
  useEffect(() => {
    latest.current = submit;
  }, [submit]);
  return useCallback(async (...args: Args) => {
    if (running.current) return;
    running.current = true;
    try {
      await latest.current(...args);
    } finally {
      running.current = false;
    }
  }, []);
}
