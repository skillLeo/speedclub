import { useCallback, useEffect, useState } from 'react';

import { useAppConfig, useFlag } from '@/api/queries/appConfig';
import { vapidPublicKey } from '@/api/queries/webPush';
import { isWeb } from '@/lib/platform';

import { currentSubscription, disableWebPush, enableWebPush, webPushPermission, webPushSupport, type EnableOutcome } from './webPush';

/**
 * SET-09's browser row (09 §7.9, §8.13). `hidden`: native, the `web_push` flag off, or no VAPID key on the server (ADR-452) —
 * the option is not offered at all. Every other state is shown with what the member can do about it.
 */
export type WebPushState =
  | { kind: 'hidden' }
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  | { kind: 'needsInstall' }
  | { kind: 'denied' }
  | { kind: 'off' }
  | { kind: 'on' }
  /** The server has no subscription endpoint yet (lane B pending): said once, nothing stays half on. */
  | { kind: 'unavailable' };

export const WEB_PUSH_FLAG = 'web_push';

/** What the browser says without asking anything: read during render, so a later config or permission change shows at once. */
function browserState(offered: boolean): WebPushState {
  if (!offered) return { kind: 'hidden' };
  const support = webPushSupport();
  if (support !== 'supported') return { kind: support };
  if (webPushPermission() === 'denied') return { kind: 'denied' };
  return { kind: 'checking' };
}

export function useWebPush(): {
  state: WebPushState;
  busy: boolean;
  enable: () => Promise<EnableOutcome>;
  disable: () => Promise<void>;
} {
  const flag = useFlag(WEB_PUSH_FLAG);
  const { config } = useAppConfig();
  const key = vapidPublicKey(config);
  const offered = isWeb && flag && key !== null;
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [answer, setAnswer] = useState<'denied' | 'unavailable' | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped when the tab comes back: the permission may have changed in the browser's site settings meanwhile.
  const [visits, setVisits] = useState(0);

  const base = browserState(offered);
  const asking = base.kind === 'checking';

  useEffect(() => {
    if (!asking) return undefined;
    let live = true;
    void currentSubscription().then((subscription) => {
      if (live) setSubscribed(subscription !== null);
    });
    return () => {
      live = false;
    };
  }, [asking, visits]);

  useEffect(() => {
    if (!isWeb) return undefined;
    const again = () => {
      if (document.visibilityState === 'visible') setVisits((count) => count + 1);
    };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, []);

  let state: WebPushState = base;
  if (asking) {
    if (answer) state = { kind: answer };
    else if (subscribed !== null) state = { kind: subscribed ? 'on' : 'off' };
  }

  const enable = useCallback(async (): Promise<EnableOutcome> => {
    if (!key) return 'unavailable';
    setBusy(true);
    try {
      const outcome = await enableWebPush(key);
      if (outcome === 'on') setSubscribed(true);
      else if (outcome === 'denied') setAnswer('denied');
      else if (outcome === 'unavailable') setAnswer('unavailable');
      else setVisits((count) => count + 1);
      return outcome;
    } finally {
      setBusy(false);
    }
  }, [key]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      await disableWebPush();
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, enable, disable };
}
