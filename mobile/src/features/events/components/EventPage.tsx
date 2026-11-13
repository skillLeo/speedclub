import '@/features/events/i18n';

import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarPadding } from '@/features/shell/tabBarLayout';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { Header, Screen, type HeaderAction } from '@/ui';

const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[32], paddingTop: t.space[16] },
  column: { alignSelf: 'flex-start', gap: t.space[24], maxWidth: layout.feedColumn, width: '100%' },
  centred: { flexGrow: 1, justifyContent: 'center' },
}));

/** The frame of EVT-04 and EVT-06: compact header with back, the offline line, and one column that starts on the gutter. */
export function EventPage({
  routeId,
  title,
  onBack,
  actions,
  offlineLabel,
  centred = false,
  scroll = true,
  children,
}: {
  routeId: string;
  title: string;
  onBack: () => void;
  actions?: readonly HeaderAction[];
  offlineLabel?: string;
  /** A state in the middle of the page (empty, error). */
  centred?: boolean;
  /** False when the body brings its own list. */
  scroll?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles();
  const padding = useTabBarPadding();
  const { gutter } = useBreakpoint();
  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      <Header title={title} onBack={onBack} actions={actions} testID={`${routeId}.header`} />
      <ShellOfflineBanner label={offlineLabel} />
      {scroll ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            centred ? styles.centred : null,
            { paddingHorizontal: gutter },
            padding,
          ]}
          keyboardShouldPersistTaps="handled"
          testID={`${routeId}.scroll`}
        >
          <View style={styles.column}>{children}</View>
        </ScrollView>
      ) : (
        children
      )}
    </Screen>
  );
}
