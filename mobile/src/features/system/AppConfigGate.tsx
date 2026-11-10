import * as Application from 'expo-application';
import { router, usePathname, useRootNavigationState, useSegments, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { appGateFor, useAppConfig } from '@/api/queries/appConfig';

import appVersion from '../../../version.json';

export const currentAppVersion = Application.nativeApplicationVersion ?? appVersion.versionName;

/**
 * Sends the app to /maintenance or /update-required when the config demands it, and back when it no longer does. It
 * renders nothing and blocks nothing: until an answer arrives the app runs on the cached or bundled config. The way
 * back needs the server's word, so a web reload on a gate route leaves it too, while bundled defaults never do. The
 * one exception is a cached maintenance flag that no answer backs (`released`): it must not hold the app offline.
 * Leaving returns to where the gate took over, so a cold QR or /v/[slug] link is not lost; a direct load of a gate route goes home.
 */
export function AppConfigGate() {
  const { config, confirmed, released } = useAppConfig();
  const navigatorReady = Boolean(useRootNavigationState()?.key);
  const here = useSegments()[0];
  const pathname = usePathname();
  const returnTo = useRef<string | null>(null);
  const gate = appGateFor(config, Platform.OS, currentAppVersion);
  const onGateRoute = here === 'maintenance' || here === 'update-required';

  useEffect(() => {
    if (!navigatorReady) return;
    if (gate) {
      if (here === gate) return;
      if (!onGateRoute) returnTo.current = pathname;
      router.replace(`/${gate}`);
    } else if (onGateRoute && (confirmed || released)) {
      router.replace((returnTo.current ?? '/') as Href);
      returnTo.current = null;
    }
  }, [confirmed, gate, here, navigatorReady, onGateRoute, pathname, released]);

  return null;
}
