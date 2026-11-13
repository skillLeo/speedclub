import { useEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VerifyEmailNotice } from '@/features/auth/VerifyEmailNotice';
import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';

import { reportNativeTabContentFrame, useNativeTabBarStore } from './navMode';

const useStyles = createStyles(() => ({ fill: { flex: 1 } }));

/**
 * Wraps the stack of each tab (the shared layout of the five groups). Under native tabs it does what ShellFrame does for the
 * JS shell: it reports where the native bar starts, so the toast host clears it (ShellToastHost), and it shows the e-mail
 * notice above the bar. The View is always there on native, so a flag change never remounts the stack inside it; the web
 * renders the stack alone.
 */
export function NativeTabContent({ children }: { children: ReactNode }) {
  if (isWeb) return children;
  return <NativeContent>{children}</NativeContent>;
}

function NativeContent({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const active = useNativeTabBarStore((state) => state.active);
  const { height } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const frame = useRef<ComponentRef<typeof View>>(null);

  const measure = () => {
    if (!active) return;
    frame.current?.measureInWindow((_x, y, _width, contentHeight) => reportNativeTabContentFrame(y + contentHeight, height, bottom));
  };
  // Native tabs switch on after the first layout of this frame (NativeTabsLayout's effect), and a rotation changes the window.
  useEffect(measure, [active, height, bottom]);

  return (
    <View ref={frame} style={styles.fill} onLayout={measure} testID="shell.nativeTabContent">
      <View style={styles.fill}>{children}</View>
      {active ? <VerifyEmailNotice /> : null}
    </View>
  );
}
