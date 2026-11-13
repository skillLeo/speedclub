import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isWeb } from '@/lib/platform';
import { useSessionStore } from '@/state/session';
import { toast } from '@/ui';

import { InstallHintSheet } from './InstallHintSheet';
import {
  browserEnv,
  installHintForced,
  installHintSeen,
  installVariant,
  markInstallHintSeen,
  type InstallPromptEvent,
  type InstallVariant,
} from './installHint';
import { applyPwaUpdate, startServiceWorker, usePwaUpdate } from './serviceWorker';
// Registers the sign-out clean-up of this browser's push subscription for the whole session, not only once SET-09 was open.
import './webPush';

/** The hint waits until the first screen has settled, so it never covers the first paint. */
const HINT_DELAY_MS = 2500;
export const PWA_UPDATE_TOAST_ID = 'shell.pwaUpdate';

/**
 * The member web as an installed app (09 §8.13): registers the service worker, offers a waiting new version as a toast
 * ("Neue Version verfügbar · Neu laden", again whenever the tab comes back while it waits) and shows the install hint once to a
 * signed-in member inside the tabs. Native renders nothing. Mounted by ShellToastHost, next to the toast it uses.
 */
export function PwaHost({ inTabs }: { inTabs: boolean }) {
  return isWeb ? <PwaHostWeb inTabs={inTabs} /> : null;
}

function PwaHostWeb({ inTabs }: { inTabs: boolean }) {
  const { t } = useTranslation('common');
  const router = useRouter();
  const update = usePwaUpdate();
  const member = useSessionStore((state) => state.status === 'member');
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [variant, setVariant] = useState<InstallVariant | null>(null);
  const [hint, setHint] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    startServiceWorker((route) => router.push(route as Href));
  }, [router]);

  const offerUpdate = useCallback(() => {
    toast(t('pwa.update.message'), { action: { label: t('pwa.update.reload'), onPress: applyPwaUpdate }, testID: PWA_UPDATE_TOAST_ID });
  }, [t]);

  useEffect(() => {
    if (!update.waiting) return undefined;
    offerUpdate();
    const again = () => {
      if (document.visibilityState === 'visible') offerUpdate();
    };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, [update.waiting, offerUpdate]);

  useEffect(() => {
    const held = (event: Event) => {
      // The browser's mini-infobar would compete with the hint; the hint offers the same dialog.
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const installed = () => {
      markInstallHintSeen('installed');
      setHint(false);
    };
    window.addEventListener('beforeinstallprompt', held);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', held);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  useEffect(() => {
    const forced = installHintForced();
    if (handled.current || !inTabs || (!member && !forced) || installHintSeen()) return undefined;
    const next = installVariant(browserEnv(), prompt !== null, forced);
    if (!next) return undefined;
    const timer = setTimeout(
      () => {
        handled.current = true;
        // Once per browser, from the moment it shows: a reload with the sheet open does not bring it back.
        markInstallHintSeen('dismissed');
        setVariant(next);
        setHint(true);
      },
      forced ? 0 : HINT_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [inTabs, member, prompt]);

  const close = useCallback(() => setHint(false), []);
  const install = useCallback(() => {
    const event = prompt;
    setHint(false);
    if (!event) return;
    setPrompt(null);
    void event
      .prompt()
      .then(() => event.userChoice)
      .then((choice) => {
        if (choice.outcome === 'accepted') markInstallHintSeen('installed');
      })
      .catch(() => undefined);
  }, [prompt]);

  // Kept mounted after closing, so the sheet plays its exit.
  return variant ? <InstallHintSheet visible={hint} variant={variant} onClose={close} onInstall={install} /> : null;
}
