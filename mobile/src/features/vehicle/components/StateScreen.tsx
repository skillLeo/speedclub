import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarPadding } from '@/features/shell/tabBarLayout';
import { createStyles } from '@/theme';
import { Header, Screen } from '@/ui';

const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles(() => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center' },
  body: { alignItems: 'center' },
}));

export type StateScreenProps = {
  /** `<ROUTE-ID>.root` and `.header`. */
  routeId: string;
  title?: string;
  onBack: () => void;
  backIcon?: 'back' | 'close';
  children: ReactNode;
};

/**
 * A vehicle route that has nothing to show: unavailable, not found, an error or offline without a copy. Back stays in
 * the corner, the state sits in the middle, and it scrolls when a large font makes it taller than the screen.
 */
export function StateScreen({ routeId, title, onBack, backIcon = 'back', children }: StateScreenProps) {
  const styles = useStyles();
  const padding = useTabBarPadding();
  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      <Header title={title} onBack={onBack} backIcon={backIcon} testID={`${routeId}.header`} />
      <ShellOfflineBanner />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, padding]}>
        <View style={styles.body}>{children}</View>
      </ScrollView>
    </Screen>
  );
}
