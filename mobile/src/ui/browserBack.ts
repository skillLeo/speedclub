import { useEffect, useRef } from 'react';

/** The part of `window` the hook needs; injectable for tests. */
type BrowserWindow = Pick<Window, 'addEventListener' | 'removeEventListener'> & {
  history: Pick<History, 'state' | 'pushState' | 'back'>;
  location: Pick<Location, 'href'>;
};

const KEY = 'scOverlay';
let sequence = 0;

/** The browser's window with a history, or null: native has a global `window` without `history`, so this is also the web check. */
function browserWindow(): BrowserWindow | null {
  const candidate = (globalThis as { window?: Partial<BrowserWindow> }).window;
  return candidate?.history && candidate.location && typeof candidate.addEventListener === 'function' ? (candidate as BrowserWindow) : null;
}

const markerOf = (state: unknown): unknown => (state && typeof state === 'object' ? (state as Record<string, unknown>)[KEY] : undefined);

/**
 * BL-25: on the member web the browser's back button or gesture closes an open overlay first, as Android's back does natively, instead
 * of leaving the page under it. While `open`, the overlay owns one history entry on top of the page's: the same URL, with Expo Router's
 * entry id kept (its state is `{ id }`, global-state/browserHistoryAdapter), so the router reads the back to the page's own entry as
 * "nothing changed". A back pops that entry and calls `onClose`; an overlay closed any other way (its button, Escape, a swipe) takes
 * its entry back off, so no dead entry is left behind. Native (no `window.history`) does nothing.
 *
 * Only for overlays whose close stays on the page. A screen that is itself a route (the `(modals)/viewer` link) already has its entry,
 * and its close navigates: it passes `enabled = false`.
 */
export function useBrowserBackClose(open: boolean, onClose: () => void, enabled: boolean = true): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const win = open && enabled ? browserWindow() : null;
    if (!win) return undefined;
    sequence += 1;
    const token = `overlay-${sequence}`;
    const base = win.history.state as unknown;
    win.history.pushState({ ...(base && typeof base === 'object' ? base : {}), [KEY]: token }, '', win.location.href);
    let popped = false;
    const onPop = () => {
      if (popped || markerOf(win.history.state) === token) return;
      popped = true;
      close.current();
    };
    win.addEventListener('popstate', onPop);
    return () => {
      win.removeEventListener('popstate', onPop);
      // Closed without the back button: our entry is still on top, so take it off. When something navigated meanwhile, it is not on
      // top any more, and going back would undo that navigation.
      if (!popped && markerOf(win.history.state) === token) win.history.back();
    };
  }, [open, enabled]);
}
