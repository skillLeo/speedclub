/**
 * Review SF-2: the last 1.2 s of the autosave survive the page or the app going away. React cleanups do not run when a tab closes or a
 * process is swept away, so the designer sends what waits the moment it is hidden:
 * - web: `pagehide` and `visibilitychange: hidden` flush with `keepalive` (the browser finishes the PUT after the page is gone);
 *   while something waits or is on its way, `beforeunload` asks the browser's own "Seite verlassen?" (never the in-app guard);
 * - native: AppState `background` flushes, `active` resumes a save that failed while away.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { isWeb } from '@/lib/platform';

import type { AutosaveQueue } from './autosave';

export function useLeaveFlush(queue: AutosaveQueue): void {
  useEffect(() => {
    if (isWeb) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      const hide = () => void queue.flush({ keepalive: true });
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') hide();
        else queue.resume();
      };
      const onBeforeUnload = (event: BeforeUnloadEvent) => {
        if (!queue.unsaved) return;
        hide();
        event.preventDefault();
      };
      window.addEventListener('pagehide', hide);
      window.addEventListener('beforeunload', onBeforeUnload);
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        window.removeEventListener('pagehide', hide);
        window.removeEventListener('beforeunload', onBeforeUnload);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') void queue.flush();
      if (state === 'active') queue.resume();
    });
    return () => subscription.remove();
  }, [queue]);
}
