/**
 * Connectivity. Web reads navigator.onLine only: NetInfo's web reachability check calls a third-party host, which the
 * CSP blocks. Native reads NetInfo. Unknown counts as online, so the banner never shows without a reason.
 */
import NetInfo from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';

import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';

function subscribeWeb(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

function snapshotWeb(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

let nativeOnline = true;

// Every hook instance has its own NetInfo handler and must always notify: the first handler has already updated
// nativeOnline by the time the later ones run. useSyncExternalStore ignores a snapshot that did not change.
function subscribeNative(listener: () => void): () => void {
  return NetInfo.addEventListener((state) => {
    nativeOnline = state.isConnected !== false;
    listener();
  });
}

const subscribe = isWeb ? subscribeWeb : subscribeNative;
const snapshot = isWeb ? snapshotWeb : () => nativeOnline;

/** False while the device is offline, and whenever `qaState=offline` forces it. */
export function useOnline(): boolean {
  const online = useSyncExternalStore(subscribe, snapshot, snapshot);
  const qaState = useQaState();
  return qaState === 'offline' ? false : online;
}
