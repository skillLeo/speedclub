import { useSegments } from 'expo-router';

import { useShellStore } from '@/state/shell';
import { size, useBreakpoint } from '@/theme';
import { ToastHost } from '@/ui';
import { useStickyBarHeight } from '@/ui/toastPlacement';
import { PwaHost } from '@/features/pwa/PwaHost';

import { useNativeTabBarStore } from './navMode';

/** The tab-bar clearance of the toast: the JS bar on phones, the measured native bar (09 §6.1) wherever native tabs run. */
export function toastTabBarOffset({
  inTabs,
  phone,
  hidden,
  native,
}: {
  inTabs: boolean;
  phone: boolean;
  hidden: boolean;
  native: { active: boolean; obstruction: number };
}): number {
  if (!inTabs || hidden) return 0;
  if (native.active) return native.obstruction;
  return phone ? size.tabBar : 0;
}

/**
 * One toast host for the app, 8 above the tab bar where there is one, and 8 above the sticky CTA bar of a form, which
 * reports its height while its screen is focused. The gallery route mounts its own to test it.
 * M4.15: the member web's PwaHost (service worker, update toast, install hint) lives here, beside the toast it uses; native and
 * the gallery render none.
 */
export function ShellToastHost() {
  const [first] = useSegments();
  const { kind } = useBreakpoint();
  const hidden = useShellStore((state) => state.tabBarHidden);
  const native = useNativeTabBarStore();
  const stickyBar = useStickyBarHeight();
  if ((first as string | undefined) === 'dev') return null;
  const tabBarOffset = toastTabBarOffset({ inTabs: first === '(tabs)', phone: kind === 'phone', hidden, native });
  return (
    <>
      <ToastHost tabBarOffset={tabBarOffset} stickyBarHeight={stickyBar} />
      <PwaHost inTabs={first === '(tabs)'} />
    </>
  );
}
