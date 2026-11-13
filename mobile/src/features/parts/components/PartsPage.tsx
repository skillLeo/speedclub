import type { ReactNode } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarPadding } from '@/features/shell/tabBarLayout';
import { useDiscoverColumn } from '@/features/discover/layout';
import { createStyles } from '@/theme';
import { Header, Screen, useCollapsingHeader, type HeaderAction } from '@/ui';

const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[32] },
}));

export type PartsPageProps = {
  routeId: string;
  /** The compact title once the page's own title has scrolled away. */
  title?: string;
  onBack: () => void;
  actions?: readonly HeaderAction[];
  offlineLabel: string;
  /** The page's own title block reports where it ends, so the bar's title comes in after it (DQ-324). */
  children: (collapseOn: (event: LayoutChangeEvent) => void) => ReactNode;
  overlays?: ReactNode;
};

/**
 * The frame of BRD-01, BRD-02 and the business pages without a hero: a pushed page in the Entdecken column (DISC-03's), the bar's
 * title coming in once the page title has scrolled away, the shell's offline line, and room for the floating tab bar.
 */
export function PartsPage({ routeId, title, onBack, actions, offlineLabel, children, overlays }: PartsPageProps) {
  const styles = useStyles();
  const header = useCollapsingHeader();
  const padding = useTabBarPadding();
  const column = useDiscoverColumn();
  const collapseOn = (event: LayoutChangeEvent) => header.collapseAt.set(event.nativeEvent.layout.y + event.nativeEvent.layout.height);
  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      <Header
        variant="large"
        scroll={header}
        title={title}
        onBack={onBack}
        actions={actions}
        contentMaxWidth={column.headerWidth}
        contentAlign={column.headerAlign}
        testID={`${routeId}.header`}
      />
      <ShellOfflineBanner label={offlineLabel} />
      <Animated.ScrollView
        {...header.scrollProps}
        style={styles.scroll}
        contentContainerStyle={[styles.content, padding]}
        keyboardShouldPersistTaps="handled"
        testID={`${routeId}.scroll`}
      >
        {children(collapseOn)}
      </Animated.ScrollView>
      {overlays}
    </Screen>
  );
}
