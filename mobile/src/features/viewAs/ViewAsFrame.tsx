import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';

import { meKey } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { createStyles } from '@/theme';

import { ViewAsBanner } from './ViewAsBanner';
import { ViewAsEndedScreen, ViewAsFailedScreen } from './ViewAsEndedScreen';
import { dropViewAsFragment, useViewAsStore } from './viewAsSession';

/** How often a live view asks auth/me, so a token that expired (30 minutes) or was ended from the admin shows as ended. */
export const VIEW_AS_CHECK_MS = 60 * 1000;

const useStyles = createStyles((t) => ({
  frame: { backgroundColor: t.color.bg.canvas, flex: 1 },
  app: { flex: 1, minHeight: 0 },
}));

/**
 * The root of the app in a view-as tab (m3.2-contract §3), around the root stack: the bar above every screen, modals and sheets of
 * the stack included, and in place of the app once the view is over. In any other tab, and always on native, only its children.
 */
export function ViewAsFrame({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const status = useViewAsStore((state) => state.status);
  const reason = useViewAsStore((state) => state.reason);

  // The token never stays in the address bar, also after the router wrote its first state back (it read the address earlier).
  useEffect(() => {
    if (status === 'off') return undefined;
    dropViewAsFragment();
    const timers = [setTimeout(dropViewAsFragment, 0), setTimeout(dropViewAsFragment, 1000)];
    return () => timers.forEach(clearTimeout);
  }, [status]);

  useEffect(() => {
    if (status !== 'active') return undefined;
    const timer = setInterval(() => void queryClient.invalidateQueries({ queryKey: meKey }), VIEW_AS_CHECK_MS);
    return () => clearInterval(timer);
  }, [status]);

  if (status === 'off') return children;
  if (status === 'ended') return <ViewAsEndedScreen reason={reason ?? 'ended'} />;
  if (status === 'failed') return <ViewAsFailedScreen />;
  return (
    <View style={styles.frame}>
      <ViewAsBanner />
      <View style={styles.app}>{children}</View>
    </View>
  );
}
