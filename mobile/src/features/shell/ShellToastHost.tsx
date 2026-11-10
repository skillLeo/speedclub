import { useSegments } from 'expo-router';

import { useShellStore } from '@/state/shell';
import { size, useBreakpoint } from '@/theme';
import { ToastHost } from '@/ui';
import { useStickyBarHeight } from '@/ui/toastPlacement';

/**
 * One toast host for the app, 8 above the tab bar where there is one, and 8 above the sticky CTA bar of a form, which
 * reports its height while its screen is focused. The gallery route mounts its own to test it.
 */
export function ShellToastHost() {
  const [first] = useSegments();
  const { kind } = useBreakpoint();
  const hidden = useShellStore((state) => state.tabBarHidden);
  const stickyBar = useStickyBarHeight();
  if ((first as string | undefined) === 'dev') return null;
  const overTabBar = first === '(tabs)' && kind === 'phone' && !hidden;
  return <ToastHost tabBarOffset={overTabBar ? size.tabBar : 0} stickyBarHeight={stickyBar} />;
}
