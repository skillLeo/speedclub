import { TabSlot } from 'expo-router/ui';
import { View } from 'react-native';

import { VerifyEmailNotice } from '@/features/auth/VerifyEmailNotice';
import { useShellStore } from '@/state/shell';
import { createStyles, useBreakpoint } from '@/theme';

import { Rail } from './Rail';
import { Sidebar } from './Sidebar';
import { renderTabSlot } from './tabSlotRender';
import { TabBar } from './TabBar';
import { TabBarOverlayContext } from './tabBarLayout';

const useStyles = createStyles((t) => ({
  frame: { backgroundColor: t.color.bg.canvas, flex: 1, flexDirection: 'row' },
  main: { alignItems: 'center', flex: 1, minWidth: 0 },
  slot: { flex: 1, maxWidth: t.layout.contentMax, width: '100%' },
}));

/**
 * The tab chrome. The three children keep their positions whichever bar shows, so TabSlot never remounts when the
 * window crosses a breakpoint: every tab keeps its stack and scroll position. Rail and sidebar come first in the
 * document, so keyboard focus reaches them before the content; the tab bar comes after it, as on a phone.
 */
export function ShellFrame() {
  const styles = useStyles();
  const { kind } = useBreakpoint();
  const hidden = useShellStore((state) => state.tabBarHidden);
  const overlay = kind === 'phone' && !hidden;

  return (
    <View style={styles.frame} testID="shell.frame">
      {kind === 'desktop' ? <Sidebar /> : kind === 'tablet' ? <Rail /> : null}
      <View style={styles.main}>
        <View style={styles.slot}>
          <TabBarOverlayContext value={overlay}>
            {/* renderTabSlot keeps inactive web tabs laid out and inert; native keeps expo-router's detached screens. */}
            <TabSlot renderFn={renderTabSlot} />
          </TabBarOverlayContext>
        </View>
        <VerifyEmailNotice tabBarOverlay={overlay} />
      </View>
      {overlay ? <TabBar /> : null}
    </View>
  );
}
